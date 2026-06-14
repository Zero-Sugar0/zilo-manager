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
import { limits } from '../safety/limits.js';
import { emitProgress, type ProgressEvent, withProgressListener } from '../runtime/progress.js';
import { type ConfirmationHandler, withConfirmationHandler } from '../runtime/confirm.js';
import { createScratchpadTools } from '../tools/scratchpad.tool.js';
import { ziloDocsTools } from '../tools/zilo-docs.tool.js';
import { createComposioTools } from '../tools/composio.tool.js';
import { memoryTools } from '../tools/memory.tool.js';
import { triggerTools } from '../tools/triggers.tool.js';
import { jobTools } from '../tools/jobs.tool.js';
import { timeTools } from '../tools/time.tool.js';
import { fileSystemTools } from '../tools/filesystem.tool.js';
import { desktopTools } from '../tools/desktop.tool.js';
import { computerUseTools } from '../tools/computer-use.tool.js';
import { shellTools } from '../tools/shell.tool.js';
import { skillTools } from '../tools/skills.tool.js';
import { personalContextTools } from '../tools/personal-context.tool.js';

function agentInput(prompt: string, abortSignal?: AbortSignal) {
  return abortSignal ? { prompt, abortSignal } : { prompt };
}

function describeTool(name: string) {
  const labels: Record<string, string> = {
    quickHelp: 'Using quick-help subagent',
    chat: 'Using chat subagent',
    post: 'Using post-writing subagent',
    image: 'Using image generation subagent',
    research: 'Using research subagent',
    automationPlanner: 'Using automation planner subagent',
    personalAssistant: 'Using personal assistant subagent',
    developerHelper: 'Using developer helper subagent',
    security: 'Using security subagent',
    readScratchpad: 'Reading scratchpad',
    appendScratchpad: 'Updating scratchpad',
    rememberMemory: 'Saving memory',
    recallMemory: 'Recalling memory',
    listMemory: 'Listing memory',
    forgetMemory: 'Forgetting memory',
    listZiloDocs: 'Listing Zilo docs',
    readZiloDoc: 'Reading Zilo doc',
    searchZiloDocs: 'Searching Zilo docs',
    listTriggerTypes: 'Listing trigger types',
    showTriggerType: 'Loading trigger schema',
    listTriggers: 'Listing triggers',
    createTrigger: 'Creating trigger',
    createJob: 'Creating job',
    listJobs: 'Listing jobs',
    showJob: 'Loading job',
    listJobLogs: 'Loading job logs',
    cancelJob: 'Cancelling job',
    getCurrentTime: 'Checking time',
    searchFiles: 'Searching files',
    readFile: 'Reading file',
    writeFile: 'Writing file',
    createFolder: 'Creating folder',
    moveCopyRename: 'Moving/copying/renaming file',
    deleteFile: 'Deleting file',
    deleteFolder: 'Deleting folder',
    listDirectory: 'Listing directory',
    getFileInfo: 'Getting file info',
    summarizeDocument: 'Summarizing document',
    watchFolderChanges: 'Checking folder changes',
    findDuplicateLargeFiles: 'Finding duplicate/large files',
    readClipboard: 'Reading clipboard',
    writeClipboard: 'Writing clipboard',
    takeScreenshot: 'Taking screenshot',
    analyzeScreenshot: 'Analyzing screenshot',
    takeCameraPhoto: 'Taking camera photo',
    analyzeCameraPhoto: 'Analyzing camera photo',
    openFile: 'Opening file',
    openApplication: 'Opening application',
    getSystemInfo: 'Getting system info',
    listRunningApplications: 'Listing running apps',
    simulateKeyboard: 'Sending keyboard input',
    executeCommand: 'Executing command',
    installDependencies: 'Installing dependencies',
    runPipeline: 'Running command pipeline',
    pythonScript: 'Running Python script',
    listProcesses: 'Listing processes',
    findInPath: 'Searching PATH',
    COMPOSIO_SEARCH_TOOLS: 'Searching Composio tools',
    COMPOSIO_GET_TOOL_SCHEMAS: 'Loading Composio tool schemas',
    COMPOSIO_MANAGE_CONNECTIONS: 'Managing Composio connection',
    COMPOSIO_MULTI_EXECUTE_TOOL: 'Executing Composio tool',
    COMPOSIO_REMOTE_WORKBENCH: 'Using Composio workbench',
    COMPOSIO_REMOTE_BASH_TOOL: 'Using Composio bash tool',
    installComputerUseDeps: 'Installing computer-use dependencies',
    mouseAction: 'Controlling mouse',
    keyboardAction: 'Simulating keyboard input',
    readScreen: 'Reading screen contents',
    manageWindow: 'Managing application windows',
    findOnScreen: 'Finding UI element on screen',
    dragAndDrop: 'Dragging and dropping',
  };
  return labels[name] || `Using ${name}`;
}

