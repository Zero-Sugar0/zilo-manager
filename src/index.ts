#!/usr/bin/env node
import { Command } from 'commander';
import { generateText } from 'ai';
import { requireGatewayAuth } from './config/env.js';
import { models } from './config/models.js';
import { runManager } from './agents/manager.js';
import { createQuickHelpAgent } from './agents/quick-help.agent.js';
import { createChatAgent } from './agents/chat.agent.js';
import { createPostAgent } from './agents/post.agent.js';
import { createDocsResearchAgent } from './agents/docs-research.agent.js';
import { generateImageAsset, isImageSize } from './tools/image-generate.tool.js';
import { startInteractiveChat } from './cli/interactive.js';
import { runSetup, runVoiceSetup, setVoiceEnabled } from './cli/setup.js';
import { printError, printJson, printMarkdown, printProgress } from './cli/format.js';
import { createTerminalConfirmation } from './cli/confirm.js';
import { getComposioStatus } from './tools/composio.tool.js';
import { getResolvedConfigSummary, runDoctor } from './cli/doctor.js';
import { clearMemories, forget, listMemories, recall, remember } from './memory/long-term.js';
import { createTrigger, listenToTriggers, listTriggers, listTriggerTypes, showTriggerType } from './cli/triggers.js';
import { cancelCliJob, createCliJob, listCliJobs, runCliJob, showCliJob, showCliJobLogs, startCliJobListener, startCliJobWorker } from './cli/jobs.js';
import { initWorkspace } from './workspace/init.js';
import { workspaceLayout } from './workspace/paths.js';
import { runHeal } from './memory/heal.js';
import { runSwarmCli } from './cli/swarm.js';
import { printWelcomeScreen } from './cli/welcome.js';
import { startDefaultLauncher, startMainMenu } from './cli/menu.js';
import { printDoctorChecks } from './cli/health.js';
import { printAppsStatus } from './cli/apps.js';
import { printMemoryTable } from './cli/memory.js';
import { listVoiceDevices, printVoiceConfig, runTerminalVoiceLive, runVoiceAgentProbe, runVoiceDoctor, runVoiceSpeakTest, runVoiceTurn } from './cli/voice.js';
import { printVersionStatus, runSelfUpdate } from './cli/update.js';
import { captureCameraCli, listCameraDevicesCli, runCameraDoctorCli } from './cli/camera.js';
import { printModelBrowser } from './cli/models.js';

type TextAgentFactory = () => { generate: (input: { prompt: string }) => Promise<{ text: string }> };

async function printResult(value: string | unknown) {
  if (typeof value === 'string') {
    printMarkdown(value);
  } else {
    printJson(value);
  }
}

async function runAgentText(agentFactory: TextAgentFactory, prompt: string) {
  requireGatewayAuth();
  const result = await agentFactory().generate({ prompt });
  await printResult(result.text);
}

function friendlyError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/AI_GATEWAY_API_KEY|VERCEL_OIDC_TOKEN|TAVILY_API_KEY|COMPOSIO_API_KEY|ZILMATE_USER_ID/.test(message)) return message;
  return `ZilMate failed: ${message}`;
}

const program = new Command();
program
  .name('zilmate')
  .description('ZilMate Agent')
  .version('1.7.5');

program
  .command('welcome')
  .description('Show the ZilMate welcome dashboard')
  .action(async () => {
    try {
      await printWelcomeScreen();
    } catch (error) {
      printError(friendlyError(error));
      process.exitCode = 1;
    }
  });

program
  .command('version')
  .description('Show current ZilMate version and check npm for updates')
  .action(async () => {
    try {
      await printVersionStatus(program.version() || 'unknown');
    } catch (error) {
      printError(friendlyError(error));
      process.exitCode = 1;
    }
  });

program
  .command('update')
  .option('--tag <tag>', 'npm dist-tag or version to install', 'latest')
  .option('--dry-run', 'show the update command without running it')
  .description('Update the global ZilMate CLI/SDK from npm')
  .action(async (options: { tag?: string; dryRun?: boolean }) => {
    try {
      await runSelfUpdate({
        ...(options.tag !== undefined ? { tag: options.tag } : {}),
        dryRun: Boolean(options.dryRun),
      });
    } catch (error) {
      printError(friendlyError(error));
      process.exitCode = 1;
    }
  });

