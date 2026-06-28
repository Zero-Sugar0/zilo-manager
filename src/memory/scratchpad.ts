import { writeFile, readFile } from 'node:fs/promises';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { readJson } from './local-store.js';
import { getRedis } from './redis.js';
import { workspaceLayout } from '../workspace/paths.js';

const scratchTtlSeconds = 60 * 60 * 24;

function scratchFile(runId: string) {
  return path.join(workspaceLayout().scratch, `${runId}.json`);
}

async function ensureScratchDir() {
  await mkdir(workspaceLayout().scratch, { recursive: true });
}

export async function readScratchpad(runId: string) {
  const redis = getRedis();
  if (redis) return (await redis.get<string>(`zilo-manager:scratch:${runId}`)) || '(empty)';

  const file = scratchFile(runId);
  try {
    const note = JSON.parse(await readFile(file, 'utf8')) as { text: string };
    return note.text || '(empty)';
  } catch {
    const legacy = await readJson<{ text: string }>(`scratch-${runId}.json`, { text: '' });
    return legacy.text || '(empty)';
  }
}

export async function appendScratchpad(runId: string, text: string) {
  const redis = getRedis();
  if (redis) {
    const key = `zilo-manager:scratch:${runId}`;
    await redis.append(key, `\n${text}`);
    await redis.expire(key, scratchTtlSeconds);
    return 'Appended.';
  }

  await ensureScratchDir();
  const file = scratchFile(runId);
  let current = '';
  try {
    current = (JSON.parse(await readFile(file, 'utf8')) as { text: string }).text || '';
  } catch {
    current = (await readJson<{ text: string }>(`scratch-${runId}.json`, { text: '' })).text || '';
  }
  await writeFile(file, JSON.stringify({ text: `${current}\n${text}`.trim() }, null, 2), 'utf8');
  return 'Appended.';
}

export async function getSharedScratchpad(runId: string): Promise<Record<string, any>> {
  const redis = getRedis();
  if (redis) {
    const key = `zilo-manager:shared-scratch:${runId}`;
    const data = await redis.get<string>(key);
    return data ? JSON.parse(data) : {};
  }

  const file = path.join(workspaceLayout().scratch, `shared-scratch-${runId}.json`);
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return {};
  }
}

export async function saveSharedScratchpad(runId: string, data: Record<string, any>): Promise<void> {
  const redis = getRedis();
  if (redis) {
    const key = `zilo-manager:shared-scratch:${runId}`;
    await redis.set(key, JSON.stringify(data));
    await redis.expire(key, scratchTtlSeconds);
    return;
  }

  await ensureScratchDir();
  const file = path.join(workspaceLayout().scratch, `shared-scratch-${runId}.json`);
  await writeFile(file, JSON.stringify(data, null, 2), 'utf8');
}

