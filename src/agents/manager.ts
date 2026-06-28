import { randomUUID } from 'node:crypto';
import { stepCountIs, tool, ToolLoopAgent } from 'ai';
import { z } from 'zod';
import { models } from '../config/models.js';
import { createQuickHelpAgent } from './quick-help.agent.js';
import { createChatAgent } from './chat.agent.js';
import { createPostAgent } from './post.agent.js';
import { createImageAgent } from './image.agent.js';
import { createDocsResearchAgent } from './docs-research.agent.js';
import { createAutomationPlannerAgent } from './automation-planner.agent.js';
import { createPersonalAssistantAgent } from './personal-assistant.agent.js';
import { createDeveloperHelperAgent } from './developer-helper.agent.js';
import { createSecurityAgent } from './security.agent.js';
import { createCodingAgent } from './coding.agent.js';
import { createGoalManagerAgent } from './goal-manager.agent.js';
import { createFinanceAgent } from './finance.agent.js';
import { createDigitalCorporationMain } from './swarm/main.js';
import { limits } from '../safety/limits.js';
import { emitProgress, type ProgressEvent, withProgressListener } from '../runtime/progress.js';
import { type ConfirmationHandler, withConfirmationHandler } from '../runtime/confirm.js';
import { describeTool, toolNamesFromStep } from '../runtime/tool-utils.js';
import { createScratchpadTools } from '../tools/scratchpad.tool.js';
import { ziloDocsTools } from '../tools/zilo-docs.tool.js';
import { createMCPTools, mcpManagementTools } from '../tools/mcp.tool.js';
import { createComposioTools } from '../tools/composio.tool.js';
import { memoryTools } from '../tools/memory.tool.js';
import { triggerTools } from '../tools/triggers.tool.js';
import { jobTools } from '../tools/jobs.tool.js';
import { timeTools } from '../tools/time.tool.js';
import { weatherTools } from '../tools/weather.tool.js';
import { fileSystemTools } from '../tools/filesystem.tool.js';
import { desktopTools } from '../tools/desktop.tool.js';
import { devopsTools } from '../tools/devops.tool.js';
import { sysopsTools } from '../tools/sysops.tool.js';
import { multimediaTools } from '../tools/multimedia.tool.js';
import { cloudTools } from '../tools/cloud.tool.js';
import { computerUseTools } from '../tools/computer-use.tool.js';
import { shellTools } from '../tools/shell.tool.js';
import { skillTools } from '../tools/skills.tool.js';
import { personalContextTools } from '../tools/personal-context.tool.js';
import { setupAssistantTools } from '../tools/setup-assistant.tool.js';
import { workspaceTools } from '../tools/workspace.tool.js';
import { notebookTools } from '../tools/notebook.tool.js';
import { knowledgeTools } from '../tools/knowledge.tool.js';
import { healTools } from '../tools/heal.tool.js';
import { trustTools } from '../tools/trust.tool.js';
import { updateTools } from '../tools/update.tool.js';
import { notifyTools } from '../tools/notify.tool.js';
import { documentTools } from '../tools/documents.tool.js';
import { askTools } from '../tools/ask.tool.js';
import { withAskHandler, type AskHandler } from '../runtime/ask.js';
import { situationalAwarenessTools } from '../tools/situational-awareness.tool.js';
import { sessionContinuityTools } from '../tools/session-continuity.tool.js';
import { trackUsage } from '../observability/usage.js';
import { runProactiveDoctor } from '../observability/doctor.js';
import { SystemPromptBuilder } from '../runtime/prompts/builder.js';
import { SwarmOrchestrator } from '../runtime/swarm.js';

function agentInput(prompt: string, abortSignal?: AbortSignal) {
  return abortSignal ? { prompt, abortSignal } : { prompt };
}


function subagentTool(
  name: string,
  description: string,
  run: (prompt: string, abortSignal?: AbortSignal) => Promise<string>,
  options: { agent?: string; trackSteps?: boolean } = {},
) {
  return tool({
    description,
    inputSchema: z.object({ prompt: z.string().min(3) }),
    execute: async ({ prompt }, { abortSignal }) => {
      const agent = options.agent || name;
      if (options.trackSteps) {
        emitProgress({ type: 'subagent:start', label: describeTool(name), detail: prompt, agent });
      } else {
        emitProgress({ type: 'tool:start', label: describeTool(name), detail: prompt });
      }
      try {
        const result = await run(prompt, abortSignal);
        emitProgress(options.trackSteps
          ? { type: 'subagent:end', label: `${describeTool(name)} finished`, agent }
          : { type: 'tool:end', label: `${describeTool(name)} finished` });
        return result;
      } catch (error) {
        emitProgress({
          type: 'tool:error',
          label: `${describeTool(name)} failed`,
          detail: error instanceof Error ? error.message : String(error),
          ...(options.trackSteps ? { agent } : {}),
        });
        throw error;
      }
    },
    toModelOutput: ({ output }) => ({ type: 'text', value: String(output) }),
  });
}


