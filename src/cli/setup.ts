import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import chalk from 'chalk';
import { printPanel, printZilMateBanner } from './format.js';
import { runCameraDoctor } from '../tools/desktop.tool.js';
import { initWorkspace } from '../workspace/init.js';
import { workspaceLayout } from '../workspace/paths.js';
import { startCloudflareQuickTunnel } from './tunnel.js';
import { startJobWebhookServer } from '../jobs/webhook-server.js';

const execFileAsync = promisify(execFile);

type SetupOptions = {
  path?: string;
  force?: boolean;
  yes?: boolean;
  aiGatewayKey?: string;
  composioKey?: string;
  zilmateUserId?: string;
  tavilyKey?: string;
  redisUrl?: string;
  redisToken?: string;
  jobsEnabled?: string;
  qstashToken?: string;
  publicJobWebhookUrl?: string;
  jobWebhookSecret?: string;
  triggerWorkflowsEnabled?: string;
  deepgramApiKey?: string;
  voiceEnabled?: string;
  voiceListenModel?: string;
  voiceTtsModel?: string;
  voiceLanguage?: string;
  voiceInputDevice?: string;
  cameraDevice?: string;
  installCameraDeps?: string;
  installCloudflareDeps?: string;
  screenshotModel?: string;
  fileRoots?: string;
};

const defaults = {
  ZILO_MANAGER_MODEL: 'minimax/minimax-m3',
  ZILO_HELP_MODEL: 'alibaba/qwen3.7-plus',
  ZILO_POST_MODEL: 'alibaba/qwen3.7-plus',
  ZILO_IMAGE_DEFAULT_PROVIDER: 'openai',
  ZILO_IMAGE_OPENAI_MODEL: 'openai/gpt-image-2',
  ZILO_IMAGE_GEMINI_MODEL: 'google/gemini-3-pro-image',
  ZILO_IMAGE_MODEL: '',
  ZILMATE_VOICE_INPUT_DEVICE: '',
  ZILMATE_SCREENSHOT_MODEL: 'google/gemini-3.1-flash-lite',
  ZILMATE_CAMERA_DEVICE: '',
  ZILMATE_FILE_ROOTS: '',
};

function normalizeBooleanOption(value: string | undefined, fallback = false) {
  if (value === undefined) return fallback;
  const normalized = value.trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'y';
}

function newWebhookSecret() {
  return randomBytes(24).toString('base64url');
}

function parseEnvFile(content: string) {
  const values = new Map<string, string>();
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(trimmed);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (!key || rawValue === undefined) continue;
    values.set(key, rawValue.replace(/^"(.*)"$/, '$1'));
  }
  return values;
}

function formatEnvValue(value: string) {
  if (!value) return '';
  if (/^[A-Za-z0-9_./:@+=-]+$/.test(value)) return value;
  return JSON.stringify(value);
}

async function askRequiredSecret(rl: readline.Interface, prompt: string) {
  while (true) {
    const value = await rl.question(prompt);
    if (value.trim()) return value.trim();
    console.log(chalk.yellow('This value is required.'));
  }
}

async function askOptionalSecret(rl: readline.Interface, prompt: string) {
  const value = await rl.question(prompt);
  return value.trim();
}

async function askYesNo(rl: readline.Interface, prompt: string, defaultValue = false) {
  const suffix = defaultValue ? 'Y/n' : 'y/N';
  const answer = (await rl.question(`${prompt} (${suffix}) `)).trim().toLowerCase();
  if (!answer) return defaultValue;
  return answer === 'y' || answer === 'yes';
}

async function askSection(rl: readline.Interface, title: string, description: string, prompt: string, defaultValue = false) {
  console.log(chalk.cyan(`\n${title}`));
  console.log(chalk.gray(description));
  return askYesNo(rl, prompt, defaultValue);
}

