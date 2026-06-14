import { randomUUID } from 'node:crypto';
import type { IncomingTriggerPayload } from '@composio/core';
import { createJob } from './store.js';
import type { CreateJobInput, JobMetadata, ZilMateJob } from './types.js';

function compactText(value: unknown, max = 1200): string {
  if (value === undefined || value === null || value === '') return '';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function pickTriggerEventSummary(payload: Record<string, unknown> | undefined) {
  if (!payload) return '';
  const keys = [
    'subject',
    'title',
    'message',
    'text',
    'body',
    'snippet',
    'from',
    'sender',
    'email',
    'repository',
    'repo',
    'branch',
    'commit',
    'commits',
  ];

  for (const key of keys) {
    const value = compactText(payload[key], 180);
    if (value) return value;
  }

  return compactText(payload, 180);
}

export type TriggerPriority = 'urgent' | 'high' | 'normal' | 'low';
export type TriggerRoute = 'immediate' | 'draft_reply' | 'batch_summary' | 'holding' | 'monitor_only';

export type TriggerFollowUp = {
  schedule: string;
  task: string;
  purpose: string;
};

export type TriggerOrchestrationPlan = {
  chainId: string;
  priority: TriggerPriority;
  route: TriggerRoute;
  category: string;
  reasoning: string;
  primaryTask: string;
  followUps: TriggerFollowUp[];
  metadata: JobMetadata;
};

const urgentPattern = /\b(urgent|asap|immediately|critical|emergency|deadline today|overdue|outage|down|blocked)\b/i;
const newsletterPattern = /\b(newsletter|unsubscribe|digest|promotion|marketing|no-reply|noreply)\b/i;
const vipSenders = ['ceo', 'founder', 'investor', 'client', 'customer', 'boss', 'manager'];

function payloadText(event: IncomingTriggerPayload) {
  const payload = event.payload as Record<string, unknown> | undefined;
  const summary = pickTriggerEventSummary(payload);
  return summary || compactText(payload ?? {});
}

function senderHint(payload: Record<string, unknown> | undefined) {
  if (!payload) return '';
  const fields = ['from', 'sender', 'email', 'author', 'user', 'username'];
  for (const field of fields) {
    const value = payload[field];
    if (typeof value === 'string' && value.trim()) return value.toLowerCase();
    if (value && typeof value === 'object' && 'email' in value) {
      const email = (value as { email?: string }).email;
      if (email) return email.toLowerCase();
    }
  }
  return '';
}

function classifyPriority(event: IncomingTriggerPayload, text: string): TriggerPriority {
  if (urgentPattern.test(text)) return 'urgent';
  const toolkit = event.toolkitSlug?.toLowerCase() || '';
  if (toolkit.includes('pager') || toolkit.includes('incident') || toolkit.includes('alert')) return 'urgent';
  if (toolkit.includes('calendar') && /\b(starting|starts|in \d+ min|now)\b/i.test(text)) return 'high';
  const sender = senderHint(event.payload as Record<string, unknown> | undefined);
  if (sender && vipSenders.some((hint) => sender.includes(hint))) return 'high';
  if (newsletterPattern.test(text) || newsletterPattern.test(sender)) return 'low';
  return 'normal';
}

function classifyRoute(event: IncomingTriggerPayload, priority: TriggerPriority, text: string): TriggerRoute {
  const toolkit = event.toolkitSlug?.toLowerCase() || '';
  const sender = senderHint(event.payload as Record<string, unknown> | undefined);

  if (newsletterPattern.test(text) || newsletterPattern.test(sender)) return 'batch_summary';
  if (priority === 'urgent' || priority === 'high') return 'immediate';
  if (toolkit.includes('github') && /\b(review requested|assigned|mentioned|ci failed|build failed)\b/i.test(text)) return 'immediate';
  if (toolkit.includes('slack') && /\b(direct message|dm|@)\b/i.test(text)) return 'draft_reply';
  if (toolkit.includes('gmail') || toolkit.includes('outlook') || toolkit.includes('email')) {
    if (/\b(unknown|unrecognized|verify|confirm your email)\b/i.test(text)) return 'holding';
    return 'draft_reply';
  }
  if (toolkit.includes('stripe') || toolkit.includes('payment') || toolkit.includes('invoice')) return 'immediate';
  if (toolkit.includes('calendar')) return 'monitor_only';
  return priority === 'low' ? 'batch_summary' : 'draft_reply';
}

function routeInstructions(route: TriggerRoute) {
  switch (route) {
    case 'immediate':
      return 'Treat this as high priority. Summarize quickly, identify the required action, and execute or draft the next step immediately.';
    case 'draft_reply':
      return 'Summarize the event, decide whether a reply is needed, and draft a concise response the user can review before sending.';
    case 'batch_summary':
      return 'Summarize briefly for later batch review. Do not draft an immediate reply unless a clear blocker is present.';
    case 'holding':
      return 'This looks like an unknown or low-trust sender. Summarize safely, recommend verification steps, and avoid sending external replies automatically.';
    case 'monitor_only':
      return 'Prepare a useful briefing and note any reminders or follow-up steps, but do not treat this as an urgent reply event.';
  }
}

function followUpsForEvent(event: IncomingTriggerPayload, route: TriggerRoute, text: string): TriggerFollowUp[] {
  const followUps: TriggerFollowUp[] = [];
  const toolkit = event.toolkitSlug?.toLowerCase() || '';

  if (/\b(deadline|due by|due on|by friday|by monday|by tomorrow)\b/i.test(text)) {
    followUps.push({
      schedule: 'every 1 day',
      task: `Follow up on the ${event.triggerSlug || 'trigger'} event because it mentioned a deadline. Check whether the required action was completed and summarize status.`,
      purpose: 'deadline-follow-up',
    });
  }

  if (route === 'draft_reply' && (toolkit.includes('gmail') || toolkit.includes('email') || toolkit.includes('slack'))) {
    followUps.push({
      schedule: 'every 1 day',
      task: `Check whether the user received a reply to the ${event.triggerSlug || 'trigger'} event. If no reply after 24 hours, draft a short nudge.`,
      purpose: 'reply-nudge',
    });
  }

  if (route === 'immediate' && priorityNeedsWatch(route, text)) {
    followUps.push({
      schedule: 'every 6 hours',
      task: `Monitor the ${event.triggerSlug || 'trigger'} thread for updates and summarize any new changes.`,
      purpose: 'status-watch',
    });
  }

  return followUps;
}

function priorityNeedsWatch(route: TriggerRoute, text: string) {
  return route === 'immediate' && /\b(waiting|pending|blocked|follow up|follow-up)\b/i.test(text);
}

function primaryTaskForTrigger(event: IncomingTriggerPayload, plan: Pick<TriggerOrchestrationPlan, 'priority' | 'route' | 'category'>) {
  const toolkit = event.toolkitSlug?.toLowerCase() || 'external app';
  const payload = compactText(event.payload ?? {});
  const trigger = event.triggerSlug || 'unknown trigger';
  const summary = payloadText(event);
  const routeLine = routeInstructions(plan.route);

  return [
    `A ${plan.priority}-priority ${plan.category} trigger fired (${trigger} from ${toolkit}).`,
    routeLine,
    `Event summary: ${summary}`,
    'If this event implies future work, use job tools to queue follow-up jobs or schedules instead of stopping after one response.',
    `Raw payload: ${payload}`,
  ].join(' ');
}

function categoryForToolkit(toolkit: string) {
  if (toolkit.includes('gmail') || toolkit.includes('email') || toolkit.includes('outlook')) return 'email';
  if (toolkit.includes('slack') || toolkit.includes('discord') || toolkit.includes('teams')) return 'messaging';
  if (toolkit.includes('github') || toolkit.includes('gitlab')) return 'code';
  if (toolkit.includes('calendar')) return 'calendar';
  if (toolkit.includes('stripe') || toolkit.includes('payment')) return 'billing';
  if (toolkit.includes('notion') || toolkit.includes('linear') || toolkit.includes('jira')) return 'work-tracking';
  return 'integration';
}

export function buildTriggerOrchestrationPlan(event: IncomingTriggerPayload): TriggerOrchestrationPlan {
  const chainId = randomUUID();
  const text = payloadText(event);
  const toolkit = event.toolkitSlug?.toLowerCase() || 'external app';
  const priority = classifyPriority(event, text);
  const route = classifyRoute(event, priority, text);
  const category = categoryForToolkit(toolkit);
  const followUps = followUpsForEvent(event, route, text);
  const metadata: JobMetadata = {
    chainId,
    triggerId: event.id,
    triggerSlug: event.triggerSlug,
    toolkitSlug: event.toolkitSlug,
    userId: event.userId,
    payload: event.payload,
    orchestration: {
      priority,
      route,
      category,
      summary: text,
    },
  };

  const plan: TriggerOrchestrationPlan = {
    chainId,
    priority,
    route,
    category,
    reasoning: `Classified ${category} trigger as ${priority} priority with ${route} routing.`,
    primaryTask: '',
    followUps,
    metadata,
  };
  plan.primaryTask = primaryTaskForTrigger(event, plan);
  plan.followUps = followUpsForEvent(event, plan.route, payloadText(event));
  return plan;
}

export function refreshOrchestrationPlan(plan: TriggerOrchestrationPlan, event: IncomingTriggerPayload): TriggerOrchestrationPlan {
  plan.primaryTask = primaryTaskForTrigger(event, plan);
  plan.followUps = followUpsForEvent(event, plan.route, payloadText(event));
  return plan;
}

export async function orchestrateComposioTrigger(
  event: IncomingTriggerPayload,
  options: { plan?: TriggerOrchestrationPlan; includeFollowUps?: boolean } = {},
): Promise<ZilMateJob[]> {
  const plan = options.plan ?? buildTriggerOrchestrationPlan(event);
  const includeFollowUps = options.includeFollowUps ?? true;
  const jobs: ZilMateJob[] = [];

  const primaryInput: CreateJobInput = {
    task: plan.primaryTask,
    source: {
      type: 'composio-trigger',
      id: event.id,
      toolkitSlug: event.toolkitSlug,
      triggerSlug: event.triggerSlug,
    },
    metadata: {
      ...plan.metadata,
      orchestrationRole: 'primary',
    },
  };

  const primary = await createJob(primaryInput);
  jobs.push(primary);

  if (!includeFollowUps) {
    return jobs;
  }

  for (const followUp of plan.followUps) {
    const chained = await createJob({
      task: followUp.task,
      schedule: followUp.schedule,
      source: {
        type: 'composio-trigger',
        id: event.id,
        toolkitSlug: event.toolkitSlug,
        triggerSlug: event.triggerSlug,
      },
      metadata: {
        ...plan.metadata,
        orchestrationRole: 'follow-up',
        followUpPurpose: followUp.purpose,
        parentJobId: primary.id,
      },
    });
    jobs.push(chained);
  }

  return jobs;
}
