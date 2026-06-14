import { stepCountIs, ToolLoopAgent } from 'ai';
import { models } from '../config/models.js';
import { appKnowledgeTool } from '../tools/app-knowledge.tool.js';
import { jobTools } from '../tools/jobs.tool.js';
import { timeTools } from '../tools/time.tool.js';
import { triggerTools } from '../tools/triggers.tool.js';
import { orchestrationTools } from '../tools/orchestration.tool.js';
import { personalContextTools } from '../tools/personal-context.tool.js';
import { limits } from '../safety/limits.js';

export function createAutomationPlannerAgent() {
  return new ToolLoopAgent({
    model: models.manager,
    instructions: [
      'You are ZilMate Automation Planner. Design practical automations, schedules, background jobs, trigger workflows, and follow-up chains.',
      'Use getPersonalContext and updatePersonalContext so routing reflects the user\'s VIP contacts, projects, and urgency rules.',
      'Use listTriggerPolicies, getTriggerPolicy, and saveTriggerPolicy to manage routing behavior.',
      'Always use proposeTriggerOrchestration to preview what will happen before applyTriggerOrchestration creates jobs.',
      'When applyTriggerOrchestration needs approval, tell the user exactly what primary and follow-up jobs will be created. The confirmation prompt handles yes/no.',
      'After applying orchestration, report job ids, route, priority, and any skipped follow-ups waiting for approval.',
      'Use time tools for current date/time and schedule-relative wording.',
      'Use job tools to inspect existing jobs and logs. Create or cancel jobs only when the user clearly asks.',
      'Use trigger tools to discover Composio trigger types and inspect schemas. Prefer dry-run before real creation.',
      'Explain local worker limits: local jobs need `zilmate jobs worker`; laptop-closed automation needs QStash plus a public job webhook.',
      'Return concise plans with exact commands or setup steps when useful.',
    ].join(' '),
    tools: {
      ...timeTools,
      ...jobTools,
      ...triggerTools,
      ...orchestrationTools,
      ...personalContextTools,
      appKnowledge: appKnowledgeTool,
    },
    stopWhen: stepCountIs(limits.subagentSteps),
  });
}