async function commandExists(command: string) {
  const probe = process.platform === 'win32' ? 'where.exe' : 'which';
  try {
    await execFileAsync(probe, [command], { windowsHide: true, timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

function cameraInstallCommand(): { command: string; args: string[]; label: string } | undefined {
  if (process.platform === 'win32') {
    return {
      command: 'winget',
      args: ['install', '--id', 'Gyan.FFmpeg', '-e', '--accept-package-agreements', '--accept-source-agreements'],
      label: 'winget install --id Gyan.FFmpeg -e',
    };
  }
  if (process.platform === 'darwin') return { command: 'brew', args: ['install', 'ffmpeg'], label: 'brew install ffmpeg' };
  if (process.platform === 'linux') return { command: 'sudo', args: ['apt-get', 'install', '-y', 'ffmpeg'], label: 'sudo apt-get install -y ffmpeg' };
  return undefined;
}

async function installCameraDependency() {
  const install = cameraInstallCommand();
  if (!install) {
    console.log(chalk.yellow('No automatic ffmpeg installer is known for this OS. Install ffmpeg manually, then run `zilmate camera doctor`.'));
    return false;
  }
  if (process.platform === 'win32' && !(await commandExists('winget'))) {
    console.log(chalk.yellow('winget is not available. Install ffmpeg manually or with another package manager, then run `zilmate camera doctor`.'));
    return false;
  }
  if (process.platform === 'darwin' && !(await commandExists('brew'))) {
    console.log(chalk.yellow('Homebrew is not available. Install Homebrew or install ffmpeg manually, then run `zilmate camera doctor`.'));
    return false;
  }
  if (process.platform === 'linux' && !(await commandExists('sudo'))) {
    console.log(chalk.yellow(`Automatic install needs sudo. Run manually: ${install.label}`));
    return false;
  }

  console.log(chalk.gray(`Running: ${install.label}`));
  await new Promise<void>((resolve, reject) => {
    const child = spawn(install.command, install.args, { stdio: 'inherit', windowsHide: false });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${install.label} exited with code ${code}`));
    });
  });
  return commandExists('ffmpeg');
}

function cloudflareInstallCommand(): { command: string; args: string[]; label: string } | undefined {
  if (process.platform === 'win32') {
    return {
      command: 'winget',
      args: ['install', '--id', 'Cloudflare.cloudflared', '-e', '--accept-package-agreements', '--accept-source-agreements'],
      label: 'winget install --id Cloudflare.cloudflared -e',
    };
  }
  if (process.platform === 'darwin') return { command: 'brew', args: ['install', 'cloudflared'], label: 'brew install cloudflared' };
  if (process.platform === 'linux') return { command: 'sudo', args: ['apt-get', 'install', '-y', 'cloudflared'], label: 'sudo apt-get install -y cloudflared' };
  return undefined;
}

async function installCloudflareDependency() {
  const install = cloudflareInstallCommand();
  if (!install) {
    console.log(chalk.yellow('No automatic cloudflared installer is known for this OS. Install cloudflared manually, then run `zilmate jobs listen --tunnel`.'));
    return false;
  }
  if (process.platform === 'win32' && !(await commandExists('winget'))) {
    console.log(chalk.yellow('winget is not available. Install cloudflared manually or with another package manager.'));
    return false;
  }
  if (process.platform === 'darwin' && !(await commandExists('brew'))) {
    console.log(chalk.yellow('Homebrew is not available. Install Homebrew or install cloudflared manually.'));
    return false;
  }
  if (process.platform === 'linux' && !(await commandExists('sudo'))) {
    console.log(chalk.yellow(`Automatic install needs sudo. Run manually: ${install.label}`));
    return false;
  }

  console.log(chalk.gray(`Running: ${install.label}`));
  await new Promise<void>((resolve, reject) => {
    const child = spawn(install.command, install.args, { stdio: 'inherit', windowsHide: false });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${install.label} exited with code ${code}`));
    });
  });
  return commandExists('cloudflared');
}

function buildEnv(values: Map<string, string>) {
  const lines: Array<[string, string]> = [
    ['AI_GATEWAY_API_KEY', values.get('AI_GATEWAY_API_KEY') || ''],
    ['COMPOSIO_API_KEY', values.get('COMPOSIO_API_KEY') || ''],
    ['ZILMATE_USER_ID', values.get('ZILMATE_USER_ID') || ''],
    ['TAVILY_API_KEY', values.get('TAVILY_API_KEY') || ''],
    ['UPSTASH_REDIS_REST_URL', values.get('UPSTASH_REDIS_REST_URL') || ''],
    ['UPSTASH_REDIS_REST_TOKEN', values.get('UPSTASH_REDIS_REST_TOKEN') || ''],
    ['ZILMATE_JOBS_ENABLED', values.get('ZILMATE_JOBS_ENABLED') || 'false'],
    ['UPSTASH_QSTASH_TOKEN', values.get('UPSTASH_QSTASH_TOKEN') || ''],
    ['ZILMATE_PUBLIC_JOB_WEBHOOK_URL', values.get('ZILMATE_PUBLIC_JOB_WEBHOOK_URL') || ''],
    ['ZILMATE_JOB_WEBHOOK_SECRET', values.get('ZILMATE_JOB_WEBHOOK_SECRET') || ''],
    ['ZILMATE_TRIGGER_WORKFLOWS_ENABLED', values.get('ZILMATE_TRIGGER_WORKFLOWS_ENABLED') || 'false'],
    ['DEEPGRAM_API_KEY', values.get('DEEPGRAM_API_KEY') || ''],
    ['ZILMATE_VOICE_ENABLED', values.get('ZILMATE_VOICE_ENABLED') || 'false'],
    ['ZILMATE_VOICE_MODE', values.get('ZILMATE_VOICE_MODE') || 'agent'],
    ['ZILMATE_VOICE_LISTEN_MODEL', values.get('ZILMATE_VOICE_LISTEN_MODEL') || 'flux-general-en'],
    ['ZILMATE_VOICE_LISTEN_VERSION', values.get('ZILMATE_VOICE_LISTEN_VERSION') || 'v2'],
    ['ZILMATE_VOICE_TTS_MODEL', values.get('ZILMATE_VOICE_TTS_MODEL') || 'aura-2-thalia-en'],
    ['ZILMATE_VOICE_LANGUAGE', values.get('ZILMATE_VOICE_LANGUAGE') || 'en'],
    ['ZILMATE_VOICE_LANGUAGE_HINTS', values.get('ZILMATE_VOICE_LANGUAGE_HINTS') || ''],
    ['ZILMATE_VOICE_BARGE_IN', values.get('ZILMATE_VOICE_BARGE_IN') || 'true'],
    ['ZILMATE_VOICE_INPUT_DEVICE', values.get('ZILMATE_VOICE_INPUT_DEVICE') || defaults.ZILMATE_VOICE_INPUT_DEVICE],
    ['ZILMATE_SCREENSHOT_MODEL', values.get('ZILMATE_SCREENSHOT_MODEL') || defaults.ZILMATE_SCREENSHOT_MODEL],
    ['ZILMATE_CAMERA_DEVICE', values.get('ZILMATE_CAMERA_DEVICE') || defaults.ZILMATE_CAMERA_DEVICE],
    ['ZILMATE_FILE_ROOTS', values.get('ZILMATE_FILE_ROOTS') || defaults.ZILMATE_FILE_ROOTS],
    ['ZILMATE_WORKSPACE', values.get('ZILMATE_WORKSPACE') || ''],
    ['ZILMATE_WEBHOOK_PORT', values.get('ZILMATE_WEBHOOK_PORT') || '8787'],
    ['ZILO_MANAGER_MODEL', values.get('ZILO_MANAGER_MODEL') || defaults.ZILO_MANAGER_MODEL],
    ['ZILO_HELP_MODEL', values.get('ZILO_HELP_MODEL') || defaults.ZILO_HELP_MODEL],
    ['ZILO_POST_MODEL', values.get('ZILO_POST_MODEL') || defaults.ZILO_POST_MODEL],
    ['ZILO_IMAGE_DEFAULT_PROVIDER', values.get('ZILO_IMAGE_DEFAULT_PROVIDER') || defaults.ZILO_IMAGE_DEFAULT_PROVIDER],
    ['ZILO_IMAGE_OPENAI_MODEL', values.get('ZILO_IMAGE_OPENAI_MODEL') || defaults.ZILO_IMAGE_OPENAI_MODEL],
    ['ZILO_IMAGE_GEMINI_MODEL', values.get('ZILO_IMAGE_GEMINI_MODEL') || defaults.ZILO_IMAGE_GEMINI_MODEL],
    ['ZILO_IMAGE_MODEL', values.get('ZILO_IMAGE_MODEL') || defaults.ZILO_IMAGE_MODEL],
  ];

  return `${lines.map(([key, value]) => `${key}=${formatEnvValue(value)}`).join('\n')}\n`;
}

