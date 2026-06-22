import { type Tool, ToolLoopAgent, stepCountIs, tool } from 'ai';
import { z } from 'zod';
import { SwarmOrchestrator } from '../../runtime/swarm.js';
import { models } from '../../config/models.js';
import { limits } from '../../safety/limits.js';
import { createSwarmSpecialist } from './registry.js';
import { emitProgress } from '../../runtime/progress.js';
import { crossAppLedgerTools } from '../../tools/cross-app-ledger.tool.js';

export async function createDigitalCorporationMain(runId: string = 'default') {
  const orchestrator = SwarmOrchestrator.getInstance();

  return new ToolLoopAgent({
    model: models.manager,
    instructions: [
      'You are the Digital Corporation Main Agent.',
      'You sit alongside the Manager but focus exclusively on running a real online business end-to-end.',
      'You manage a hierarchy of 20 specialized swarm agents across Strategy, Engineering, Growth, Operations, and Data.',
      'When the user gives a business goal, you use the delegateToSpecialist tool to assign it to the right department.',
      'You have access to the crossAppLedger for correlating data across different platforms (Stripe, HubSpot, GitHub).',
      'Ensure all specialist agents create .md reports for tracking. Summarize their findings for the user.',
    ].join('\n'),
    tools: {
      ...crossAppLedgerTools,
      delegateToSpecialist: tool({
        description: 'Delegate a business task to a specialized swarm agent in the corporation.',
        inputSchema: z.object({
          task: z.string().min(10).describe('Detailed description of the task for the specialist.'),
          agentKey: z.string().describe('The key of the specialist to use (e.g., productManager, fullStackCoder, financeAnalyst).'),
        }),
        execute: async ({ task, agentKey }) => {
          emitProgress({ type: 'thinking', label: `Delegating task to ${agentKey}` });

          const specialist = createSwarmSpecialist(agentKey);
          const result = await specialist.run(task);

          return { agent: agentKey, report: result };
        },
      }),
      classifyAndDelegate: tool({
        description: 'Analyze a complex business task and automatically route it to the best specialist.',
        inputSchema: z.object({
          task: z.string().min(10).describe('The complex business objective.'),
        }),
        execute: async ({ task }) => {
          emitProgress({ type: 'thinking', label: 'Classifying business task' });
          const classification = await orchestrator.classifyTask(task);

          emitProgress({ type: 'step', label: `Task assigned to ${classification.subagent}`, detail: classification.reasoning });

          const specialist = createSwarmSpecialist(classification.subagent);
          const result = await specialist.run(task);

          return { agent: classification.subagent, department: classification.department, report: result };
        },
      }),
    },
    stopWhen: stepCountIs(limits.managerSteps),
  });
}
