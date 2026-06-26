import { type Tool, ToolLoopAgent, stepCountIs, tool } from 'ai';
import { z } from 'zod';
import { models } from '../config/models.js';
import { limits } from '../safety/limits.js';
import { ReportGenerator } from './swarm/reports.js';
import { createMCPTools, closeMCPClients } from '../tools/mcp.tool.js';
import { createComposioTools } from '../tools/composio.tool.js';

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
    const composioTools = await createComposioTools(sessionId);
    const mcpTools = await createMCPTools();

    this.agent = new ToolLoopAgent({
      model: this.getDeptModel(),
      instructions: [
        `You are ${this.config.name}, a specialist in the ${this.config.department} department.`,
        this.config.instructions,
        `You have access to a vast array of external tools via Composio and advanced reasoning/infrastructure capabilities via MCP. Use them for real-world tasks like Stripe payments, HubSpot CRM management, GitHub repository work, and more.`,
        `When you complete a significant task or plan, use the updateStatusReport tool to document your work as an .md file.`,
      ].join('\n'),
      tools: {
        ...this.config.tools,
        ...composioTools,
        ...mcpTools,
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
      await this.init();
    }
    const result = await this.agent!.generate({
      prompt,
      ...(abortSignal ? { abortSignal } : {})
    } as any);
    return result.text;
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
  private departments: Map<string, string[]> = new Map([
    ['strategy', ['productManager', 'marketAnalyst']],
    ['engineering', ['fullStackCoder', 'qaEngineer', 'devopsSre']],
    ['development', ['leadDeveloper', 'frontendArchitect', 'backendArchitect', 'databaseSpecialist', 'qaSecurityEngineer', 'devOpsBillingSpecialist', 'gameDeveloper', 'dataIntelligenceEngineer']],
    ['growth', ['growthHacker', 'seoExpert', 'contentWriter', 'socialMediaManager', 'salesOps', 'adsManager']],
    ['operations', ['financeAnalyst', 'customerSuccess', 'legalCounsel', 'hrRecruiter', 'logisticsLead']],
    ['data', ['dataScientist', 'biReporter']],
    ['security', ['securityAnalyst', 'redTeam', 'blueTeam']],
    ['revenue', ['enterpriseSales', 'channelPartner', 'affiliateManager']],
  ]);

  private constructor() {}

  static getInstance(): SwarmOrchestrator {
    if (!SwarmOrchestrator.instance) {
      SwarmOrchestrator.instance = new SwarmOrchestrator();
    }
    return SwarmOrchestrator.instance;
  }

  async classifyTask(task: string): Promise<{ department: string; subagent: string; reasoning: string }> {
    const { generateObject } = await import('ai');
    const { object } = await generateObject({
      model: models.manager,
      schema: z.object({
        department: z.enum(['strategy', 'engineering', 'development', 'growth', 'operations', 'data', 'security', 'revenue', 'general']),
        subagent: z.string(),
        reasoning: z.string(),
      }),
      prompt: `Analyze this business task and assign it to the most relevant department and subagent:
      Task: ${task}

      Available Departments: ${Array.from(this.departments.keys()).join(', ')}
      Available Subagents: ${Array.from(this.departments.values()).flat().join(', ')}`,
    });

    return object as any;
  }

  formatAgentRequest(message: SwarmMessage): string {
    return `[Swarm Message] From: ${message.from} | Priority: ${message.priority}\n\nTask: ${message.content}`;
  }
}
