import { tool } from 'ai';
import { z } from 'zod';
import type { IncomingTriggerPayload } from '@composio/core';
import { buildOrchestrationPlanWithRouting, formatOrchestrationProposal } from '../jobs/trigger-router.js';
import { getActiveTriggerPolicy, listTriggerPolicies, saveTriggerPolicy, type TriggerRoutingPolicy } from '../jobs/trigger-policies.js';
import { orchestrateComposioTrigger } from '../jobs/trigger-orchestrator.js';
import { requestConfirmation } from '../runtime/confirm.js';
import { emitProgress } from '../runtime/progress.js';

export const orchestrationTools = {
  listTriggerPolicies: tool({
    description: 'List saved trigger routing policies (VIP senders, urgency keywords, auto-approve rules).',
    inputSchema: z.object({}),
    execute: async () => listTriggerPolicies(),
  }),

  getTriggerPolicy: tool({
    description: 'Get the active trigger routing policy.',
    inputSchema: z.object({}),
    execute: async () => getActiveTriggerPolicy(),
  }),

  saveTriggerPolicy: tool({
    description: 'Save or update a trigger routing policy. Requires user confirmation.',
    inputSchema: z.object({
      policy: z.object({
        id: z.string().optional(),
        name: z.string().min(1),
        enabled: z.boolean().optional().default(true),
        vipSenders: z.array(z.string()).optional().default([]),
        urgentKeywords: z.array(z.string()).optional().default([]),
        lowPriorityKeywords: z.array(z.string()).optional().default([]),
        customInstructions: z.string().optional().default(''),
      }),
    }),
    execute: async ({ policy }) => {
      const approved = await requestConfirmation({
        toolkitSlug: 'ZILMATE',
        toolSlug: 'TRIGGER_POLICY',
        action: `Save trigger policy "${policy.name}"`,
        access: 'Write',
        targetTools: ['TRIGGER_POLICY'],
        details: [
          `VIP senders: ${policy.vipSenders?.join(', ') || 'none'}`,
          `Urgent keywords: ${policy.urgentKeywords?.join(', ') || 'none'}`,
          policy.customInstructions ? `Instructions: ${policy.customInstructions.slice(0, 120)}` : '',
        ].filter(Boolean),
        summary: policy.name,
      });
      if (!approved) throw new Error('Policy save blocked by user.');
      const existing = await getActiveTriggerPolicy();
      const saved = await saveTriggerPolicy({
        ...existing,
        ...policy,
        id: policy.id || existing.id,
        routes: existing.routes,
        createdAt: existing.createdAt,
        updatedAt: new Date().toISOString(),
      } as TriggerRoutingPolicy);
      return saved;
    },
  }),

  proposeTriggerOrchestration: tool({
    description: 'Preview how a trigger would be classified and which jobs/chains would be created. Does not create jobs.',
    inputSchema: z.object({
      triggerSlug: z.string().min(1),
      toolkitSlug: z.string().min(1),
      payload: z.record(z.string(), z.unknown()).optional(),
    }),
    execute: async ({ triggerSlug, toolkitSlug, payload }) => {
      const event = {
        id: 'preview',
        triggerSlug,
        toolkitSlug,
        payload: payload ?? {},
      } as IncomingTriggerPayload;
      const plan = await buildOrchestrationPlanWithRouting(event);
      return {
        proposal: formatOrchestrationProposal(plan),
        plan: {
          chainId: plan.chainId,
          priority: plan.priority,
          route: plan.route,
          category: plan.category,
          followUpCount: plan.followUps.length,
          followUps: plan.followUps,
        },
      };
    },
  }),

  applyTriggerOrchestration: tool({
    description: 'Create jobs from a real or simulated trigger event after showing the user what will happen. Ask for approval when follow-ups are included.',
    inputSchema: z.object({
      triggerSlug: z.string().min(1),
      toolkitSlug: z.string().min(1),
      payload: z.record(z.string(), z.unknown()).optional(),
      triggerId: z.string().optional(),
      userId: z.string().optional(),
      dryRun: z.boolean().optional(),
    }),
    execute: async ({ triggerSlug, toolkitSlug, payload, triggerId, userId, dryRun }) => {
      const event = {
        id: triggerId || `manual-${Date.now()}`,
        triggerSlug,
        toolkitSlug,
        userId,
        payload: payload ?? {},
      } as IncomingTriggerPayload;

      emitProgress({ type: 'thinking', label: 'Planning trigger orchestration' });
      const plan = await buildOrchestrationPlanWithRouting(event);
      const proposal = formatOrchestrationProposal(plan);
      const policy = await getActiveTriggerPolicy();
      const routePolicy = policy.routes[plan.route];

      if (dryRun) {
        return { dryRun: true, proposal, plan };
      }

      const needsPrimaryConfirm = routePolicy && !routePolicy.autoApprovePrimary;
      const needsFollowUpConfirm = plan.followUps.length > 0 && routePolicy && !routePolicy.autoApproveFollowUps;

      if (needsPrimaryConfirm || needsFollowUpConfirm) {
        const approved = await requestConfirmation({
          toolkitSlug: 'ZILMATE',
          toolSlug: 'TRIGGER_ORCHESTRATION',
          action: needsFollowUpConfirm ? 'Create trigger job chain' : 'Create trigger primary job',
          access: 'Write',
          targetTools: ['TRIGGER_ORCHESTRATION'],
          details: proposal.split('\n').slice(0, 12),
          summary: `${plan.priority} ${plan.route} chain with ${plan.followUps.length} follow-up(s)`,
        });
        if (!approved) {
          return {
            applied: false,
            blocked: true,
            proposal,
            message: 'User declined orchestration. Nothing was queued.',
          };
        }
      }

      const jobs = await orchestrateComposioTrigger(event, { plan, includeFollowUps: true });
      return {
        applied: true,
        proposal,
        jobs: jobs.map((job) => ({
          id: job.id,
          status: job.status,
          schedule: job.schedule,
          role: job.metadata.orchestrationRole,
        })),
        report: [
          `Queued ${jobs.length} job(s) for ${triggerSlug}.`,
          `Route: ${plan.route}, priority: ${plan.priority}.`,
          jobs.length > 1 ? `Follow-ups: ${jobs.length - 1} scheduled.` : 'No follow-ups.',
        ].join(' '),
      };
    },
  }),
};
