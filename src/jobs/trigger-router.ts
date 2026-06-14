import { generateText } from 'ai';
import type { IncomingTriggerPayload } from '@composio/core';
import { models } from '../config/models.js';
import { formatPersonalContextForPrompt, loadPersonalContext } from '../memory/personal-context.js';
import { getActiveTriggerPolicy } from './trigger-policies.js';
import type { TriggerOrchestrationPlan, TriggerPriority, TriggerRoute } from './trigger-orchestrator.js';
import { buildTriggerOrchestrationPlan, refreshOrchestrationPlan } from './trigger-orchestrator.js';

export type TriggerClassification = {
  priority: TriggerPriority;
  route: TriggerRoute;
  category: string;
  reasoning: string;
  confidence: 'high' | 'medium' | 'low';
  usedLlm: boolean;
};

function parseJsonBlock(text: string) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function classifyTriggerWithContext(event: IncomingTriggerPayload): Promise<TriggerClassification> {
  const heuristicPlan = buildTriggerOrchestrationPlan(event);
  const policy = await getActiveTriggerPolicy();
  const personal = await loadPersonalContext();
  const personalBlock = formatPersonalContextForPrompt(personal);

  try {
    const result = await generateText({
      model: models.help,
      prompt: [
        'Classify this external app trigger for a personal assistant orchestrator.',
        'Return ONLY JSON with keys: priority (urgent|high|normal|low), route (immediate|draft_reply|batch_summary|holding|monitor_only), category (string), reasoning (string), confidence (high|medium|low).',
        '',
        `Trigger: ${event.triggerSlug || 'unknown'}`,
        `Toolkit: ${event.toolkitSlug || 'unknown'}`,
        `Payload summary: ${heuristicPlan.metadata.orchestration && typeof heuristicPlan.metadata.orchestration === 'object'
          ? (heuristicPlan.metadata.orchestration as { summary?: string }).summary || ''
          : ''}`,
        `Heuristic guess: priority=${heuristicPlan.priority}, route=${heuristicPlan.route}, category=${heuristicPlan.category}`,
        '',
        'Active policy:',
        `- VIP senders: ${policy.vipSenders.join(', ') || 'none'}`,
        `- Urgent keywords: ${policy.urgentKeywords.join(', ')}`,
        `- Low-priority keywords: ${policy.lowPriorityKeywords.join(', ')}`,
        policy.customInstructions ? `- Custom: ${policy.customInstructions}` : '',
        personalBlock ? `\nPersonal context:\n${personalBlock}` : '',
      ].filter(Boolean).join('\n'),
    });

    const parsed = parseJsonBlock(result.text);
    if (parsed) {
      const priority = parsed.priority as TriggerPriority;
      const route = parsed.route as TriggerRoute;
      if (['urgent', 'high', 'normal', 'low'].includes(priority) && [
        'immediate', 'draft_reply', 'batch_summary', 'holding', 'monitor_only',
      ].includes(route)) {
        return {
          priority,
          route,
          category: String(parsed.category || heuristicPlan.category),
          reasoning: String(parsed.reasoning || 'LLM classification'),
          confidence: parsed.confidence === 'high' || parsed.confidence === 'low' ? parsed.confidence : 'medium',
          usedLlm: true,
        };
      }
    }
  } catch {
    // fall back to heuristics
  }

  return {
    priority: heuristicPlan.priority,
    route: heuristicPlan.route,
    category: heuristicPlan.category,
    reasoning: heuristicPlan.reasoning,
    confidence: 'medium',
    usedLlm: false,
  };
}

export async function buildOrchestrationPlanWithRouting(event: IncomingTriggerPayload): Promise<TriggerOrchestrationPlan> {
  const classification = await classifyTriggerWithContext(event);
  const plan = buildTriggerOrchestrationPlan(event);
  plan.priority = classification.priority;
  plan.route = classification.route;
  plan.category = classification.category;
  plan.reasoning = classification.reasoning;
  plan.metadata = {
    ...plan.metadata,
    classification,
    orchestration: {
      priority: classification.priority,
      route: classification.route,
      category: classification.category,
      summary: typeof plan.metadata.orchestration === 'object' && plan.metadata.orchestration
        ? (plan.metadata.orchestration as { summary?: string }).summary
        : '',
    },
  };
  return refreshOrchestrationPlan(plan, event);
}

export function formatOrchestrationProposal(plan: TriggerOrchestrationPlan) {
  const lines = [
    `Chain ${plan.chainId}`,
    `Priority: ${plan.priority}`,
    `Route: ${plan.route}`,
    `Category: ${plan.category}`,
    `Reason: ${plan.reasoning}`,
    '',
    'Primary job:',
    plan.primaryTask.slice(0, 500) + (plan.primaryTask.length > 500 ? '...' : ''),
  ];
  if (plan.followUps.length) {
    lines.push('', 'Follow-up jobs:');
    for (const followUp of plan.followUps) {
      lines.push(`- [${followUp.schedule}] ${followUp.purpose}: ${followUp.task.slice(0, 200)}`);
    }
  }
  return lines.join('\n');
}
