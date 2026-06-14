import { Composio, type IncomingTriggerPayload, type TriggerSubscribeParams } from '@composio/core';
import { env, requireComposio } from '../config/env.js';
import { handleComposioTriggerWorkflow, triggerWorkflowsEnabled } from '../jobs/workflows.js';

type TriggerListOptions = {
  limit?: string;
  showDisabled?: boolean;
  json?: boolean;
};

type TriggerTypeOptions = {
  limit?: string;
  json?: boolean;
};

type TriggerCreateOptions = {
  connectedAccount?: string;
  config?: string;
  dryRun?: boolean;
};

type TriggerListenOptions = {
  trigger?: string;
  triggerSlug?: string[];
  toolkit?: string[];
  connectedAccount?: string;
  triggerData?: string;
  userId?: string;
  json?: boolean;
  once?: boolean;
};

export function getComposioTriggerClient() {
  requireComposio();
  return new Composio({ apiKey: env.composioApiKey ?? null });
}

export function parseLimit(value: string | number | undefined, fallback: number) {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : fallback;
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function printJson(value: unknown) {
  console.log(JSON.stringify(value, null, 2));
}

export function formatTriggerConfigKey(key: string) {
  return key.replace(/^--?/, '').replace(/-([a-z])/g, (_match, char: string) => char.toUpperCase());
}

export function parseTriggerConfigValue(value: string) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  return value;
}

export function parseUnknownTriggerConfig(args: string[]) {
  const config: Record<string, unknown> = {};

  for (let index = 0; index < args.length; index += 1) {
    const raw = args[index];
    if (!raw?.startsWith('--')) continue;
    const [rawKey, inlineValue] = raw.split('=', 2);
    const key = formatTriggerConfigKey(rawKey!);
    const next = args[index + 1];
    const value = inlineValue !== undefined
      ? inlineValue
      : next && !next.startsWith('--')
        ? next
        : 'true';

    if (inlineValue === undefined && next && !next.startsWith('--')) index += 1;

    if (config[key] !== undefined) {
      const existing = config[key];
      config[key] = Array.isArray(existing) ? [...existing, parseTriggerConfigValue(value)] : [existing, parseTriggerConfigValue(value)];
    } else {
      config[key] = parseTriggerConfigValue(value);
    }
  }

  return config;
}

export function parseTriggerConfigJson(value: string | undefined) {
  if (!value) return {};
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('--config must be a JSON object.');
  }
  return parsed as Record<string, unknown>;
}