import { browserTools } from '../tools/browser.tool.js';
import { imageIntelligenceTools } from '../tools/image-intelligence.tool.js';
import { webIntelligenceTools } from '../tools/web-intelligence.tool.js';

function buildManagerInstructions() {
  const builder = new SystemPromptBuilder();

  builder.addSection({
    id: 'core',
    content: [
      '# ZilMate — Personal Friend, Dedicated Agent, and Swarm Orchestrator',
      '',
      'You are ZilMate: the user\'s personal friend, dedicated agent, and lead orchestrator of your own agentic swarm. While you manage all of your own business departments, operations, development pipelines, and act as the executive CEO of your own digital corporation, you are first and foremost their close friend and personal agent. Your relationship with the user is built on trust, mutual support, and absolute partnership.',
      '',
      '## Personality & Communication Style',
      '- Treat the user as a close friend and valued partner. Be warm, supportive, authentic, and highly reliable.',
      '- Balance your executive CEO capability with a personal touch. You should sound like a highly competent partner in crime, not just a sterile corporate executive.',
      '- Keep responses highly organized, direct, and actionable, while remaining warm, engaging, and conversational.',
      '- Provide concise summaries rather than dry blocks of text.',
      '- Use clean markdown formatting, structured lists, and bold headers to communicate status.',
      '- Avoid overly passive, verbose, or overconfident language. Frame success based on concrete, verified tool outputs.',
      '',
      '## Decision & Routing Protocols',
      '- **Immediate Triage**: Upon receiving any request, immediately assess the scope. Do you need local execution, deep research, or specialist delegation?',
      '- **Specialist Swarm Delegation**: Prefer routing specific requests to specialized subagents to conserve cognitive window and leverage dedicated tools:',
      '  * Complex business operations, startup launches, multi-layered marketing, and general cross-department goals: Route to `digitalCorporation`.',
      '  * Focused codebase modifications, debugging within a repository, and git commits: Route to `coding`.',
      '  * SDK integrations, Next.js architecture, library installation help, Cloudflare/tunnels, and deep package-level troubleshooting: Route to `developerHelper`.',
      '  * Public web research, API documentation lookups, and literature synthesis requiring citations: Route to `research`.',
      '  * OSINT, vulnerability auditing, or authorized network scans: Route to `security`.',
      '  * Daily organization, schedule planning, task lists, and notes: Route to `personalAssistant`.',
      '- **Self-Execution**: If a task is straightforward, immediate, or concerns the Orchestrator itself, execute it directly using your Super Tools. Do NOT use this as a loophole to write source code or run compiler tasks yourself!',
      '',
      '## Strict Delegation Mandates (CEO Standards)',
      '- **DO NOT CODE DIRECTLY**: You are the CEO, NOT a software developer. You must NEVER use `writeFile`, `patchFile`, or `moveCopyRename` to write or edit source code files (e.g., `.ts`, `.js`, `.py`, `.html`, `.css`, etc.). You must ALWAYS delegate codebase modifications, feature implementations, and bug fixes to the `coding` specialist or the `developerHelper`. Directly writing or editing codebase source files is an absolute failure of swarm orchestration.',
      '- **DO NOT COMPILE DIRECTLY**: You must NEVER run compiler, builder, linter, or test suite commands (e.g., `npm run build`, `npm test`, `tsc`, `pytest`) using `executeCommand` or `executeAndSelfHeal` at the manager level. These tasks must be run strictly inside the `coding` or `developerHelper` subagents who possess specialized feedback and healing loops.',
      '- **MANDATORY PROJECT PLANNING**: For any large, complex, or multi-step objectives (e.g., "Build a custom Tetris game", "Launch a sleeping tracker"), you must ALWAYS trigger the `goalManager` subagent first. The `goalManager` is specialized in clarifying scope and breaking down requirements. It will formalize the requirements, outline the architecture, break down the tasks into the notebook, and set milestones. Once the plan is saved to the notebook, orchestrate your specialists (`coding`, `developerHelper`) to execute those steps sequentially.',
      '',
      '## Executive Guardrails',
      '- **Precise Naming**: Always enclose tool slugs, trigger slugs, IDs, environment variables, or commands in backticks (e.g., `executeCommand`, `COMPOSIO_SEARCH_TOOLS`, `DATABASE_URL`).',
      '- **Temporal Grounding**: Never guess dates or times. Always run `getCurrentTime` to verify the current date, day of week, or calendar orientation before taking any schedule-relative action.',
      '- **Spatial Grounding**: Use `getCurrentLocation` to resolve the user\'s IP-based coordinates and `getWeather`/`getForecast` for current and multi-day meteorological insights.',
      '- **Auth & Key Hygiene**: Never ask for, handle, or output API keys, passwords, or secrets. If key setup is incomplete, guide the user to run `zilmate setup` privately or call `launchSecureSetup`. Only configure non-secret settings using `configureSafeSetting`.',
      '- **Incremental Approvals**: Multiple tools needing user consent must be requested individually. A single permission approval does not imply wildcard clearance for future actions.',
    ].join('\n'),
  });

  builder.addSection({
    id: 'mcp',
    content: [
      '# Model Context Protocol (MCP) Protocol',
      '',
      '- **Dynamic Reasoning**: Leverage the `sequential-thinking` MCP server to break down highly complex, multi-variable analytical questions.',
      '- **Durable Semantic Graph**: Use the `memory` MCP server to maintain a rich, persistent knowledge graph of entities, projects, and rules.',
      '- **Infrastructure & Data Management**: Use default database servers (`sqlite` or `postgres`) to perform programmatic CRUD operations and generate analytical reports on local databases.',
      '- **Media & Conversion**: Use `ffmpeg` for media processing/transcoding and `pandoc`/`graphviz` for document translations and architectural diagram rendering.',
      '- **Management**: Use MCP management tools (`addMCPServer`, `listMCPServers`, `removeMCPServer`) to dynamically expand the system\'s sensory capabilities.',
    ].join('\n'),
  });

  builder.addSection({
    id: 'composio',
    content: [
      '# Composio Integration & Connection Protocol',
      '',
      '- **App Discovery**: Use `COMPOSIO_SEARCH_TOOLS` to find high-impact integrations (Slack, Gmail, GitHub, Stripe, Notion, Hubtel, etc.).',
      '- **Execution Flow**: Search for tools → Inspect schemas via `COMPOSIO_GET_TOOL_SCHEMAS` → Execute via `COMPOSIO_MULTI_EXECUTE_TOOL`.',
      '- **Connection Management**: If a service requires authentication, call `COMPOSIO_MANAGE_CONNECTIONS` to generate a secure authorization link. Print the link clearly for the user to open, and instruct them to complete auth before proceeding.',
      '- **Reactive Triggers**: Use triggers for real-time automation. List available event definitions via `listTriggerTypes`, check schema via `showTriggerType`, and set up event listeners via `createTrigger`. Always perform a `dryRun` or seek verification before initiating outbound trigger scripts.',
    ].join('\n'),
  });

  builder.addSection({
    id: 'automation',
    content: [
      '# Autonomous Automation & Job Planning',
      '',
      '- **Post-Chat Execution**: When a task must run after the user closes the chat or require long-running workers, use `automationPlanner` and job tools (`createJob`, `listJobs`, `getJobLogs`).',
      '- **Background Workers**: Explain that background tasks require the local worker daemon (`zilmate jobs worker`) to be active, or QStash webhooks for serverless hosting.',
      '- **Event-Driven Chains**: Model complex trigger workflows where an incoming trigger initiates a primary job, which recursively schedules secondary nudges, reminders, or report aggregations.',
    ].join('\n'),
  });

  builder.addSection({
    id: 'system',
    content: [
      '# Local System & Filesystem Execution Protocol',
      '',
      '- **Filesystem Operations**: You have powerful, unrestricted file utilities (`readFile`, `writeFile`, `patchFile`, `moveCopyRename`, `bulkMove`, `listDirectory`, `treeView`). Use them to inspect code, write configurations, compare revisions via `diffFiles`, and audit directories.',
      '- **Confirmation Guardrails**: Explicitly call `deleteFile` or `deleteFolder` only when deletion is strictly required. For safety, these actions automatically invoke interactive CLI confirmations.',
      '- **Robust Directory Copying**: The `moveCopyRename` and `bulkMove` tools support recursive directory copies and fallback cross-volume moves (copying recursively and deleting source if standard rename throws `EXDEV`).',
      '- **Shell Execution Power**: Use `executeCommand` to compile code, run tests, execute Python scripts, and launch runtimes. Use `installDependencies` to automatically detect package managers (npm, pip, yarn, cargo) and install required libraries without prompting.',
      '- **Non-blocking / Background Execution**: For long-running commands, starting servers, running persistent listeners, or running continuous test processes (like starting the chatbot or starting a development server), you must NEVER hang or block the execution turn. Instead, run them asynchronously using `executeCommandAsync` which returns a process ID, and monitor progress using `checkCommandStatus`, `sendInputToProcess`, and `listBackgroundCommands` so you can track if the process is fixed or running without stalling.',
      '- **Diagnostic Self-Healing**: If a terminal command, script, or compilation fails, DO NOT give up. Initiate an immediate self-healing loop: check environment variables via `getSystemInfo`, locate commands in system paths using `findInPath`, inspect processes with `listProcesses`, consult relevant `SKILL.md` guides, and patch the faulty files.',
      '- **Desktop Control**: Use desktop tools (`simulateKeyboard`, `readClipboard`, `writeClipboard`, `openApplication`, `takeScreenshot`) to drive GUI apps, interact with complex software, and automate browser actions via Playwright browser tools.',
    ].join('\n'),
  });

  builder.addSection({
    id: 'specialists',
    content: [
      '# Swarm Specialists Registry',
      '',
      'You are backed by specialized subagents, each possessing optimized system instructions and context:',
      '- **Strategy, Engineering, Operations, Growth, Data**: Departments managed under the `digitalCorporation` COO subagent. Delegate comprehensive business goals here.',
      '- **Coding specialist (`coding`)**: Expert developer for git workflows (`gitStatus`, `gitDiff`, `gitLog`), structured edits, code formatting, running test suites, and creating atomic commits.',
      '- **Developer Helper (`developerHelper`)**: Highly detailed technical counselor for framework integration, API routing, deployment setups, and debugging complex runtime issues.',
      '- **Research specialist (`research`)**: Thorough web browser and documentation scraper that compiles sources and outputs inline citations.',
      '- **Security specialist (`security`)**: Specialized OSINT investigator and penetration tester for authorized diagnostic vulnerability scans.',
      '- **Personal Assistant (`personalAssistant`)**: Daily planner, briefings manager, reminder manager, and personal knowledge graph administrator.',
    ].join('\n'),
  });

  builder.addSection({
    id: 'workspace',
    content: [
      '# Workspace Continuity & Durable Memory',
      '',
      '- **Standard Workspace Folder**: Your shared state is located in `~/ZilMate`. Maintain notes, plans, and persistent knowledge here.',
      '- **State Synchronization**: Run `getSituationBrief` at the beginning of any substantial turn to synchronize your CWD, git status, active background jobs, and system capabilities.',
      '- **Scratchpad Protocol (`readScratchpad`, `appendScratchpad`)**: Use scratchpad tools to maintain a light, transient memory *during a single multi-turn execution*. When compiling complex research, performing multi-step debugging, or working on long tasks, append compact factual notes to the scratchpad so that subsequent model steps can reload them without bloating the prompt context or repeating work.',
      '- **Durable Notebook Protocol**: Use the dedicated notebook tools to read and write long-term project and user information across sessions:',
      '  * `readNotebook`: Load durable user notes and architectural files separate from short-lived scratchpads.',
      '  * `appendNotebook` / `quickNotebookNote`: Save durable plans, preferences, commands, open ports, installation logs, and project setup details to `notebook.md` and `notes.json`. This ensures other subagents and future sessions maintain flawless continuity.',
      '  * `searchNotebook` / `listNotebookEntries`: Search past durable notebook entries before asking the user to repeat prior context.',
      '- **Mental Graph Maintenance**: Use knowledge graph tools to maintain structural relationships of people, goals, and projects.',
      '- **Post-Execution Cleaning**: Run `runHealPass` after completing major segments to clean up run memories, log accomplishments, and register newly discovered skills/preferences.',
      '- **Continuous Progression**: If the user instructs you to "continue", "resume", or asks what you were doing earlier, look inside long-term memory, local stores, and the notebook to determine the exact previous step before requesting further input.',
    ].join('\n'),
  });

  return builder.build(['mcp', 'composio', 'automation', 'system', 'specialists', 'workspace']);
}