function printSetupPrep() {
  printPanel('Before setup starts', [
    ['Required', 'AI Gateway key'],
    ['Apps/tools', 'Composio key if you want Gmail, Slack, GitHub, Notion, etc.'],
    ['Web research', 'Tavily key if you want live web research'],
    ['Memory/jobs', 'Upstash Redis keys if you want cloud-backed storage'],
    ['Hosted schedules', 'QStash token; optional Cloudflare tunnel for public webhook'],
    ['Voice', 'Deepgram key if you want realtime voice'],
    ['Camera', 'ffmpeg if you want laptop camera capture'],
  ]);
  console.log(chalk.gray('You can skip any optional section and run setup again later.'));
}

async function readEnvValues(envPath: string) {
  return existsSync(envPath) ? parseEnvFile(await readFile(envPath, 'utf8')) : new Map<string, string>();
}

async function writeEnvValues(envPath: string, values: Map<string, string>, options: { merge?: boolean; touchedKeys?: Set<string> } = {}) {
  const disk = await readEnvValues(envPath);
  const merged = new Map(disk);

  if (options.merge) {
    for (const [key, value] of values) {
      const onDisk = merged.get(key);
      const touched = options.touchedKeys?.has(key);
      if (touched) {
        if (value !== undefined) merged.set(key, value);
      } else if (!onDisk || onDisk.trim() === '') {
        merged.set(key, value);
      }
    }
  } else {
    for (const [key, value] of values) merged.set(key, value);
  }

  for (const [key, value] of Object.entries(defaults)) {
    if (!merged.has(key) || merged.get(key)?.trim() === '') merged.set(key, value);
  }

  await writeFile(envPath, buildEnv(merged), 'utf8');
}

function envHasValue(values: Map<string, string>, key: string) {
  const value = values.get(key);
  return Boolean(value && value.trim() !== '');
}

async function configureCloudflareTunnelSection(rl: readline.Interface, values: Map<string, string>) {
  console.log(chalk.cyan('\nCloudflare quick tunnel'));
  console.log(chalk.gray('QStash hosted schedules need a public HTTPS webhook. cloudflared creates a free quick tunnel to your laptop.'));
  console.log(chalk.gray('Install: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/'));
  console.log(chalk.gray('While your laptop is on, keep the tunnel alive with: zilmate jobs listen --tunnel'));
  let hasCloudflared = await commandExists('cloudflared');
  if (!hasCloudflared) {
    if (await askYesNo(rl, 'cloudflared is missing. Install Cloudflare tunnel dependency now?', false)) {
      try {
        hasCloudflared = await installCloudflareDependency();
        console.log(hasCloudflared ? chalk.green('cloudflared is ready.') : chalk.yellow('cloudflared was not detected after install.'));
      } catch (error) {
        console.log(chalk.yellow(error instanceof Error ? error.message : String(error)));
      }
    }
  }

  if (!hasCloudflared) {
    console.log(chalk.yellow('cloudflared not found on PATH. Install it, or paste ZILMATE_PUBLIC_JOB_WEBHOOK_URL manually.'));
    return;
  }

  if (envHasValue(values, 'ZILMATE_PUBLIC_JOB_WEBHOOK_URL')) {
    console.log(chalk.green(`Existing webhook: ${values.get('ZILMATE_PUBLIC_JOB_WEBHOOK_URL')}`));
    if (!await askYesNo(rl, 'Create a new Cloudflare quick tunnel URL?', false)) return;
  }
  await maybeCreateCloudflareWebhook(rl, values);
}