program
  .command('menu')
  .description('Open the guided ZilMate main menu')
  .action(async () => {
    try {
      await startMainMenu();
    } catch (error) {
      printError(friendlyError(error));
      process.exitCode = 1;
    }
  });

program
  .command('setup')
  .option('-p, --path <file>', 'environment file to create or update', '.env')
  .option('-f, --force', 'skip the first overwrite confirmation when the env file exists')
  .option('-y, --yes', 'noninteractive mode; write defaults plus provided keys')
  .option('--ai-gateway-key <key>', 'AI Gateway API key')
  .option('--composio-key <key>', 'optional Composio API key for external app tools')
  .option('--zilmate-user-id <id>', 'stable local user id for Composio sessions')
  .option('--tavily-key <key>', 'optional Tavily API key for web research')
  .option('--redis-url <url>', 'optional Upstash Redis REST URL')
  .option('--redis-token <token>', 'optional Upstash Redis REST token')
  .option('--jobs-enabled <true|false>', 'enable or disable background jobs')
  .option('--qstash-token <token>', 'optional Upstash QStash token for hosted schedules')
  .option('--job-webhook-url <url>', 'public job webhook URL for QStash callbacks')
  .option('--job-webhook-secret <secret>', 'shared secret expected by hosted job webhook')
  .option('--trigger-workflows-enabled <true|false>', 'enable or disable Composio trigger-to-job workflows')
  .option('--deepgram-key <key>', 'optional Deepgram API key for realtime voice')
  .option('--voice-enabled <true|false>', 'enable or disable realtime voice')
  .option('--voice-listen-model <model>', 'Deepgram listen model, e.g. flux-general-en or flux-general-multi')
  .option('--voice-tts-model <model>', 'Deepgram Aura TTS model, e.g. aura-2-thalia-en')
  .option('--voice-language <language>', 'voice language, e.g. en or en-US')
  .option('--voice-input-device <device>', 'terminal microphone device override for ffmpeg')
  .option('--screenshot-model <model>', 'vision model for screenshot/camera analysis')
  .option('--file-roots <roots>', 'comma-separated extra safe roots for file tools')
  .option('--camera-device <device>', 'optional camera device override, e.g. "video=Integrated Camera"')
  .option('--install-camera-deps <true|false>', 'install ffmpeg for camera capture when missing')
  .option('--install-cloudflare-deps <true|false>', 'install cloudflared for job tunnels when missing')
  .description('Create or update a local .env file for ZilMate')
  .action(async (options: { path: string; force?: boolean; yes?: boolean; aiGatewayKey?: string; composioKey?: string; zilmateUserId?: string; tavilyKey?: string; redisUrl?: string; redisToken?: string; jobsEnabled?: string; qstashToken?: string; jobWebhookUrl?: string; jobWebhookSecret?: string; triggerWorkflowsEnabled?: string; deepgramKey?: string; voiceEnabled?: string; voiceListenModel?: string; voiceTtsModel?: string; voiceLanguage?: string; voiceInputDevice?: string; screenshotModel?: string; fileRoots?: string; cameraDevice?: string; installCameraDeps?: string; installCloudflareDeps?: string }) => {
    try {
      await runSetup({
        path: options.path,
        force: Boolean(options.force),
        yes: Boolean(options.yes),
        ...(options.aiGatewayKey !== undefined ? { aiGatewayKey: options.aiGatewayKey } : {}),
        ...(options.composioKey !== undefined ? { composioKey: options.composioKey } : {}),
        ...(options.zilmateUserId !== undefined ? { zilmateUserId: options.zilmateUserId } : {}),
        ...(options.tavilyKey !== undefined ? { tavilyKey: options.tavilyKey } : {}),
        ...(options.redisUrl !== undefined ? { redisUrl: options.redisUrl } : {}),
        ...(options.redisToken !== undefined ? { redisToken: options.redisToken } : {}),
        ...(options.jobsEnabled !== undefined ? { jobsEnabled: options.jobsEnabled } : {}),
        ...(options.qstashToken !== undefined ? { qstashToken: options.qstashToken } : {}),
        ...(options.jobWebhookUrl !== undefined ? { publicJobWebhookUrl: options.jobWebhookUrl } : {}),
        ...(options.jobWebhookSecret !== undefined ? { jobWebhookSecret: options.jobWebhookSecret } : {}),
        ...(options.triggerWorkflowsEnabled !== undefined ? { triggerWorkflowsEnabled: options.triggerWorkflowsEnabled } : {}),
        ...(options.deepgramKey !== undefined ? { deepgramApiKey: options.deepgramKey } : {}),
        ...(options.voiceEnabled !== undefined ? { voiceEnabled: options.voiceEnabled } : {}),
        ...(options.voiceListenModel !== undefined ? { voiceListenModel: options.voiceListenModel } : {}),
        ...(options.voiceTtsModel !== undefined ? { voiceTtsModel: options.voiceTtsModel } : {}),
        ...(options.voiceLanguage !== undefined ? { voiceLanguage: options.voiceLanguage } : {}),
        ...(options.voiceInputDevice !== undefined ? { voiceInputDevice: options.voiceInputDevice } : {}),
        ...(options.screenshotModel !== undefined ? { screenshotModel: options.screenshotModel } : {}),
        ...(options.fileRoots !== undefined ? { fileRoots: options.fileRoots } : {}),
        ...(options.cameraDevice !== undefined ? { cameraDevice: options.cameraDevice } : {}),
        ...(options.installCameraDeps !== undefined ? { installCameraDeps: options.installCameraDeps } : {}),
        ...(options.installCloudflareDeps !== undefined ? { installCloudflareDeps: options.installCloudflareDeps } : {}),
      });
    } catch (error) {
      printError(friendlyError(error));
      process.exitCode = 1;
    }
  });

