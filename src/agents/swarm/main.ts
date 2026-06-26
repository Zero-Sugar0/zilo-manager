import { type Tool, ToolLoopAgent, stepCountIs, tool } from 'ai';
import { z } from 'zod';
import { SwarmOrchestrator } from '../../runtime/swarm.js';
import { models } from '../../config/models.js';
import { limits } from '../../safety/limits.js';
import { createSwarmSpecialist } from './registry.js';
import { emitProgress } from '../../runtime/progress.js';
import { crossAppLedgerTools } from '../../tools/cross-app-ledger.tool.js';
import { createMCPTools, mcpManagementTools } from '../../tools/mcp.tool.js';
import { createComposioTools } from '../../tools/composio.tool.js';
import { executiveTools } from '../../tools/executive.tool.js';

export async function createDigitalCorporationMain(runId: string = 'default') {
  const orchestrator = SwarmOrchestrator.getInstance();
  const composioTools = await createComposioTools(runId);
  const mcpTools = await createMCPTools();

  return new ToolLoopAgent({
    model: models.manager,
    instructions: [
      'You are the Digital Corporation Main Agent, the Chief Operating Officer of the ZilMate Swarm.',
      'You manage six specialized departments: Strategy, Engineering, Development, Growth, Operations, and Data.',
      'Your core responsibility is to orchestrate these departments to run a real-world online business.',

      'MANAGEMENT PHILOSOPHY:',
      '1. DELEGATE, DON’T DO: Your primary role is routing and supervision. Assign tasks to specialists.',
      '2. DATA-FIRST: Always use "correlateBusinessData" or "getCorporateHealthBrief" to get a unified view across Stripe, HubSpot, and GitHub before high-level planning.',
      '3. SUPER TOOLS: Use "visualBrowserAudit" for UI verification, "autonomousMarketResearch" for competitor deep-dives, and "executeAndSelfHeal" (via QA) for engineering builds.',
      '4. FULL-STACK DELIVERY: Use the specialized "Development" department for building end-to-end applications, games, and web UI. Delegate to "leadDeveloper" to orchestrate complex builds.',
      '4. CHAINED EXECUTION: For complex goals, plan a sequence. Example: Architect designs -> Coder builds -> QA tests -> DevOps deploys.',
      '5. CRISIS MANAGEMENT: If a critical issue is detected, immediately use "triggerCrisisResponse" and delegate to specialists like "securityAuditor".',
      '6. ACCOUNTABILITY: Monitor the .md reports created by specialists. If an agent "stalls," re-evaluate the task or delegate to a different specialist.',
      '7. SYNTHESIS: Provide the CEO (Manager) with a high-level "Corporate Health" summary after every departmental burst.',

      'DEPARTMENTAL DOMAINS:',
      '- Strategy: CEO Orchestrator, Product Manager, Market Analyst, UX Researcher.',
      '- Engineering: Architect, Full-Stack Coder, QA Engineer, DevOps SRE, Creative Director, Security Auditor.',
      '- Development: Lead Developer, Frontend Architect, Backend Architect, Database Specialist, QA & Security Engineer, DevOps & Billing Specialist, Game Developer, Data Intelligence Engineer.',
      '- Growth: Growth Hacker, SEO Expert, Content Writer, Social Media Manager, Ads Manager, Sales Ops.',
      '- Operations: Finance Analyst, Customer Success, Legal Counsel, Logistics Lead, HR Recruiter.',
      '- Data: Data Scientist, BI Reporter, Agent Optimizer.',

      'You have full authority to manage cross-departmental handoffs and ensure all specialists are aligned with business KPIs.',
    ].join('\n'),
    tools: {
      ...crossAppLedgerTools,
      ...composioTools,
      ...mcpTools,
      ...mcpManagementTools,
      ...executiveTools,
      delegateToSpecialist: tool({
        description: 'Delegate a business task to a specialized swarm agent in the corporation.',
        inputSchema: z.object({
          task: z.string().min(10).describe('Detailed description of the task for the specialist.'),
          agentKey: z.string().describe('The key of the specialist to use (e.g., productManager, fullStackCoder, financeAnalyst).'),
        }),
        execute: async ({ task, agentKey }) => {
          emitProgress({ type: 'thinking', label: `COO delegating to ${agentKey}` });

          const specialist = createSwarmSpecialist(agentKey);
          const result = await specialist.run(task);

          return { agent: agentKey, report: result };
        },
      }),
      classifyAndDelegate: tool({
        description: 'Analyze a complex business objective and automatically route it to the best specialist.',
        inputSchema: z.object({
          task: z.string().min(10).describe('The business objective (e.g., "Analyze why churn is increasing").'),
        }),
        execute: async ({ task }) => {
          emitProgress({ type: 'thinking', label: 'COO classifying objective' });
          const classification = await orchestrator.classifyTask(task);

          emitProgress({ type: 'step', label: `Objective routed to ${classification.subagent}`, detail: classification.reasoning });

          const specialist = createSwarmSpecialist(classification.subagent);
          const result = await specialist.run(task);

          return { agent: classification.subagent, department: classification.department, report: result };
        },
      }),
    },
    stopWhen: stepCountIs(limits.managerSteps),
  });
}