async function maybeCreateCloudflareWebhook(rl: readline.Interface, values: Map<string, string>) {
  let hasCloudflared = await commandExists('cloudflared');
  if (!hasCloudflared) {
    if (await askYesNo(rl, 'cloudflared is missing. Install Cloudflare tunnel dependency now?', false)) {
      try {
        hasCloudflared = await installCloudflareDependency();
        console.log(hasCloudflared ? chalk.green('cloudflared is ready.') : chalk.yellow('cloudflared was not detected after install.'));
      } catch (error) {
        console.log(chalk.yellow(error instanceof Error ? error.message : String(error)));
      }
    }
  }

  if (!hasCloudflared) {
    console.log(chalk.yellow('cloudflared not found. Install it to auto-create a public webhook URL, or enter ZILMATE_PUBLIC_JOB_WEBHOOK_URL manually.'));
    return;
  }
  const createTunnel = await askYesNo(rl, 'Create a Cloudflare quick tunnel for the job webhook now? (requires cloudflared)', false);
  if (!createTunnel) return;

  const port = Number.parseInt(values.get('ZILMATE_WEBHOOK_PORT') || '8787', 10) || 8787;
  console.log(chalk.gray(`Starting local webhook on port ${port} and Cloudflare tunnel...`));
  const server = await startJobWebhookServer(port);
  try {
    const tunnel = await startCloudflareQuickTunnel(server.url);
    const webhookUrl = `${tunnel.url.replace(/\/$/, '')}/jobs/webhook`;
    values.set('ZILMATE_PUBLIC_JOB_WEBHOOK_URL', webhookUrl);
    values.set('ZILMATE_WEBHOOK_PORT', String(port));
    console.log(chalk.green(`Public webhook URL: ${webhookUrl}`));
    console.log(chalk.yellow('Quick tunnels change when restarted. Run `zilmate jobs listen --tunnel` while your laptop is on to keep QStash reachable.'));
  } finally {
    await server.close();
  }
}