const voice = program
  .command('voice')
  .description('Configure and run realtime ZilMate voice mode')
  .action(async () => {
    try {
      printVoiceConfig();
    } catch (error) {
      printError(friendlyError(error));
      process.exitCode = 1;
    }
  });

voice
  .command('setup')
  .option('-p, --path <file>', 'environment file to create or update', '.env')
  .option('-f, --force', 'skip the first update confirmation when the env file exists')
  .option('--deepgram-key <key>', 'Deepgram API key for realtime voice')
  .option('--voice-listen-model <model>', 'Deepgram listen model, e.g. flux-general-en or flux-general-multi')
  .option('--voice-tts-model <model>', 'Deepgram Aura TTS model, e.g. aura-2-thalia-en')
  .option('--voice-language <language>', 'voice language, e.g. en or en-US')
  .description('Turn on realtime voice with a focused guided setup')
  .action(async (options: { path: string; force?: boolean; deepgramKey?: string; voiceListenModel?: string; voiceTtsModel?: string; voiceLanguage?: string }) => {
    try {
      await runVoiceSetup({
        path: options.path,
        force: Boolean(options.force),
        ...(options.deepgramKey !== undefined ? { deepgramApiKey: options.deepgramKey } : {}),
        ...(options.voiceListenModel !== undefined ? { voiceListenModel: options.voiceListenModel } : {}),
        ...(options.voiceTtsModel !== undefined ? { voiceTtsModel: options.voiceTtsModel } : {}),
        ...(options.voiceLanguage !== undefined ? { voiceLanguage: options.voiceLanguage } : {}),
      });
    } catch (error) {
      printError(friendlyError(error));
      process.exitCode = 1;
    }
  });

voice
  .command('enable')
  .option('-p, --path <file>', 'environment file to update', '.env')
  .description('Enable realtime voice without opening .env')
  .action(async (options: { path: string }) => {
    try {
      await setVoiceEnabled(true, { path: options.path });
    } catch (error) {
      printError(friendlyError(error));
      process.exitCode = 1;
    }
  });

voice
  .command('disable')
  .option('-p, --path <file>', 'environment file to update', '.env')
  .description('Disable realtime voice without opening .env')
  .action(async (options: { path: string }) => {
    try {
      await setVoiceEnabled(false, { path: options.path });
    } catch (error) {
      printError(friendlyError(error));
      process.exitCode = 1;
    }
  });