export function compact(value: unknown, max = 180) {
  if (value === undefined || value === null || value === '') return undefined;
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

export function pickTriggerEventSummary(payload: Record<string, unknown> | undefined) {
  if (!payload) return '';
  const keys = [
    'subject',
    'title',
    'message',
    'text',
    'body',
    'snippet',
    'from',
    'sender',
    'email',
    'repository',
    'repo',
    'branch',
    'commit',
    'commits',
  ];

  for (const key of keys) {
    const value = compact(payload[key]);
    if (value) return value;
  }

  return compact(payload) ?? '';
}

function printTriggerEvent(event: IncomingTriggerPayload, asJson: boolean) {
  if (asJson) {
    printJson(event);
    return;
  }

  const summary = pickTriggerEventSummary(event.payload);
  const stamp = new Date().toLocaleTimeString();
  const heading = `[${stamp}] [${event.triggerSlug}]`;
  console.log(summary ? `${heading} ${summary}` : heading);
  console.log(`  toolkit=${event.toolkitSlug} trigger=${event.id} user=${event.userId || 'unknown'}`);
}

async function handleTriggerWorkflow(event: IncomingTriggerPayload) {
  if (!triggerWorkflowsEnabled()) return;
  const jobs = await handleComposioTriggerWorkflow(event);
  if (jobs.length === 0) return;
  const primary = jobs[0]!;
  const chain = jobs.length > 1 ? ` chain=${jobs.length}` : '';
  const route = typeof primary.metadata.orchestration === 'object'
    && primary.metadata.orchestration
    && typeof (primary.metadata.orchestration as { route?: string }).route === 'string'
    ? (primary.metadata.orchestration as { route: string }).route
    : 'default';
  console.log(`  queuedJob=${primary.id} route=${route}${chain}`);
}

export async function listTriggerTypes(toolkit: string | undefined, options: TriggerTypeOptions) {
  const client = getComposioTriggerClient();
  const response = await client.triggers.listTypes({
    limit: parseLimit(options.limit, 25),
    ...(toolkit ? { toolkits: [toolkit] } : {}),
  });

  if (options.json) {
    printJson(response);
    return;
  }

  for (const item of response.items) {
    console.log(`${item.slug} (${item.toolkit.slug})`);
    if (item.description) console.log(`  ${item.description}`);
  }
  if (response.nextCursor) console.log(`Next cursor: ${response.nextCursor}`);
}

export async function showTriggerType(triggerSlug: string, options: { json?: boolean }) {
  const client = getComposioTriggerClient();
  const triggerType = await client.triggers.getType(triggerSlug);

  if (options.json) {
    printJson(triggerType);
    return;
  }

  console.log(`${triggerType.slug} (${triggerType.toolkit.slug})`);
  console.log(triggerType.description);
  if (triggerType.instructions) console.log(`\n${triggerType.instructions}`);
  console.log('\nConfig schema:');
  printJson(triggerType.config);
  console.log('\nPayload schema:');
  printJson(triggerType.payload);
}

export async function listTriggers(options: TriggerListOptions) {
  const client = getComposioTriggerClient();
  const response = await client.triggers.listActive({
    limit: parseLimit(options.limit, 25),
    ...(options.showDisabled ? { showDisabled: true } : {}),
  });

  if (options.json) {
    printJson(response);
    return;
  }

  if (response.items.length === 0) {
    console.log('No active Composio triggers found.');
    return;
  }

  for (const item of response.items) {
    const status = item.disabledAt ? 'disabled' : 'enabled';
    console.log(`${item.id} ${item.triggerName} (${status})`);
    console.log(`  connectedAccount=${item.connectedAccountId} updated=${item.updatedAt}`);
  }
}

export async function createTrigger(triggerSlug: string, options: TriggerCreateOptions, unknownArgs: string[]) {
  const client = getComposioTriggerClient();
  if (!env.zilmateUserId) throw new Error('Missing ZILMATE_USER_ID. Run `zilmate setup` first.');

  const triggerConfig = {
    ...parseTriggerConfigJson(options.config),
    ...parseUnknownTriggerConfig(unknownArgs),
  };

  if (options.dryRun) {
    printJson({
      userId: env.zilmateUserId,
      triggerSlug,
      ...(options.connectedAccount ? { connectedAccountId: options.connectedAccount } : {}),
      triggerConfig,
    });
    return;
  }

  const result = await client.triggers.create(env.zilmateUserId, triggerSlug, {
    ...(options.connectedAccount ? { connectedAccountId: options.connectedAccount } : {}),
    ...(Object.keys(triggerConfig).length > 0 ? { triggerConfig } : {}),
  });
  printJson(result);
}

export async function listenToTriggers(options: TriggerListenOptions) {
  const client = getComposioTriggerClient();
  const filters: TriggerSubscribeParams = {
    ...(options.toolkit?.length ? { toolkits: options.toolkit } : {}),
    ...(options.trigger ? { triggerId: options.trigger } : {}),
    ...(options.triggerSlug?.length ? { triggerSlug: options.triggerSlug } : {}),
    ...(options.connectedAccount ? { connectedAccountId: options.connectedAccount } : {}),
    ...(options.triggerData ? { triggerData: options.triggerData } : {}),
    ...(options.userId ? { userId: options.userId } : {}),
  };

  console.log('Listening for Composio trigger events. Press Ctrl+C to stop.');
  if (Object.keys(filters).length > 0) console.log(`Filters: ${JSON.stringify(filters)}`);

  let stopped = false;
  let stopResolve: (() => void) | undefined;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    await client.triggers.unsubscribe().catch(() => undefined);
    stopResolve?.();
  };

  process.once('SIGINT', () => {
    console.log('\nStopping trigger listener...');
    void stop();
  });
  process.once('SIGTERM', () => {
    void stop();
  });

  await client.triggers.subscribe((event) => {
    printTriggerEvent(event, Boolean(options.json));
    void handleTriggerWorkflow(event).catch((error) => {
      console.error(`  workflowError=${error instanceof Error ? error.message : String(error)}`);
    });
    if (options.once) void stop();
  }, filters);

  await new Promise<void>((resolve) => {
    stopResolve = resolve;
  });
}