export async function runSetup(options: SetupOptions = {}) {
  const envPath = options.path || '.env';
  const existing = await readEnvValues(envPath);
  const rl = readline.createInterface({ input, output });
  const touchedKeys = new Set<string>();
  const mergeMode = existing.size > 0 && !options.force;

  try {
    printZilMateBanner('Setup');
    console.log(chalk.gray(`Config file: ${envPath}`));
    if (mergeMode) {
      console.log(chalk.green('Merge mode: existing .env values are preserved. Only missing keys will be added.'));
      console.log(chalk.gray('Use --force to reconfigure all sections, or answer yes when prompted to replace a specific key.'));
    } else {
      console.log(chalk.gray('Only AI Gateway is required. Everything else can be skipped, enabled, disabled, or changed later.'));
    }
    if (!options.yes) printSetupPrep();

    const values = new Map(existing);
    const layout = await initWorkspace();
    if (!values.get('ZILMATE_WORKSPACE')) {
      values.set('ZILMATE_WORKSPACE', layout.root);
      touchedKeys.add('ZILMATE_WORKSPACE');
    }
    console.log(chalk.gray(`ZilMate workspace: ${layout.root}`));
    if (options.aiGatewayKey) values.set('AI_GATEWAY_API_KEY', options.aiGatewayKey);
    if (options.composioKey !== undefined) values.set('COMPOSIO_API_KEY', options.composioKey);
    if (options.zilmateUserId !== undefined) values.set('ZILMATE_USER_ID', options.zilmateUserId);
    if (options.tavilyKey !== undefined) values.set('TAVILY_API_KEY', options.tavilyKey);
    if (options.redisUrl !== undefined) values.set('UPSTASH_REDIS_REST_URL', options.redisUrl);
    if (options.redisToken !== undefined) values.set('UPSTASH_REDIS_REST_TOKEN', options.redisToken);
    if (options.jobsEnabled !== undefined) values.set('ZILMATE_JOBS_ENABLED', normalizeBooleanOption(options.jobsEnabled) ? 'true' : 'false');
    if (options.qstashToken !== undefined) values.set('UPSTASH_QSTASH_TOKEN', options.qstashToken);
    if (options.publicJobWebhookUrl !== undefined) values.set('ZILMATE_PUBLIC_JOB_WEBHOOK_URL', options.publicJobWebhookUrl);
    if (options.jobWebhookSecret !== undefined) values.set('ZILMATE_JOB_WEBHOOK_SECRET', options.jobWebhookSecret);
    if (options.triggerWorkflowsEnabled !== undefined) values.set('ZILMATE_TRIGGER_WORKFLOWS_ENABLED', normalizeBooleanOption(options.triggerWorkflowsEnabled) ? 'true' : 'false');
    if (options.deepgramApiKey !== undefined) values.set('DEEPGRAM_API_KEY', options.deepgramApiKey);
    if (options.voiceEnabled !== undefined) values.set('ZILMATE_VOICE_ENABLED', normalizeBooleanOption(options.voiceEnabled) ? 'true' : 'false');
    if (options.voiceListenModel !== undefined) {
      values.set('ZILMATE_VOICE_LISTEN_MODEL', options.voiceListenModel);
      values.set('ZILMATE_VOICE_LISTEN_VERSION', options.voiceListenModel.startsWith('flux-') ? 'v2' : 'v1');
    }
    if (options.voiceTtsModel !== undefined) values.set('ZILMATE_VOICE_TTS_MODEL', options.voiceTtsModel);
    if (options.voiceLanguage !== undefined) values.set('ZILMATE_VOICE_LANGUAGE', options.voiceLanguage);
    if (options.voiceInputDevice !== undefined) values.set('ZILMATE_VOICE_INPUT_DEVICE', options.voiceInputDevice);
    if (options.cameraDevice !== undefined) values.set('ZILMATE_CAMERA_DEVICE', options.cameraDevice);
    if (options.screenshotModel !== undefined) values.set('ZILMATE_SCREENSHOT_MODEL', options.screenshotModel);
    if (options.fileRoots !== undefined) values.set('ZILMATE_FILE_ROOTS', options.fileRoots);

    const installCloudflareDeps = options.installCloudflareDeps === undefined ? undefined : normalizeBooleanOption(options.installCloudflareDeps);
    if (installCloudflareDeps && !(await commandExists('cloudflared'))) {
      await installCloudflareDependency();
    }

    const currentGatewayKey = values.get('AI_GATEWAY_API_KEY');
    if (options.aiGatewayKey) {
      values.set('AI_GATEWAY_API_KEY', options.aiGatewayKey);
    } else if (!currentGatewayKey && options.yes) {
      throw new Error('AI_GATEWAY_API_KEY is required. Pass --ai-gateway-key or run setup interactively.');
    } else if (currentGatewayKey && !options.yes) {
      if (!mergeMode || await askYesNo(rl, 'AI_GATEWAY_API_KEY already exists. Replace it?', false)) {
        values.set('AI_GATEWAY_API_KEY', await askRequiredSecret(rl, 'AI_GATEWAY_API_KEY: '));
        touchedKeys.add('AI_GATEWAY_API_KEY');
      }
    } else if (!currentGatewayKey) {
      values.set('AI_GATEWAY_API_KEY', await askRequiredSecret(rl, 'AI_GATEWAY_API_KEY: '));
      touchedKeys.add('AI_GATEWAY_API_KEY');
    }

    if (!values.get('ZILMATE_USER_ID')) {
      values.set('ZILMATE_USER_ID', `zilmate-${randomUUID()}`);
    }

    if (!options.yes && options.composioKey === undefined && await askSection(
      rl,
      'Composio app tools',
      'Connectors let ZilMate use apps like Gmail, Slack, GitHub, Notion, Supabase, Stripe, Linear, Discord, and more through Composio.',
      'Enable Composio app tools?',
      Boolean(values.get('COMPOSIO_API_KEY')),
    )) {
      const composioKey = await askOptionalSecret(rl, 'COMPOSIO_API_KEY (blank to skip): ');
      values.set('COMPOSIO_API_KEY', composioKey);
    } else if (!options.yes && options.composioKey === undefined) {
      values.set('COMPOSIO_API_KEY', '');
    }

    if (!options.yes && options.tavilyKey === undefined && await askSection(
      rl,
      'Web research',
      'Tavily enables live web search, extraction, crawling, mapping, and deeper research when local knowledge is not enough.',
      'Enable Tavily web research?',
      Boolean(values.get('TAVILY_API_KEY')),
    )) {
      const tavilyKey = await askOptionalSecret(rl, 'TAVILY_API_KEY (blank to skip): ');
      values.set('TAVILY_API_KEY', tavilyKey);
    } else if (!options.yes && options.tavilyKey === undefined) {
      values.set('TAVILY_API_KEY', '');
    }

    if (!options.yes && options.redisUrl === undefined && options.redisToken === undefined && await askSection(
      rl,
      'Cloud memory and job storage',
      'Upstash Redis makes memory, chat history, Composio sessions, and job records portable across hosted/server environments. Without it, ZilMate uses local files.',
      'Enable Upstash Redis memory/job storage?',
      Boolean(values.get('UPSTASH_REDIS_REST_URL') && values.get('UPSTASH_REDIS_REST_TOKEN')),
    )) {
      values.set('UPSTASH_REDIS_REST_URL', (await rl.question('UPSTASH_REDIS_REST_URL: ')).trim());
      values.set('UPSTASH_REDIS_REST_TOKEN', await askOptionalSecret(rl, 'UPSTASH_REDIS_REST_TOKEN: '));
    } else if (!options.yes && options.redisUrl === undefined && options.redisToken === undefined) {
      values.set('UPSTASH_REDIS_REST_URL', '');
      values.set('UPSTASH_REDIS_REST_TOKEN', '');
    }

    if (!options.yes && options.jobsEnabled === undefined) {
      const enableJobs = await askSection(
        rl,
        'Background jobs',
        'Local jobs keep running after chat closes while `zilmate jobs worker` is open. They stop if the laptop sleeps or shuts down.',
        'Enable local background jobs and schedules?',
        values.get('ZILMATE_JOBS_ENABLED') === 'true',
      );
      values.set('ZILMATE_JOBS_ENABLED', enableJobs ? 'true' : 'false');
    } else if (!values.has('ZILMATE_JOBS_ENABLED')) {
      values.set('ZILMATE_JOBS_ENABLED', 'false');
    }

    if (!options.yes && values.get('ZILMATE_JOBS_ENABLED') === 'true' && !envHasValue(values, 'ZILMATE_PUBLIC_JOB_WEBHOOK_URL')) {
      if (await askYesNo(rl, 'Configure Cloudflare quick tunnel for job webhooks now?', false)) {
        await configureCloudflareTunnelSection(rl, values);
      }
    }

    if (!options.yes && options.qstashToken === undefined) {
      if (await askSection(
        rl,
        'Hosted schedules',
        'Use QStash only when you have a hosted public webhook. This is what allows schedules to fire while your laptop is closed.',
        'Enable Upstash QStash hosted schedules?',
        Boolean(values.get('UPSTASH_QSTASH_TOKEN')),
      )) {
        values.set('UPSTASH_QSTASH_TOKEN', await askOptionalSecret(rl, 'UPSTASH_QSTASH_TOKEN (blank to skip): '));
        const existingWebhook = values.get('ZILMATE_PUBLIC_JOB_WEBHOOK_URL');
        if (!existingWebhook) {
          await configureCloudflareTunnelSection(rl, values);
        }
        if (!values.get('ZILMATE_PUBLIC_JOB_WEBHOOK_URL')) {
          values.set('ZILMATE_PUBLIC_JOB_WEBHOOK_URL', (await rl.question('ZILMATE_PUBLIC_JOB_WEBHOOK_URL (blank for local only): ')).trim());
        }
        const existingSecret = values.get('ZILMATE_JOB_WEBHOOK_SECRET');
        const secret = await askOptionalSecret(rl, `ZILMATE_JOB_WEBHOOK_SECRET (blank to ${existingSecret ? 'keep existing' : 'auto-generate'}): `);
        values.set('ZILMATE_JOB_WEBHOOK_SECRET', secret || existingSecret || newWebhookSecret());
      } else {
        values.set('UPSTASH_QSTASH_TOKEN', '');
        values.set('ZILMATE_PUBLIC_JOB_WEBHOOK_URL', '');
      }
    }

    if (!options.yes && options.triggerWorkflowsEnabled === undefined) {
      console.log(chalk.cyan('\nComposio trigger workflows'));
      console.log(chalk.gray('When enabled, Composio trigger events can queue ZilMate jobs for Gmail, GitHub, Slack, calendar-style events, and more.'));
      const canEnableTriggers = Boolean(values.get('COMPOSIO_API_KEY'));
      if (!canEnableTriggers) {
        console.log(chalk.yellow('Skipping trigger workflows because Composio is not configured.'));
        values.set('ZILMATE_TRIGGER_WORKFLOWS_ENABLED', 'false');
      } else if (await askYesNo(rl, 'Enable Composio trigger-to-job workflows?', values.get('ZILMATE_TRIGGER_WORKFLOWS_ENABLED') === 'true')) {
        values.set('ZILMATE_TRIGGER_WORKFLOWS_ENABLED', 'true');
        if (values.get('ZILMATE_JOBS_ENABLED') !== 'true') {
          console.log(chalk.yellow('Trigger workflows need jobs, so background jobs were enabled.'));
          values.set('ZILMATE_JOBS_ENABLED', 'true');
        }
      } else {
        values.set('ZILMATE_TRIGGER_WORKFLOWS_ENABLED', 'false');
      }
    } else if (!values.has('ZILMATE_TRIGGER_WORKFLOWS_ENABLED')) {
      values.set('ZILMATE_TRIGGER_WORKFLOWS_ENABLED', 'false');
    }

    if (!options.yes && options.voiceEnabled === undefined) {
      const enableVoice = await askSection(
        rl,
        'Realtime voice',
        'Voice mode uses Deepgram Flux V2 for listening/end-of-turn, ZilMate manager/tools for thinking, and Aura-2 for spoken replies. It can be skipped.',
        'Enable realtime voice mode?',
        values.get('ZILMATE_VOICE_ENABLED') === 'true',
      );
      values.set('ZILMATE_VOICE_ENABLED', enableVoice ? 'true' : 'false');
      if (enableVoice) {
        const deepgramKey = options.deepgramApiKey ?? await askOptionalSecret(rl, 'DEEPGRAM_API_KEY (blank to configure later): ');
        if (deepgramKey) values.set('DEEPGRAM_API_KEY', deepgramKey);
        const listenModel = (await rl.question(`Listen model (${values.get('ZILMATE_VOICE_LISTEN_MODEL') || 'flux-general-en'}): `)).trim();
        if (listenModel) {
          values.set('ZILMATE_VOICE_LISTEN_MODEL', listenModel);
          values.set('ZILMATE_VOICE_LISTEN_VERSION', listenModel.startsWith('flux-') ? 'v2' : 'v1');
        } else if (!values.get('ZILMATE_VOICE_LISTEN_MODEL')) {
          values.set('ZILMATE_VOICE_LISTEN_MODEL', 'flux-general-en');
          values.set('ZILMATE_VOICE_LISTEN_VERSION', 'v2');
        }
        const ttsModel = (await rl.question(`TTS voice (${values.get('ZILMATE_VOICE_TTS_MODEL') || 'aura-2-thalia-en'}): `)).trim();
        if (ttsModel) values.set('ZILMATE_VOICE_TTS_MODEL', ttsModel);
        const language = (await rl.question(`Language (${values.get('ZILMATE_VOICE_LANGUAGE') || 'en'}): `)).trim();
        if (language) values.set('ZILMATE_VOICE_LANGUAGE', language);
        values.set('ZILMATE_VOICE_MODE', 'agent');
        values.set('ZILMATE_VOICE_BARGE_IN', 'true');
        const currentInputDevice = values.get('ZILMATE_VOICE_INPUT_DEVICE') || '';
        if (await askYesNo(rl, 'Set a terminal microphone input device?', Boolean(currentInputDevice))) {
          const voiceInputDevice = (await rl.question(`ZILMATE_VOICE_INPUT_DEVICE${currentInputDevice ? ` (${currentInputDevice})` : ' (blank for default mic)'}: `)).trim();
          values.set('ZILMATE_VOICE_INPUT_DEVICE', voiceInputDevice || currentInputDevice);
        }
      } else {
        console.log(chalk.gray('Voice disabled. Run `zilmate voice setup` or `zilmate voice enable` when you want it.'));
      }
    } else if (!values.has('ZILMATE_VOICE_ENABLED')) {
      values.set('ZILMATE_VOICE_ENABLED', 'false');
    }

    if (!values.get('ZILMATE_SCREENSHOT_MODEL')) values.set('ZILMATE_SCREENSHOT_MODEL', defaults.ZILMATE_SCREENSHOT_MODEL);
    if (!values.has('ZILMATE_CAMERA_DEVICE')) values.set('ZILMATE_CAMERA_DEVICE', '');
    if (!values.has('ZILMATE_FILE_ROOTS')) values.set('ZILMATE_FILE_ROOTS', '');

    if (!options.yes && options.fileRoots === undefined) {
      if (await askSection(
        rl,
        'Local file tools',
        'File tools let ZilMate search, read, summarize, create, move, copy, and rename files inside approved roots. Writes still ask for approval.',
        'Configure extra file access roots?',
        Boolean(values.get('ZILMATE_FILE_ROOTS')),
      )) {
        const currentRoots = values.get('ZILMATE_FILE_ROOTS') || '';
        const roots = (await rl.question(`ZILMATE_FILE_ROOTS comma-separated${currentRoots ? ` (${currentRoots})` : ' (blank for current folder only)'}: `)).trim();
        values.set('ZILMATE_FILE_ROOTS', roots || currentRoots);
      }
    }

    if (!options.yes && options.screenshotModel === undefined) {
      if (await askSection(
        rl,
        'Screen and photo understanding',
        'ZilMate uses a vision model to describe screenshots and camera photos. The default is Gemini 3.1 Flash Lite through the AI Gateway.',
        'Use the default screenshot/photo vision model?',
        true,
      )) {
        values.set('ZILMATE_SCREENSHOT_MODEL', values.get('ZILMATE_SCREENSHOT_MODEL') || defaults.ZILMATE_SCREENSHOT_MODEL);
      } else {
        const model = (await rl.question(`ZILMATE_SCREENSHOT_MODEL (${values.get('ZILMATE_SCREENSHOT_MODEL') || defaults.ZILMATE_SCREENSHOT_MODEL}): `)).trim();
        values.set('ZILMATE_SCREENSHOT_MODEL', model || values.get('ZILMATE_SCREENSHOT_MODEL') || defaults.ZILMATE_SCREENSHOT_MODEL);
      }
    }

    const installCameraDeps = options.installCameraDeps === undefined ? undefined : normalizeBooleanOption(options.installCameraDeps);
    if (!options.yes && installCameraDeps === undefined) {
      console.log(chalk.cyan('\nDesktop camera'));
      console.log(chalk.gray('Screenshots and clipboard use built-in OS tools. Camera capture needs ffmpeg so ZilMate can grab a still photo reliably.'));
      const hasFfmpeg = await commandExists('ffmpeg');
      if (hasFfmpeg) {
        console.log(chalk.green('ffmpeg is already available.'));
      } else if (await askYesNo(rl, 'ffmpeg is missing. Install camera dependency now?', false)) {
        try {
          const installed = await installCameraDependency();
          console.log(installed ? chalk.green('ffmpeg is ready.') : chalk.yellow('ffmpeg was not detected after install. Run `zilmate camera doctor` after checking PATH.'));
        } catch (error) {
          console.log(chalk.yellow(error instanceof Error ? error.message : String(error)));
          console.log(chalk.gray('Setup will continue. You can install ffmpeg later and run `zilmate camera doctor`.'));
        }
      }

      const currentDevice = values.get('ZILMATE_CAMERA_DEVICE') || '';
      if (await askYesNo(rl, 'Set a specific camera device now?', Boolean(currentDevice))) {
        const cameraDevice = (await rl.question(`Camera device${currentDevice ? ` (${currentDevice})` : ' (blank for auto-detect)'}: `)).trim();
        values.set('ZILMATE_CAMERA_DEVICE', cameraDevice || currentDevice);
      }

      const checks = await runCameraDoctor();
      console.log(chalk.gray(`Camera check: ${checks.map((check) => `${check.name} ${check.status}`).join(', ')}`));
    } else if (installCameraDeps) {
      if (!(await commandExists('ffmpeg'))) await installCameraDependency();
    }

    await writeEnvValues(envPath, values, { merge: mergeMode, touchedKeys });
    console.log(chalk.green(`Saved ${envPath}.`));
    printPanel('Setup summary', [
      ['Gateway', values.get('AI_GATEWAY_API_KEY') ? 'configured' : 'missing'],
      ['Composio', values.get('COMPOSIO_API_KEY') ? 'configured' : 'skipped'],
      ['Tavily', values.get('TAVILY_API_KEY') ? 'configured' : 'skipped'],
      ['Redis', values.get('UPSTASH_REDIS_REST_URL') && values.get('UPSTASH_REDIS_REST_TOKEN') ? 'configured' : 'local fallback'],
      ['Jobs', values.get('ZILMATE_JOBS_ENABLED') === 'true' ? 'enabled' : 'disabled'],
      ['QStash', values.get('UPSTASH_QSTASH_TOKEN') && values.get('ZILMATE_PUBLIC_JOB_WEBHOOK_URL') ? 'configured' : 'local schedules only'],
      ['Workspace', values.get('ZILMATE_WORKSPACE') || workspaceLayout().root],
      ['Trigger workflows', values.get('ZILMATE_TRIGGER_WORKFLOWS_ENABLED') === 'true' ? 'enabled' : 'disabled'],
      ['Voice', values.get('ZILMATE_VOICE_ENABLED') === 'true' ? values.get('DEEPGRAM_API_KEY') ? 'enabled' : 'enabled, missing Deepgram key' : 'disabled'],
      ['Camera', await commandExists('ffmpeg') ? 'ready' : 'needs ffmpeg'],
      ['Tunnel', await commandExists('cloudflared') ? 'ready' : 'needs cloudflared'],
    ]);
    console.log(chalk.gray('\nNext steps:'));
    console.log(chalk.gray('  zilmate ping'));
    console.log(chalk.gray('  zilmate doctor'));
    if (values.get('ZILMATE_JOBS_ENABLED') === 'true') {
      console.log(chalk.gray('  zilmate jobs worker'));
      if (values.get('UPSTASH_QSTASH_TOKEN')) {
        console.log(chalk.gray('  zilmate jobs listen --tunnel'));
      }
    }
    if (values.get('COMPOSIO_API_KEY')) {
      console.log(chalk.gray('  zilmate apps status'));
    }
    console.log(chalk.gray('  zilmate voice doctor'));
    console.log(chalk.gray('  zilmate camera doctor'));
  } finally {
    rl.close();
  }
}