voice
  .command('doctor')
  .description('Check Deepgram realtime voice readiness')
  .action(async () => {
    try {
      await runVoiceDoctor();
    } catch (error) {
      printError(friendlyError(error));
      process.exitCode = 1;
    }
  });

voice
  .command('config')
  .description('Show realtime voice configuration')
  .action(() => {
    try {
      printVoiceConfig();
    } catch (error) {
      printError(friendlyError(error));
      process.exitCode = 1;
    }
  });

voice
  .command('turn')
  .argument('<transcript...>', 'spoken user text to route through the ZilMate voice brain')
  .option('-s, --session <id>', 'persistent voice session id', 'default')
  .description('Test the ZilMate voice brain with a transcript')
  .action(async (transcript: string[], options: { session: string }) => {
    try {
      await runVoiceTurn(transcript.join(' '), options.session);
    } catch (error) {
      printError(friendlyError(error));
      process.exitCode = 1;
    }
  });

const camera = program
  .command('camera')
  .description('Diagnose and use the laptop camera for ZilMate desktop tools')
  .action(async () => {
    try {
      await runCameraDoctorCli();
    } catch (error) {
      printError(friendlyError(error));
      process.exitCode = 1;
    }
  });

camera
  .command('doctor')
  .description('Check camera readiness, OS support, ffmpeg, and default device candidates')
  .action(async () => {
    try {
      await runCameraDoctorCli();
    } catch (error) {
      printError(friendlyError(error));
      process.exitCode = 1;
    }
  });

camera
  .command('list')
  .description('List camera devices ZilMate can try')
  .action(async () => {
    try {
      await listCameraDevicesCli();
    } catch (error) {
      printError(friendlyError(error));
      process.exitCode = 1;
    }
  });

camera
  .command('capture')
  .option('--device <device>', 'camera input to use, e.g. "video=Integrated Camera" or /dev/video0')
  .description('Capture one still image from the laptop camera')
  .action(async (options: { device?: string }) => {
    try {
      await captureCameraCli(options);
    } catch (error) {
      printError(friendlyError(error));
      process.exitCode = 1;
    }
  });

voice
  .command('devices')
  .description('List terminal microphone devices for live voice')
  .action(async () => {
    try {
      await listVoiceDevices();
    } catch (error) {
      printError(friendlyError(error));
      process.exitCode = 1;
    }
  });

voice
  .command('live')
  .option('-s, --session <id>', 'persistent voice session id', 'default')
  .description('Start live terminal microphone voice mode')
  .action(async (options: { session: string }) => {
    try {
      const command = await runTerminalVoiceLive(options.session);
      if (command === 'talk') {
        await startInteractiveChat(options.session);
      }
    } catch (error) {
      printError(friendlyError(error));
      process.exitCode = 1;
    }
  });

voice
  .command('speak-test')
  .argument('[text...]', 'text to speak through Deepgram Aura and ffplay')
  .description('Test ZilMate speaker output without using the microphone')
  .action(async (text: string[]) => {
    try {
      await runVoiceSpeakTest(text.length > 0 ? text.join(' ') : undefined);
    } catch (error) {
      printError(friendlyError(error));
      process.exitCode = 1;
    }
  });

voice
  .command('agent-probe')
  .description('Open a Deepgram Voice Agent session without attaching microphone audio')
  .action(async () => {
    try {
      await runVoiceAgentProbe();
    } catch (error) {
      printError(friendlyError(error));
      process.exitCode = 1;
    }
  });

const jobs = program
  .command('jobs')
  .description('Manage ZilMate background jobs, schedules, and worker processing')
  .action(async () => {
    try {
      await listCliJobs({});
    } catch (error) {
      printError(friendlyError(error));
      process.exitCode = 1;
    }
  });

jobs
  .command('create')
  .argument('<task...>', 'job task to queue')
  .option('--schedule <schedule>', 'optional schedule, e.g. hourly, daily, every 15 minutes, cron:0 9 * * *')
  .option('--run-at <date>', 'optional first run date/time')
  .description('Queue a ZilMate background job')
  .action(async (task: string[], options: { schedule?: string; runAt?: string }) => {
    try {
      await createCliJob(task.join(' '), options);
    } catch (error) {
      printError(friendlyError(error));
      process.exitCode = 1;
    }
  });

