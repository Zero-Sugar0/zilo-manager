import type { IncomingTriggerPayload } from '@composio/core';
import { env } from '../config/env.js';
import { routePolicyFor, getActiveTriggerPolicy } from './trigger-policies.js';
import { buildOrchestrationPlanWithRouting, formatOrchestrationProposal } from './trigger-router.js';
import { orchestrateComposioTrigger } from './trigger-orchestrator.js';
import type { ZilMateJob } from './types.js';

export function triggerWorkflowsEnabled() {
  return env.zilmateTriggerWorkflowsEnabled;
}

/** @deprecated Use handleComposioTriggerWorkflow for chained trigger workflows. */
export async function createJobFromComposioTrigger(event: IncomingTriggerPayload) {
  const jobs = await handleComposioTriggerWorkflow(event);
  return jobs[0] ?? null;
}

export async function handleComposioTriggerWorkflow(event: IncomingTriggerPayload): Promise<ZilMateJob[]> {
  if (!triggerWorkflowsEnabled()) return [];

  const plan = await buildOrchestrationPlanWithRouting(event);
  const policy = await getActiveTriggerPolicy();
  const routePolicy = routePolicyFor(policy, plan.route);
  const includeFollowUps = plan.followUps.length === 0 || routePolicy.autoApproveFollowUps;

  if (plan.followUps.length > 0 && !includeFollowUps) {
    console.log(`  proposedFollowUps=${plan.followUps.length} (approve via automation planner or enable autoApproveFollowUps in policy)`);
    console.log(`  proposal=${formatOrchestrationProposal(plan).split('\n').slice(0, 4).join(' | ')}`);
  }

  return orchestrateComposioTrigger(event, { plan, includeFollowUps });
}
