import { tool } from 'ai';
import { z } from 'zod';
import { emitProgress } from '../runtime/progress.js';
import { getRedis } from '../memory/redis.js';
import { readJson, writeJson } from '../memory/local-store.js';

async function setControlState(id: string, state: 'RUNNING' | 'PAUSED') {
  const redis = getRedis();
  const key = `zilo-swarm:control:${id}`;
  if (redis) {
    await redis.set(key, state);
    return;
  }
  const data = await readJson<Record<string, string>>('swarm-control.json', {});
  data[id] = state;
  await writeJson('swarm-control.json', data);
}

export async function getControlState(id: string): Promise<'RUNNING' | 'PAUSED'> {
  const redis = getRedis();
  const key = `zilo-swarm:control:${id}`;
  if (redis) {
    const val = await redis.get<string>(key);
    return val === 'PAUSED' ? 'PAUSED' : 'RUNNING';
  }
  const data = await readJson<Record<string, string>>('swarm-control.json', {});
  return data[id] === 'PAUSED' ? 'PAUSED' : 'RUNNING';
}

export const swarmOpsTools = {
  pauseDepartment: tool({
    description: 'Pause all execution for a specific department. Use when a project is on hold or requires human intervention.',
    inputSchema: z.object({
      department: z.enum(['Strategy', 'Engineering', 'Growth', 'Revenue', 'Operations', 'Security', 'Data']),
      sessionId: z.string().optional().default('default'),
    }),
    execute: async ({ department, sessionId }) => {
      const id = `${sessionId}:${department.toLowerCase()}`;
      emitProgress({ type: 'step', label: `Pausing department: ${department}` });
      await setControlState(id, 'PAUSED');
      return { status: 'PAUSED', department, scope: id };
    },
  }),
  resumeDepartment: tool({
    description: 'Resume execution for a previously paused department.',
    inputSchema: z.object({
      department: z.enum(['Strategy', 'Engineering', 'Growth', 'Revenue', 'Operations', 'Security', 'Data']),
      sessionId: z.string().optional().default('default'),
    }),
    execute: async ({ department, sessionId }) => {
      const id = `${sessionId}:${department.toLowerCase()}`;
      emitProgress({ type: 'step', label: `Resuming department: ${department}` });
      await setControlState(id, 'RUNNING');
      return { status: 'RUNNING', department, scope: id };
    },
  }),
};