jobs
  .command('list')
  .option('--status <status>', 'filter by queued, running, succeeded, failed, or cancelled')
  .option('-l, --limit <number>', 'maximum jobs to return', '25')
  .description('List ZilMate jobs')
  .action(async (options: { status?: string; limit?: string }) => {
    try {
      await listCliJobs(options);
    } catch (error) {
      printError(friendlyError(error));
      process.exitCode = 1;
    }
  });

jobs
  .command('status')
  .argument('<id>', 'job id')
  .description('Show one ZilMate job')
  .action(async (id: string) => {
    try {
      await showCliJob(id);
    } catch (error) {
      printError(friendlyError(error));
      process.exitCode = 1;
    }
  });

jobs
  .command('logs')
  .argument('<id>', 'job id')
  .description('Show logs for one ZilMate job')
  .action(async (id: string) => {
    try {
      await showCliJobLogs(id);
    } catch (error) {
      printError(friendlyError(error));
      process.exitCode = 1;
    }
  });

jobs
  .command('run')
  .argument('<id>', 'job id')
  .description('Run one ZilMate job now')
  .action(async (id: string) => {
    try {
      await runCliJob(id);
    } catch (error) {
      printError(friendlyError(error));
      process.exitCode = 1;
    }
  });

jobs
  .command('worker')
  .option('-i, --interval <seconds>', 'poll interval in seconds', '10')
  .option('--once', 'process due jobs once and exit')
  .option('--quiet', 'suppress worker status messages')
  .description('Start the local ZilMate job worker')
  .action(async (options: { interval?: string; once?: boolean; quiet?: boolean }) => {
    try {
      await startCliJobWorker(options);
    } catch (error) {
      printError(friendlyError(error));
      process.exitCode = 1;
    }
  });

jobs
  .command('listen')
  .option('-p, --port <number>', 'local webhook port', process.env.ZILMATE_WEBHOOK_PORT || '8787')
  .option('--tunnel', 'also start a Cloudflare quick tunnel (requires cloudflared)')
  .description('Run the QStash job webhook server (and optional Cloudflare tunnel)')
  .action(async (options: { port?: string; tunnel?: boolean }) => {
    try {
      await startCliJobListener({
        ...(options.port !== undefined ? { port: options.port } : {}),
        tunnel: Boolean(options.tunnel),
      });
    } catch (error) {
      printError(friendlyError(error));
      process.exitCode = 1;
    }
  });

jobs
  .command('cancel')
  .argument('<id>', 'job id')
  .description('Cancel one ZilMate job')
  .action(async (id: string) => {
    try {
      await cancelCliJob(id);
    } catch (error) {
      printError(friendlyError(error));
      process.exitCode = 1;
    }
  });

program
  .command('workspace')
  .description('ZilMate workspace (notebook, skills, outputs, logs)')
  .action(async () => {
    try {
      const layout = workspaceLayout();
      printJson({ root: layout.root, paths: layout });
    } catch (error) {
      printError(friendlyError(error));
      process.exitCode = 1;
    }
  });

program
  .command('workspace-init')
  .description('Create or repair the ZilMate workspace folder structure')
  .action(async () => {
    try {
      const layout = await initWorkspace();
      printJson({ ok: true, root: layout.root, paths: layout });
    } catch (error) {
      printError(friendlyError(error));
      process.exitCode = 1;
    }
  });

program
  .command('heal')
  .argument('[summary]', 'what happened this session')
  .option('-s, --session <id>', 'session id to load chat turns from', 'default')
  .option('--deep', 'run two-pass deep heal')
  .description('Review recent work, save learnings, and update notebook/knowledge graph')
  .action(async (summary: string | undefined, options: { session?: string; deep?: boolean }) => {
    try {
      requireGatewayAuth();
      const result = await runHeal({
        sessionSummary: summary?.trim() || 'Recent ZilMate session — capture durable learnings and any missed personal context.',
        sessionId: options.session || 'default',
        ...(options.deep ? { deep: true } : {}),
      });
      await printResult(result);
    } catch (error) {
      printError(friendlyError(error));
      process.exitCode = 1;
    }
  });

