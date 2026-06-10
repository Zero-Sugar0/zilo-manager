import { access, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { constants, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env, hasComposio, hasGatewayAuth, hasRedis } from '../config/env.js';
import { getModelAvailability, models } from '../config/models.js';
import { getComposioStatus } from '../tools/composio.tool.js';
import { memoryBackendName } from '../memory/redis.js';

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
  const folder = path.resolve('.zilo-manager');
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