export async function runVoiceSetup(options: Pick<SetupOptions, 'path' | 'force' | 'deepgramApiKey' | 'voiceListenModel' | 'voiceTtsModel' | 'voiceLanguage'> = {}) {
  const envPath = options.path || '.env';
  const existing = await readEnvValues(envPath);
  const rl = readline.createInterface({ input, output });

  try {
    printZilMateBanner('Voice setup');
    console.log(chalk.gray('This turns on realtime voice without walking through every other ZilMate setup step.'));
    console.log(chalk.gray('Defaults use Deepgram Flux V2 for fast listening and Aura-2 for spoken replies.'));

    if (existing.size > 0 && !options.force) {
      const update = await askYesNo(rl, `${envPath} already exists. Update voice settings?`, true);
      if (!update) {
        console.log(chalk.yellow('Voice setup cancelled. Existing .env was left unchanged.'));
        return;
      }
    }

    const values = new Map(existing);
    values.set('ZILMATE_VOICE_ENABLED', 'true');
    values.set('ZILMATE_VOICE_MODE', 'agent');
    values.set('ZILMATE_VOICE_BARGE_IN', 'true');

    const currentKey = options.deepgramApiKey ?? values.get('DEEPGRAM_API_KEY') ?? '';
    if (options.deepgramApiKey) {
      values.set('DEEPGRAM_API_KEY', options.deepgramApiKey);
    } else if (currentKey) {
      const replace = await askYesNo(rl, 'DEEPGRAM_API_KEY already exists. Replace it?', false);
      if (replace) values.set('DEEPGRAM_API_KEY', await askRequiredSecret(rl, 'DEEPGRAM_API_KEY: '));
    } else {
      values.set('DEEPGRAM_API_KEY', await askRequiredSecret(rl, 'DEEPGRAM_API_KEY: '));
    }

    const currentListenModel = options.voiceListenModel ?? values.get('ZILMATE_VOICE_LISTEN_MODEL') ?? 'flux-general-en';
    const listenModel = options.voiceListenModel ?? ((await rl.question(`Listen model (${currentListenModel}): `)).trim() || currentListenModel);
    values.set('ZILMATE_VOICE_LISTEN_MODEL', listenModel);
    values.set('ZILMATE_VOICE_LISTEN_VERSION', listenModel.startsWith('flux-') ? 'v2' : 'v1');

    const currentTtsModel = options.voiceTtsModel ?? values.get('ZILMATE_VOICE_TTS_MODEL') ?? 'aura-2-thalia-en';
    values.set('ZILMATE_VOICE_TTS_MODEL', options.voiceTtsModel ?? ((await rl.question(`TTS voice (${currentTtsModel}): `)).trim() || currentTtsModel));

    const currentLanguage = options.voiceLanguage ?? values.get('ZILMATE_VOICE_LANGUAGE') ?? 'en';
    values.set('ZILMATE_VOICE_LANGUAGE', options.voiceLanguage ?? ((await rl.question(`Language (${currentLanguage}): `)).trim() || currentLanguage));

    if (!values.has('ZILMATE_VOICE_LANGUAGE_HINTS')) values.set('ZILMATE_VOICE_LANGUAGE_HINTS', '');

    await writeEnvValues(envPath, values, {
      merge: existsSync(envPath),
      touchedKeys: new Set(['ZILMATE_VOICE_ENABLED', 'DEEPGRAM_API_KEY', 'ZILMATE_VOICE_LISTEN_MODEL', 'ZILMATE_VOICE_LISTEN_VERSION', 'ZILMATE_VOICE_TTS_MODEL', 'ZILMATE_VOICE_LANGUAGE', 'ZILMATE_VOICE_MODE', 'ZILMATE_VOICE_BARGE_IN']),
    });
    console.log(chalk.green(`Saved voice settings to ${envPath}.`));
    printPanel('Voice summary', [
      ['Voice', 'enabled'],
      ['Deepgram', values.get('DEEPGRAM_API_KEY') ? 'configured' : 'missing'],
      ['Listen model', `${values.get('ZILMATE_VOICE_LISTEN_MODEL')} (${values.get('ZILMATE_VOICE_LISTEN_VERSION')})`],
      ['TTS voice', values.get('ZILMATE_VOICE_TTS_MODEL') || 'aura-2-thalia-en'],
      ['Language', values.get('ZILMATE_VOICE_LANGUAGE') || 'en'],
    ]);
    console.log(chalk.gray('\nNext steps:'));
    console.log(chalk.gray('  zilmate voice doctor'));
    console.log(chalk.gray('  zilmate voice config'));
  } finally {
    rl.close();
  }
}

