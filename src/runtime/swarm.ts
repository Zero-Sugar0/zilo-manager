import { type Tool, ToolLoopAgent, stepCountIs, tool } from 'ai';
import { z } from 'zod';
import { models } from '../config/models.js';
import { limits } from '../safety/limits.js';
import { ReportGenerator } from './swarm/reports.js';
import { createMCPTools, closeMCPClients } from '../tools/mcp.tool.js';
import { createComposioTools } from '../tools/composio.tool.js';
import { getCollaborateWithPeerTool } from '../tools/swarm-ops.tool.js';
import { corporateWikiTools } from '../tools/corporate-wiki.tool.js';
import { sandboxDevTools } from '../tools/sandbox-dev.tool.js';
import { createScratchpadTools } from '../tools/scratchpad.tool.js';

export type SwarmDepartment = 'Strategy' | 'Engineering' | 'Growth' | 'Operations' | 'Data' | 'Security' | 'Revenue' | 'Development';

export interface SwarmAgentConfig {
  name: string;
  department: SwarmDepartment;
  instructions: string;
  tools: Record<string, Tool<any, any>>;
  composioToolkits?: string[]; // Optional specific toolkits for this agent
}

export class SwarmAgent {
  private agent: ToolLoopAgent<any, any, any> | null = null;
  private reportGenerator = ReportGenerator.getInstance();
  private sessionId: string = 'default';

  constructor(private config: SwarmAgentConfig) {}

  private getDeptModel(): string {
    const dept = this.config.department;
    if (dept === 'Strategy') return models.deptStrategy;
    if (dept === 'Engineering') return models.deptEngineering;
    if (dept === 'Development') return models.deptDevelopment;
    if (dept === 'Growth') return models.deptGrowth;
    if (dept === 'Operations') return models.deptOperations;
    if (dept === 'Data') return models.deptData;
    if (dept === 'Security') return models.deptSecurity;
    if (dept === 'Revenue') return models.deptRevenue;
    return models.chat;
  }

  async init(sessionId: string = 'default') {
    this.sessionId = sessionId;
    const composioTools = await createComposioTools(sessionId);
    const mcpTools = await createMCPTools({
      excludeServers: ['filesystem', 'git', 'playwright']
    });
    const scratchpadTools = createScratchpadTools(sessionId);

    this.agent = new ToolLoopAgent({
      model: this.getDeptModel(),
      instructions: [
        `You are ${this.config.name}, a specialist in the ${this.config.department} department.`,
        this.config.instructions,
        `You have access to a vast array of external tools via Composio and advanced reasoning/infrastructure capabilities via MCP. Use them for real-world tasks like Stripe payments, HubSpot CRM management, GitHub repository work, and more.`,
        `When you complete a significant task or plan, use the updateStatusReport tool to document your work as an .md file.`,
        `SWARM ADVANCED CAPABILITIES:`,
        `1. CORPORATE WIKI: At the start of ANY task, run queryCorporateWiki to gain situational awareness of prior findings, schemas, or market analyses. When you complete a task, use publishToCorporateWiki to save critical intelligence/deliverables so other agents benefit.`,
        `2. JOINT WAR ROOMS: Instead of escalating everything to the COO/Manager, use collaborateWithPeer to directly open a Joint War Room sub-thread with any other specialist (e.g. backendArchitect, frontendArchitect, qaEngineer) to solve cross-functional tasks or negotiate contracts.`,
        `3. AUTONOMOUS SANDBOX RUNNER: If you are writing, patching, or verifying code or scripts, use executeSandboxDevLoop to run compilation and test suites, analyze errors, and self-heal your implementation in a fast local loop.`,
      ].join('\n'),
      tools: {
        ...this.config.tools,
        ...composioTools,
        ...mcpTools,
        ...corporateWikiTools,
        ...sandboxDevTools,
        ...scratchpadTools,
        collaborateWithPeer: getCollaborateWithPeerTool(this.config.name),
        updateStatusReport: tool({
          description: 'Update your departmental status report (.md file). Use this to track what you are doing or what you have finished.',
          inputSchema: z.object({
            status: z.enum(['doing', 'done', 'planning']),
            content: z.string().min(10).describe('Detailed Markdown content of your progress or findings.'),
          }),
          execute: async ({ status, content }) => {
            const filePath = await this.reportGenerator.saveReport(this.config.name, content, status);
            return { status: 'Report updated', filePath };
          },
        }),
      },
      stopWhen: stepCountIs(limits.subagentSteps),
    });
  }

  async run(prompt: string, abortSignal?: AbortSignal) {
    if (!this.agent) {
      await this.init(this.sessionId);
    }
    
    const { describeTool, toolNamesFromStep } = await import('./tool-utils.js');
    const { emitProgress } = await import('./progress.js');
    const { SwarmTraceTracker } = await import('../observability/traces.js');

    const tracker = SwarmTraceTracker.getInstance();
    const span = await tracker.startSpan({
      sessionId: this.sessionId,
      agentKey: this.config.name,
      agentName: this.config.name,
      department: this.config.department,
      task: prompt,
    });

    return tracker.runWithSpan(span, async () => {
      const result = await this.agent!.generate({
        prompt,
        ...(abortSignal ? { abortSignal } : {}),
        onStepFinish: (step: any) => {
          const tools = toolNamesFromStep(step);
          if (tools.length > 0) {
            const detail = tools.map(describeTool).join(', ');
            emitProgress({ type: 'step', label: `${this.config.name} selected tools`, detail });
            tracker.recordEvent('tool_call', 'selected_tools', detail).catch(() => {});
          }
        }
      } as any);
      return result.text;
    });
  }
}

export type SwarmMessage = {
  from: string;
  to: string;
  content: string;
  priority: 'low' | 'medium' | 'high';
  metadata?: any;
};

export class SwarmOrchestrator {
  private static instance: SwarmOrchestrator;

  private constructor() {}

  static getInstance(): SwarmOrchestrator {
    if (!SwarmOrchestrator.instance) {
      SwarmOrchestrator.instance = new SwarmOrchestrator();
    }
    return SwarmOrchestrator.instance;
  }

  async classifyTask(task: string): Promise<{ department: string; subagent: string; reasoning: string }> {
    const { generateObject } = await import('ai');
    const { specialistRegistry } = await import('../agents/swarm/registry.js');

    const departmentsMap = new Map<string, string[]>();
    for (const [key, agent] of Object.entries(specialistRegistry)) {
      const dept = agent.department.toLowerCase();
      if (!departmentsMap.has(dept)) {
        departmentsMap.set(dept, []);
      }
      departmentsMap.get(dept)!.push(key);
    }

    const availableDepts = Array.from(departmentsMap.keys());
    const availableSubagents = Array.from(departmentsMap.values()).flat();

    const { object } = await generateObject({
      model: models.manager,
      schema: z.object({
        department: z.string().describe('The department name in lowercase.'),
        subagent: z.string().describe('The registered specialist agent key.'),
        reasoning: z.string().describe('Reasoning for choosing this department and specialist.'),
      }),
      prompt: `Analyze this business task and assign it to the most relevant department and subagent:
      Task: ${task}

      Available Departments: ${availableDepts.join(', ')}
      Available Subagents: ${availableSubagents.join(', ')}`,
    });

    return object as any;
  }

  formatAgentRequest(message: SwarmMessage): string {
    return `[Swarm Message] From: ${message.from} | Priority: ${message.priority}\n\nTask: ${message.content}`;
  }
}