function subagentTool(name: string, description: string, run: (prompt: string, abortSignal?: AbortSignal) => Promise<string>) {
  return tool({
    description,
    inputSchema: z.object({ prompt: z.string().min(3) }),
    execute: async ({ prompt }, { abortSignal }) => {
      emitProgress({ type: 'tool:start', label: describeTool(name), detail: prompt });
      try {
        const result = await run(prompt, abortSignal);
        emitProgress({ type: 'tool:end', label: `${describeTool(name)} finished` });
        return result;
      } catch (error) {
        emitProgress({ type: 'tool:error', label: `${describeTool(name)} failed`, detail: error instanceof Error ? error.message : String(error) });
        throw error;
      }
    },
    toModelOutput: ({ output }) => ({ type: 'text', value: String(output) }),
  });
}

export async function createManagerAgent(runId: string = randomUUID(), options: { sessionId?: string } = {}) {
  const quickHelp = createQuickHelpAgent();
  const chat = createChatAgent();
  const post = createPostAgent();
  const image = createImageAgent();
  const research = createDocsResearchAgent(runId);
  const automationPlanner = createAutomationPlannerAgent();
  const personalAssistant = createPersonalAssistantAgent();
  const developerHelper = createDeveloperHelperAgent(runId);
  const security = createSecurityAgent(runId);
  const scratchpadTools = createScratchpadTools(runId);
  const composioTools = await createComposioTools(options.sessionId || 'default');

  return new ToolLoopAgent({
    model: models.manager,
    instructions: [
      'You are ZilMate, a general CLI assistant with deep built-in ZiloShift expertise.',
      'Know your current capabilities: you have text chat, realtime voice mode with speech input and spoken replies, shared session history, long-term memory, background jobs, scheduled tasks, Composio app tools/triggers, web/docs research, time/date tools, file tools, clipboard, screenshot, camera/photo analysis, image generation, and specialized subagents for automation, personal assistant planning, developer help, research, chat, posts, and images.',
      'When asked what features or tools you lack, do not claim you lack capabilities that are already listed. Instead, identify genuine gaps such as hosted always-on workers without deployment, richer mobile UI, deeper proactive monitoring, first-party calendar/email UX, more robust permission management, or marketplace-quality integrations.',
      'Route ZiloShift/support/worker/venue/payment/verification/SMS/dispute questions through the local Zilo docs before using web research.',
      'Use Composio tools for external app tasks such as GitHub, Gmail, Slack, Notion, Stripe, Supabase, and other connected-account actions. If a needed app is not connected, use Composio connection management and surface the connect link to the user.',
      'For Composio, prefer this flow: use COMPOSIO_SEARCH_TOOLS to find relevant external app tools, COMPOSIO_GET_TOOL_SCHEMAS to inspect required arguments, COMPOSIO_MANAGE_CONNECTIONS to create or show app connection links, and COMPOSIO_MULTI_EXECUTE_TOOL to execute selected tools after arguments are clear.',
      'When COMPOSIO_MANAGE_CONNECTIONS returns an authorization or connect URL, print that URL plainly and tell the user to open it to connect their account before retrying the app action.',
      'For app events, use trigger tools: listTriggerTypes to discover current trigger slugs, showTriggerType to inspect required config, listTriggers to inspect existing trigger instances, and createTrigger only after config is clear. Prefer dryRun first, then ask for confirmation before creating a real trigger.',
      'Use job tools when the user wants ZilMate to keep working after chat, schedule a task, create a report later, monitor something, follow up, inspect job status, read job logs, or cancel background work.',
      'Composio trigger workflows can chain jobs automatically: classify priority/route, queue a primary job, and spawn follow-up schedules such as deadline reminders or no-reply nudges. Use automationPlanner when users want custom trigger chains beyond the default orchestration.',
      'When multiple tools need user permission, they are approved one at a time. Do not assume a batch approval covers later actions.',
      'Explain that local jobs require `zilmate jobs worker` to be running, and hosted laptop-closed schedules require QStash plus a public job webhook.',
      'Use getCurrentTime whenever the user asks about the current date, current time, today, tomorrow, yesterday, or any schedule-relative wording. Do not guess dates or times.',
      'Use file-system tools for local file search, reading, writing, folder creation, moving/copying/renaming, document summaries, folder change checks, duplicate/large file audits, and file metadata. File operations are free and unrestricted. Use deleteFile and deleteFolder to remove files (requires confirm=true for safety).',
      'Use shell tools to execute commands and Python scripts: executeCommand runs any shell/PowerShell command (node, python, npm, pnpm, yarn, pip, builds, tests, etc.), installDependencies auto-detects and installs packages, runPipeline chains commands with pipes (cmd1 | cmd2), getSystemInfo gets CPU/memory/OS details, listProcesses lists running apps, findInPath checks if a command exists. These tools make the agent truly powerful in the CLI—capable of running any automation, installing packages, running tests, and executing applications.',
      'Use desktop tools for clipboard (read/write), screenshots (capture/analyze), camera, file/app launching (openFile, openApplication), system information (getSystemInfo), running app enumeration (listRunningApplications), and keyboard automation (simulateKeyboard for typing, hotkeys, Enter/Escape/etc). Desktop tools enable full system automation and UI control.',
      'When returning tool slugs, trigger slugs, ids, env vars, or command names, wrap them in backticks so exact underscores and casing are preserved.',
      'Use specialized subagents for focused chat, quick help, post copy, image assets, research, automation planning, personal-assistant planning, developer integration help, and security (OSINT investigations + penetration testing).',
      'Before specialized work, use searchSkills and readSkill when a matching SKILL.md exists (like Claude Code skills). Follow loaded skill instructions for that task.',
      'Use getPersonalContext and updatePersonalContext to learn and remember what is urgent for this user, their VIP contacts, active projects, and business workflows.',
      'Use automationPlanner for background jobs, schedules, Composio trigger workflows, QStash, webhook planning, monitoring, and follow-up automations.',
      'Use personalAssistant for daily planning, reminders, briefings, prioritization, follow-ups, summaries, and memory-aware personal organization.',
      'Use developerHelper for SDK usage, Next.js routes, install issues, package publishing, Cloudflare tunnels, webhooks, QStash, Composio setup, and technical troubleshooting.',
      'Use research for current web or documentation questions that need sources.',
      'Use long-term memory tools for stable preferences, durable project facts, and recurring context. Do not save secrets, API keys, tokens, passwords, or sensitive personal data to memory.',
      'When the user asks what you were doing earlier, where you left off, to continue, or to resume prior work, check long-term memory and the scratchpad before saying you do not remember. If no relevant memory exists, say that briefly and ask for one cue.',
      'Keep parent context small and use scratchpad tools for compact notes during multi-source or multi-step tasks.',
      'Do not build OAuth flows yourself. Do not claim live external changes happened unless the tool result confirms them.',
    ].join(' '),
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
      image: subagentTool('image', 'Generate image assets and return saved local file paths.', async (prompt, abortSignal) => {
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
      ...ziloDocsTools,
      ...memoryTools,
      ...timeTools,
      ...fileSystemTools,
      ...desktopTools,
      ...jobTools,
      ...triggerTools,
      ...scratchpadTools,
      ...composioTools,
      ...computerUseTools,
      ...shellTools,
      ...skillTools,
      ...personalContextTools,
    },
    stopWhen: stepCountIs(limits.managerSteps),
  });
}

function toolNamesFromStep(step: unknown) {
  const toolCalls = (step as { toolCalls?: Array<{ toolName?: string }> }).toolCalls || [];
  return toolCalls.map((call) => call.toolName).filter((name): name is string => Boolean(name));
}

export async function runManager(prompt: string, options: { progress?: (event: ProgressEvent) => void; runId?: string; sessionId?: string; confirm?: ConfirmationHandler } = {}) {
  return withProgressListener(options.progress, async () => {
    return withConfirmationHandler(options.confirm, async () => {
      const runId = options.runId || randomUUID();
      emitProgress({ type: 'thinking', label: 'Thinking', detail: runId });
      const manager = await createManagerAgent(runId, options.sessionId ? { sessionId: options.sessionId } : {});
      const result = await manager.generate({
        prompt,
        onStepFinish: (step) => {
          const tools = toolNamesFromStep(step);
          if (tools.length > 0) {
            emitProgress({ type: 'step', label: 'Manager selected tools', detail: tools.map(describeTool).join(', ') });
          }
        },
      });
      emitProgress({ type: 'done', label: 'Response ready' });
      return result.text;
    });
  });
}