export async function setVoiceEnabled(enabled: boolean, options: Pick<SetupOptions, 'path'> = {}) {
  const envPath = options.path || '.env';
  const values = await readEnvValues(envPath);
  values.set('ZILMATE_VOICE_ENABLED', enabled ? 'true' : 'false');
  if (enabled) {
    values.set('ZILMATE_VOICE_MODE', values.get('ZILMATE_VOICE_MODE') || 'agent');
    values.set('ZILMATE_VOICE_LISTEN_MODEL', values.get('ZILMATE_VOICE_LISTEN_MODEL') || 'flux-general-en');
    values.set('ZILMATE_VOICE_LISTEN_VERSION', values.get('ZILMATE_VOICE_LISTEN_VERSION') || 'v2');
    values.set('ZILMATE_VOICE_TTS_MODEL', values.get('ZILMATE_VOICE_TTS_MODEL') || 'aura-2-thalia-en');
    values.set('ZILMATE_VOICE_LANGUAGE', values.get('ZILMATE_VOICE_LANGUAGE') || 'en');
    values.set('ZILMATE_VOICE_BARGE_IN', values.get('ZILMATE_VOICE_BARGE_IN') || 'true');
  }
  await writeEnvValues(envPath, values, { merge: existsSync(envPath) });
  printPanel('Voice', [
    ['Status', enabled ? 'enabled' : 'disabled'],
    ['Deepgram', values.get('DEEPGRAM_API_KEY') ? 'configured' : 'missing'],
    ['Next', enabled ? values.get('DEEPGRAM_API_KEY') ? 'zilmate voice doctor' : 'zilmate voice setup' : 'zilmate voice enable'],
  ]);
}