program
  .command('doctor')
  .option('--live', 'also run live Gateway and Composio checks')
  .option('-s, --session <id>', 'Composio/ZilMate session id for live checks', 'default')
  .option('--json', 'print JSON output')
  .description('Check local ZilMate config, keys, memory, Node, and optional live integrations')
  .action(async (options: { live?: boolean; session: string; json?: boolean }) => {
    try {
      const checks = await runDoctor({ live: Boolean(options.live), sessionId: options.session });
      if (options.json) {
        printJson(checks);
      } else {
        printDoctorChecks(checks);
      }
    } catch (error) {
      printError(friendlyError(error));
      process.exitCode = 1;
    }
  });

const envCommand = program
  .command('env')
  .description('Inspect ZilMate environment setup');

envCommand
  .command('check')
  .option('--live', 'also run live Gateway and Composio checks')
  .option('-s, --session <id>', 'Composio/ZilMate session id for live checks', 'default')
  .option('--json', 'print JSON output')
  .description('Alias for zilmate doctor focused on environment readiness')
  .action(async (options: { live?: boolean; session: string; json?: boolean }) => {
    try {
      const checks = await runDoctor({ live: Boolean(options.live), sessionId: options.session });
      if (options.json) {
        printJson(checks);
      } else {
        printDoctorChecks(checks);
      }
    } catch (error) {
      printError(friendlyError(error));
      process.exitCode = 1;
    }
  });

program
  .command('config')
  .description('Show sanitized ZilMate configuration without secrets')
  .action(async () => {
    try {
      printJson(await getResolvedConfigSummary());
    } catch (error) {
      printError(friendlyError(error));
      process.exitCode = 1;
    }
  });

program
  .command('remember')
  .argument('<note...>', 'memory text to save')
  .option('-t, --tag <tag...>', 'optional memory tags')
  .description('Save a durable long-term ZilMate memory')
  .action(async (note: string[], options: { tag?: string[] }) => {
    try {
      const memory = await remember(note.join(' '), options.tag ?? []);
      printJson(memory);
    } catch (error) {
      printError(friendlyError(error));
      process.exitCode = 1;
    }
  });

program
  .command('recall')
  .argument('[query...]', 'memory query; omitted means recent memories')
  .option('-l, --limit <number>', 'maximum memories to return', '8')
  .description('Recall durable long-term ZilMate memories')
  .action(async (query: string[] | undefined, options: { limit: string }) => {
    try {
      const limit = Number.parseInt(options.limit, 10);
      printJson(await recall((query ?? []).join(' '), Number.isFinite(limit) ? limit : 8));
    } catch (error) {
      printError(friendlyError(error));
      process.exitCode = 1;
    }
  });

program
  .command('forget')
  .argument('[id]', 'memory id to forget')
  .option('--all', 'forget all memories')
  .description('Forget one durable memory by id')
  .action(async (id: string | undefined, options: { all?: boolean }) => {
    try {
      if (options.all) {
        await clearMemories();
        printJson({ cleared: true });
        return;
      }
      if (!id) throw new Error('Pass a memory id, or use --all to clear every memory.');
      printJson({ id, deleted: await forget(id) });
    } catch (error) {
      printError(friendlyError(error));
      process.exitCode = 1;
    }
  });

const memoryCommand = program
  .command('memory')
  .description('Manage durable long-term ZilMate memory')
  .action(async () => {
    try {
      printMemoryTable(await listMemories());
    } catch (error) {
      printError(friendlyError(error));
      process.exitCode = 1;
    }
  });

memoryCommand
  .command('list')
  .description('List all durable long-term memories')
  .action(async () => {
    try {
      printMemoryTable(await listMemories());
    } catch (error) {
      printError(friendlyError(error));
      process.exitCode = 1;
    }
  });

const apps = program
  .command('apps')
  .description('Manage external app tooling through Composio')
  .action(async () => {
    try {
      printAppsStatus(await getComposioStatus());
    } catch (error) {
      printError(friendlyError(error));
      process.exitCode = 1;
    }
  });

