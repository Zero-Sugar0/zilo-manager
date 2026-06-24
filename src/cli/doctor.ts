import { access, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { constants, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env, hasComposio, hasDeepgram, hasGatewayAuth, hasQStash, hasRedis, hasChatIntegration } from '../config/env.js';
import { getModelAvailability, models } from '../config/models.js';
import { getComposioStatus } from '../tools/composio.tool.js';
import { memoryBackendName } from '../memory/redis.js';
import { initWorkspace } from '../workspace/init.js';
import { workspaceLayout } from '../workspace/paths.js';
import { getLocalDataRoot } from '../memory/local-store.js';
import { cloudflareTunnelDoctor } from './tunnel.js';
import { skillsRegistryDoctor } from '../skills/registry.js';
import { checkDependency } from '../observability/doctor.js';

export type DoctorStatus = 'pass' | 'warn' | 'fail';

export type DoctorCheck = {
  name: string;
  status: DoctorStatus;
  detail: string;
};

const projectRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

async function packageVersion() {
  try {
    const raw = await readFile(path.join(projectRoot, 'package.json'), 'utf8');
    return (JSON.parse(raw) as { version?: string }).version || 'unknown';
  } catch {
    return 'unknown';
  }
}

async function writableMemoryFolder() {
  await initWorkspace();
  const folder = getLocalDataRoot();
  const probe = path.join(folder, `.doctor-${Date.now()}.tmp`);
  await mkdir(folder, { recursive: true });
  await writeFile(probe, 'ok', 'utf8');
  await access(probe, constants.R_OK | constants.W_OK);
  await unlink(probe);
  return folder;
}

export function getConfigSummary() {
  return {
    package: 'zilmate',
    version: null as string | null,
    node: process.versions.node,
    envFiles: {
      dotenv: existsSync('.env'),
      dotenvLocal: existsSync('.env.local'),
    },
    auth: {
      aiGateway: hasGatewayAuth(),
      composio: Boolean(env.composioApiKey),
      zilmateUserId: Boolean(env.zilmateUserId),
      tavily: Boolean(env.tavilyApiKey),
      redisUrl: Boolean(env.upstashRedisRestUrl),
      redisToken: Boolean(env.upstashRedisRestToken),
      jobs: env.zilmateJobsEnabled,
      qstash: Boolean(env.upstashQstashToken),
      jobWebhookUrl: Boolean(env.zilmatePublicJobWebhookUrl),
      triggerWorkflows: env.zilmateTriggerWorkflowsEnabled,
      voice: env.zilmateVoiceEnabled,
      deepgram: Boolean(env.deepgramApiKey),
      chatEnabled: env.chatIntegrationEnabled,
      slackToken: Boolean(env.slackBotToken),
      telegramToken: Boolean(env.telegramBotToken),
      imessageLocal: env.imessageLocal,
    },
    memory: {
      backend: memoryBackendName(),
    },
    models,
  };
}

export async function getResolvedConfigSummary() {
  return {
    ...getConfigSummary(),
    version: await packageVersion(),
  };
}

export async function runDoctor(options: { live?: boolean; sessionId?: string } = {}) {
  const checks: DoctorCheck[] = [];
  const major = Number(process.versions.node.split('.')[0] || '0');
  const version = await packageVersion();

  checks.push({
    name: 'Package',
    status: 'pass',
    detail: `zilmate ${version}`,
  });
  checks.push({
    name: 'Node',
    status: major >= 20 ? 'pass' : 'fail',
    detail: `Node ${process.versions.node}${major >= 20 ? '' : ' is too old; use Node 20+'}`,
  });
  checks.push({
    name: 'Env file',
    status: existsSync('.env') || existsSync('.env.local') ? 'pass' : 'warn',
    detail: existsSync('.env.local') ? '.env.local found' : existsSync('.env') ? '.env found' : 'No .env or .env.local found; run zilmate setup',
  });
  checks.push({
    name: 'AI Gateway',
    status: hasGatewayAuth() ? 'pass' : 'fail',
    detail: hasGatewayAuth() ? 'AI Gateway auth is configured' : 'Missing AI_GATEWAY_API_KEY or VERCEL_OIDC_TOKEN',
  });
  checks.push({
    name: 'Composio',
    status: hasComposio() ? 'pass' : env.composioApiKey || env.zilmateUserId ? 'warn' : 'warn',
    detail: hasComposio()
      ? 'COMPOSIO_API_KEY and ZILMATE_USER_ID are configured'
      : env.composioApiKey
        ? 'COMPOSIO_API_KEY is set but ZILMATE_USER_ID is missing; run zilmate setup'
        : 'Optional COMPOSIO_API_KEY is not configured',
  });
  checks.push({
    name: 'Tavily',
    status: env.tavilyApiKey ? 'pass' : 'warn',
    detail: env.tavilyApiKey ? 'Tavily web research is configured' : 'Optional TAVILY_API_KEY is not configured',
  });
  checks.push({
    name: 'Redis',
    status: hasRedis() ? 'pass' : env.upstashRedisRestUrl || env.upstashRedisRestToken ? 'fail' : 'warn',
    detail: hasRedis()
      ? 'Redis memory backend is configured'
      : env.upstashRedisRestUrl || env.upstashRedisRestToken
        ? 'Redis is partially configured; set both URL and token'
        : 'Redis not configured; using local file memory',
  });
  checks.push({
    name: 'Jobs',
    status: env.zilmateJobsEnabled ? 'pass' : 'warn',
    detail: env.zilmateJobsEnabled ? 'Background jobs are enabled' : 'Background jobs are disabled; set ZILMATE_JOBS_ENABLED=true',
  });
  checks.push({
    name: 'QStash',
    status: hasQStash() ? 'pass' : env.upstashQstashToken || env.zilmatePublicJobWebhookUrl ? 'fail' : 'warn',
    detail: hasQStash()
      ? 'QStash hosted scheduling is configured'
      : env.upstashQstashToken || env.zilmatePublicJobWebhookUrl
        ? 'QStash is partially configured; set token and public webhook URL'
        : 'QStash not configured; using local worker scheduling only',
  });
  checks.push({
    name: 'Trigger workflows',
    status: env.zilmateTriggerWorkflowsEnabled ? 'pass' : 'warn',
    detail: env.zilmateTriggerWorkflowsEnabled ? 'Composio trigger events will queue jobs' : 'Composio trigger workflows are disabled',
  });
  checks.push({
    name: 'Voice',
    status: env.zilmateVoiceEnabled && hasDeepgram() ? 'pass' : env.zilmateVoiceEnabled ? 'fail' : 'warn',
    detail: env.zilmateVoiceEnabled
      ? hasDeepgram()
        ? `Deepgram voice configured: ${env.zilmateVoiceListenModel} -> ${env.zilmateVoiceTtsModel}`
        : 'Voice is enabled but DEEPGRAM_API_KEY is missing'
      : 'Realtime voice is disabled',
  });

  checks.push({
    name: 'Chat Channels',
    status: env.chatIntegrationEnabled ? hasChatIntegration() ? 'pass' : 'fail' : 'warn',
    detail: env.chatIntegrationEnabled
      ? hasChatIntegration()
        ? `Chat enabled: ${env.slackBotToken ? 'Slack ' : ''}${env.telegramBotToken ? 'Telegram ' : ''}${env.imessageEnabled ? 'iMessage' : ''}`
        : 'Chat is enabled but no channel tokens are configured (Slack/Telegram/iMessage)'
      : 'External chat channels are disabled',
  });

  checks.push({
    name: 'Workspace',
    status: existsSync(workspaceLayout().root) ? 'pass' : 'warn',
    detail: existsSync(workspaceLayout().root)
      ? `ZilMate workspace at ${workspaceLayout().root}`
      : 'Workspace missing; run zilmate setup or zilmate workspace init',
  });

  const tunnel = await cloudflareTunnelDoctor();
  checks.push({
    name: tunnel.name,
    status: tunnel.ok ? 'pass' : 'warn',
    detail: tunnel.detail,
  });

  checks.push({
    name: 'Notebook',
    status: existsSync(workspaceLayout().notebook) ? 'pass' : 'warn',
    detail: existsSync(workspaceLayout().notebook)
      ? `Agent notebook at ${workspaceLayout().notebook}`
      : 'Run zilmate workspace-init to create notebook.md',
  });

  checks.push({
    name: 'Documents',
    status: 'pass',
    detail: 'PDF + slide deck generation available (pdfkit, pptxgenjs)',
  });

  const hasPlaywright = await checkDependency('npx playwright --version').catch(() => false);
  checks.push({
    name: 'Browser Automation',
    status: hasPlaywright ? 'pass' : 'warn',
    detail: hasPlaywright ? 'Playwright is available' : 'Run: npx playwright install',
  });

  const hasRembg = await checkDependency('rembg --version').catch(() => false);
  checks.push({
    name: 'Image Intelligence',
    status: hasRembg ? 'pass' : 'warn',
    detail: hasRembg ? 'rembg is available' : 'Run: pip install rembg',
  });

  const skillsRegistry = await skillsRegistryDoctor();
  checks.push({
    name: skillsRegistry.name,
    status: skillsRegistry.ok ? 'pass' : 'warn',
    detail: skillsRegistry.detail,
  });

  checks.push({
    name: 'Desktop notifications',
    status: 'pass',
    detail: process.platform === 'win32'
      ? 'Windows toast via PowerShell'
      : process.platform === 'darwin'
        ? 'macOS notification via osascript'
        : 'Linux notify-send / zenify fallback',
  });

  if (hasQStash()) {
    checks.push({
      name: 'QStash webhook',
      status: 'pass',
      detail: `Public URL configured. Run \`zilmate jobs listen --tunnel\` while laptop is on.`,
    });
  }

  checks.push({
    name: 'CLI UX',
    status: process.stdin.isTTY ? 'pass' : 'warn',
    detail: process.stdin.isTTY
      ? 'Interactive prompts, spinner, and arrow/space selection available'
      : 'Non-TTY mode — notifications and select menus may be limited',
  });

  try {
    const folder = await writableMemoryFolder();
    checks.push({ name: 'Memory folder', status: 'pass', detail: `Writable: ${folder}` });
  } catch (error) {
    checks.push({ name: 'Memory folder', status: 'fail', detail: error instanceof Error ? error.message : String(error) });
  }

  if (options.live) {
    if (hasGatewayAuth()) {
      try {
        const availability = await getModelAvailability();
        checks.push({
          name: 'Gateway live',
          status: availability.missing.length === 0 ? 'pass' : 'warn',
          detail: availability.missing.length === 0 ? `${availability.availableIds.length} models reported` : `Missing configured models: ${availability.missing.join(', ')}`,
        });
      } catch (error) {
        checks.push({ name: 'Gateway live', status: 'fail', detail: error instanceof Error ? error.message : String(error) });
      }
    }

    if (hasComposio()) {
      try {
        const status = await getComposioStatus(options.sessionId || 'default');
        checks.push({
          name: 'Composio live',
          status: status.configured && status.sessionId ? 'pass' : 'fail',
          detail: status.sessionId ? `Session ${status.sessionId}; ${status.toolkits.length} toolkits listed` : 'No Composio session returned',
        });
      } catch (error) {
        checks.push({ name: 'Composio live', status: 'fail', detail: error instanceof Error ? error.message : String(error) });
      }
    }
  }

  return checks;
}