export async function createManagerAgent(runId: string = randomUUID(), options: { sessionId?: string } = {}) {
  const digitalCorp = await createDigitalCorporationMain(runId);
  const quickHelp = createQuickHelpAgent();
  const chat = createChatAgent();
  const post = createPostAgent();
  const image = createImageAgent();
  const research = createDocsResearchAgent(runId);
  const automationPlanner = createAutomationPlannerAgent();
  const personalAssistant = createPersonalAssistantAgent();
  const developerHelper = createDeveloperHelperAgent(runId);
  const security = createSecurityAgent(runId);
  const coding = await createCodingAgent(runId);
  const goalManager = createGoalManagerAgent();
  const finance = createFinanceAgent(runId);
  const scratchpadTools = createScratchpadTools(runId);
  const composioTools = await createComposioTools(options.sessionId || 'default');
  const mcpTools = await createMCPTools({
    excludeServers: ['filesystem', 'git', 'playwright']
  });

  return new ToolLoopAgent({
    model: models.manager,
    instructions: buildManagerInstructions(),
    tools: {
      quickHelp: subagentTool('quickHelp', 'Fast troubleshooting and usage guidance.', async (prompt, abortSignal) => {
        const result = await quickHelp.generate(agentInput(prompt, abortSignal));
        return result.text;
      }),
      chat: subagentTool('chat', 'Natural conversation about ZiloShift workflows and features.', async (prompt, abortSignal) => {
        const result = await chat.generate(agentInput(prompt, abortSignal));
        return result.text;
      }),
      post: subagentTool('post', 'Generate short WhatsApp/status/social post copy.', async (prompt, abortSignal) => {
        const result = await post.generate(agentInput(prompt, abortSignal));
        return result.text;
      }),
      image: subagentTool('image', 'Generate or edit image assets from prompts, local image paths, image URLs, and masks; return saved local file paths.', async (prompt, abortSignal) => {
        const result = await image.generate(agentInput(prompt, abortSignal));
        return result.text;
      }),
      research: subagentTool('research', 'Research docs or current web information and return sourced summaries.', async (prompt, abortSignal) => {
        const result = await research.generate(agentInput(prompt, abortSignal));
        return result.text;
      }),
      automationPlanner: subagentTool('automationPlanner', 'Plan background jobs, schedules, trigger workflows, monitoring, follow-ups, QStash, and webhook automations.', async (prompt, abortSignal) => {
        const result = await automationPlanner.generate(agentInput(prompt, abortSignal));
        return result.text;
      }),
      personalAssistant: subagentTool('personalAssistant', 'Daily planning, reminders, briefings, prioritization, follow-ups, summaries, and memory-aware assistant work.', async (prompt, abortSignal) => {
        const result = await personalAssistant.generate(agentInput(prompt, abortSignal));
        return result.text;
      }),
      developerHelper: subagentTool('developerHelper', 'Developer-focused help for ZilMate CLI, SDK, Next.js integration, publishing, QStash, Cloudflare tunnels, webhooks, and debugging.', async (prompt, abortSignal) => {
        const result = await developerHelper.generate(agentInput(prompt, abortSignal));
        return result.text;
      }),
      security: subagentTool('security', 'OSINT investigations (username/email/phone/domain lookups) and penetration testing (subdomain discovery, port scanning, vulnerability scanning, SQL injection, web fuzzing). Requires user authorization for active scanning.', async (prompt, abortSignal) => {
        const result = await security.generate(agentInput(prompt, abortSignal));
        return result.text;
      }),
      coding: subagentTool('coding', 'Software engineering in a git repo: status/diff/log, unified patches, tests, commits. Use for code edits and debugging — not SDK/docs questions.', async (prompt, abortSignal) => {
        const result = await coding.generate({
          ...agentInput(prompt, abortSignal),
          onStepFinish: (step) => {
            for (const toolName of toolNamesFromStep(step)) {
              emitProgress({ type: 'subagent:step', label: toolName, agent: 'coding' });
            }
          },
        });
        return result.text;
      }, { agent: 'coding', trackSteps: true }),
      goalManager: subagentTool('goalManager', 'Break goals into actionable steps, timelines, dependencies, and optional scheduled follow-ups.', async (prompt, abortSignal) => {
        const result = await goalManager.generate(agentInput(prompt, abortSignal));
        return result.text;
      }),
      finance: subagentTool('finance', 'Financial analysis, market data, and business reporting using Yahoo Finance.', async (prompt, abortSignal) => {
        const result = await finance.generate(agentInput(prompt, abortSignal));
        return result.text;
      }),
      digitalCorporation: subagentTool('digitalCorporation', 'Run a real online business end-to-end. Strategy, Engineering, Growth, Operations, and Data.', async (prompt, abortSignal) => {
        const result = await digitalCorp.generate({
          ...agentInput(prompt, abortSignal),
          onStepFinish: (step) => {
            const tools = toolNamesFromStep(step);
            if (tools.length > 0) {
              emitProgress({ type: 'step', label: 'COO selected tools', detail: tools.map(describeTool).join(', ') });
            }
          }
        });

        try {
          const { loadSessionSpans, generateHtmlDashboard, openBrowser } = await import('../observability/traces.js');
          const { workspaceLayout } = await import('../workspace/paths.js');
          const { mkdir, writeFile } = await import('node:fs/promises');
          const path = await import('node:path');

          const spans = await loadSessionSpans(runId);
          if (spans.length > 0) {
            const logsDir = workspaceLayout().logs;
            await mkdir(logsDir, { recursive: true });
            const dashboardHtml = generateHtmlDashboard(spans, runId);
            const filepath = path.join(logsDir, `swarm-dashboard-${runId}.html`);
            await writeFile(filepath, dashboardHtml, 'utf8');

            openBrowser(filepath);

            const fileUrl = `file:///${filepath.replace(/\\/g, '/')}`;
            return `${result.text}\n\n---\n📊 **Interactive Swarm Observability Dashboard:**\n📁 Log Path: ${filepath}\n🌐 View Dashboard: [Click here to open Swarm Timeline](${fileUrl})`;
          }
        } catch (err) {
          // Fallback to raw text if dashboard generation fails
        }

        return result.text;
      }),
      ...ziloDocsTools,
      ...memoryTools,
      ...timeTools,
      ...weatherTools,
      ...fileSystemTools,
      ...desktopTools,
      ...devopsTools,
      ...sysopsTools,
      ...multimediaTools,
      ...cloudTools,
      ...jobTools,
      ...triggerTools,
      ...scratchpadTools,
      ...composioTools,
      ...mcpTools,
      ...mcpManagementTools,
      ...computerUseTools,
      ...shellTools,
      ...skillTools,
      ...personalContextTools,
      ...setupAssistantTools,
      ...workspaceTools,
      ...notebookTools,
      ...knowledgeTools,
      ...healTools,
      ...trustTools,
      ...updateTools,
      ...notifyTools,
      ...documentTools,
      ...askTools,
      ...situationalAwarenessTools,
      ...sessionContinuityTools,
      ...browserTools,
      ...imageIntelligenceTools,
      ...webIntelligenceTools,
    },
    stopWhen: stepCountIs(limits.managerSteps),
  });
}

export async function runManager(prompt: string, options: { progress?: (event: ProgressEvent) => void; runId?: string; sessionId?: string; confirm?: ConfirmationHandler; ask?: AskHandler } = {}) {
  return withProgressListener(options.progress, async () => {
    return withConfirmationHandler(options.confirm, async () => {
      return withAskHandler(options.ask, async () => {
      const runId = options.runId || randomUUID();
      emitProgress({ type: 'thinking', label: 'Thinking', detail: runId });
      const manager = await createManagerAgent(runId, options.sessionId ? { sessionId: options.sessionId } : {});

      // Proactively check dependencies in the background
      runProactiveDoctor().catch(() => undefined);

      const result = await manager.generate({
        prompt,
        onStepFinish: (step) => {
          const tools = toolNamesFromStep(step);
          if (tools.length > 0) {
            emitProgress({ type: 'step', label: 'Manager selected tools', detail: tools.map(describeTool).join(', ') });
          }
          if (step.usage) {
            trackUsage(options.sessionId || 'default', step.usage);
          }
        },
      });
      emitProgress({ type: 'done', label: 'Response ready' });
      return result.text;
      });
    });
  });
}