apps
  .command('status')
  .option('-s, --session <id>', 'ZilMate chat session id', 'default')
  .description('Show Composio setup, user id, session, and toolkit connection status')
  .action(async (options: { session: string }) => {
    try {
      const status = await getComposioStatus(options.session);
      printAppsStatus(status);
    } catch (error) {
      printError(friendlyError(error));
      process.exitCode = 1;
    }
  });

const triggers = program
  .command('triggers')
  .description('Listen to and manage Composio trigger events');

triggers
  .command('types')
  .argument('[toolkit]', 'optional toolkit slug, e.g. github or gmail')
  .option('-l, --limit <number>', 'maximum trigger types to show', '25')
  .option('--json', 'print JSON output')
  .description('List available Composio trigger types')
  .action(async (toolkit: string | undefined, options: { limit?: string; json?: boolean }) => {
    try {
      await listTriggerTypes(toolkit, options);
    } catch (error) {
      printError(friendlyError(error));
      process.exitCode = 1;
    }
  });

triggers
  .command('info')
  .argument('<trigger>', 'trigger type slug, e.g. GITHUB_COMMIT_EVENT')
  .option('--json', 'print JSON output')
  .description('Show one Composio trigger type schema')
  .action(async (trigger: string, options: { json?: boolean }) => {
    try {
      await showTriggerType(trigger, options);
    } catch (error) {
      printError(friendlyError(error));
      process.exitCode = 1;
    }
  });

triggers
  .command('list')
  .option('-l, --limit <number>', 'maximum trigger instances to show', '25')
  .option('--show-disabled', 'include disabled trigger instances')
  .option('--json', 'print JSON output')
  .description('List active Composio trigger instances')
  .action(async (options: { limit?: string; showDisabled?: boolean; json?: boolean }) => {
    try {
      await listTriggers(options);
    } catch (error) {
      printError(friendlyError(error));
      process.exitCode = 1;
    }
  });

triggers
  .command('create')
  .argument('<trigger>', 'trigger type slug, e.g. GITHUB_COMMIT_EVENT')
  .option('--connected-account <id>', 'specific connected account id to use')
  .option('--config <json>', 'trigger config as a JSON object')
  .option('--dry-run', 'print the create payload without creating a trigger')
  .allowUnknownOption(true)
  .allowExcessArguments(true)
  .description('Create a Composio trigger instance; unknown --flags become trigger config')
  .action(async (trigger: string, options: { connectedAccount?: string; config?: string; dryRun?: boolean }, command: Command) => {
    try {
      const unknownArgs = command.args.filter((arg) => arg !== trigger);
      await createTrigger(trigger, options, unknownArgs);
    } catch (error) {
      printError(friendlyError(error));
      process.exitCode = 1;
    }
  });

triggers
  .command('listen')
  .option('--trigger <id>', 'filter by trigger instance id')
  .option('--trigger-slug <slug...>', 'filter by trigger type slug')
  .option('--toolkit <slug...>', 'filter by toolkit slug')
  .option('--connected-account <id>', 'filter by connected account id')
  .option('--trigger-data <value>', 'filter by trigger data')
  .option('--user-id <id>', 'filter by Composio user id')
  .option('--json', 'print full event JSON')
  .option('--once', 'exit after the first matching event')
  .description('Stream Composio trigger events into the terminal')
  .action(async (options: { trigger?: string; triggerSlug?: string[]; toolkit?: string[]; connectedAccount?: string; triggerData?: string; userId?: string; json?: boolean; once?: boolean }) => {
    try {
      await listenToTriggers(options);
    } catch (error) {
      printError(friendlyError(error));
      process.exitCode = 1;
    }
  });

program
  .command('models')
  .option('-p, --provider <provider>', 'filter models by provider or text, e.g. openai, google, gemini, anthropic')
  .option('-l, --limit <number>', 'models per page', '20')
  .option('--page <number>', 'page number', '1')
  .description('Browse available AI Gateway models')
  .action(async (options: { provider?: string; limit?: string; page?: string }) => {
    try {
      requireGatewayAuth();
      await printModelBrowser(options);
    } catch (error) {
      printError(friendlyError(error));
      process.exitCode = 1;
    }
  });

program
  .command('talk')
  .option('-s, --session <id>', 'persistent chat session id', 'default')
  .description('Start an interactive chat with the main manager agent')
  .action(async (options: { session: string }) => {
    try {
      await startInteractiveChat(options.session);
    } catch (error) {
      printError(friendlyError(error));
      process.exitCode = 1;
    }
  });

program
  .command('chat')
  .argument('<message...>', 'message to discuss')
  .description('One-shot natural dialogue about ZiloShift')
  .action(async (message: string[]) => {
    try {
      await runAgentText(createChatAgent, message.join(' '));
    } catch (error) {
      printError(friendlyError(error));
      process.exitCode = 1;
    }
  });

program
  .command('help')
  .argument('<question...>', 'quick-help question')
  .description('Fast troubleshooting and app guidance')
  .action(async (question: string[]) => {
    try {
      await runAgentText(createQuickHelpAgent, question.join(' '));
    } catch (error) {
      printError(friendlyError(error));
      process.exitCode = 1;
    }
  });

program
  .command('post')
  .argument('<prompt...>', 'post generation prompt')
  .description('Generate WhatsApp/status/social copy')
  .action(async (prompt: string[]) => {
    try {
      await runAgentText(createPostAgent, prompt.join(' '));
    } catch (error) {
      printError(friendlyError(error));
      process.exitCode = 1;
    }
  });

program
  .command('research')
  .argument('<query...>', 'research query')
  .description('Search docs/web and return sourced research')
  .action(async (query: string[]) => {
    try {
      await runAgentText(createDocsResearchAgent, query.join(' '));
    } catch (error) {
      printError(friendlyError(error));
      process.exitCode = 1;
    }
  });

program
  .command('image')
  .argument('<prompt...>', 'image prompt')
  .option('-m, --model <model>', 'image model: openai|chatgpt|gemini', 'openai')
  .option('--size <size>', 'image size for OpenAI, e.g. 1024x1024')
  .description('Generate an image and save it under outputs/images')
  .action(async (prompt: string[], options: { model: string; size?: string }) => {
    try {
      const result = await generateImageAsset(prompt.join(' '), {
        provider: options.model as 'openai' | 'chatgpt' | 'gemini' | 'google' | 'default',
        ...(isImageSize(options.size) ? { size: options.size } : {}),
      });
      await printResult(result);
    } catch (error) {
      printError(friendlyError(error));
      process.exitCode = 1;
    }
  });

program
  .command('swarm')
  .argument('<task...>', 'business task for the digital corporation swarm')
  .option('-s, --session <id>', 'swarm session id', 'default')
  .description('Route a high-level business objective to the Digital Corporation swarm')
  .action(async (task: string[], options: { session: string }) => {
    try {
      requireGatewayAuth();
      await runSwarmCli(task.join(' '), options);
    } catch (error) {
      printError(friendlyError(error));
      process.exitCode = 1;
    }
  });

program
  .command('manager')
  .argument('<prompt...>', 'manager orchestration prompt')
  .option('-s, --session <id>', 'persistent manager session id for Composio tools', 'default')
  .description('Route a one-shot task through the manager agent')
  .action(async (prompt: string[], options: { session: string }) => {
    try {
      requireGatewayAuth();
      await printResult(await runManager(prompt.join(' '), {
        progress: printProgress,
        sessionId: options.session,
        confirm: createTerminalConfirmation(),
      }));
    } catch (error) {
      printError(friendlyError(error));
      process.exitCode = 1;
    }
  });

program
  .command('ping')
  .description('Make a tiny Gateway text call to verify auth')
  .action(async () => {
    try {
      requireGatewayAuth();
      const result = await generateText({ model: models.help, prompt: 'Reply with exactly: ZilMate online' });
      await printResult(result.text);
    } catch (error) {
      printError(friendlyError(error));
      process.exitCode = 1;
    }
  });

if (process.argv.length <= 2) {
  await initWorkspace().catch(() => undefined);
  await startDefaultLauncher();
} else {
  await initWorkspace().catch(() => undefined);
  await program.parseAsync(process.argv).catch((error) => {
  printError(friendlyError(error));
  process.exitCode = 1;
  });
}




