import { tool } from 'ai';
import { z } from 'zod';
import { appendScratchpad, readScratchpad, getSharedScratchpad, saveSharedScratchpad } from '../memory/scratchpad.js';
import { emitProgress } from '../runtime/progress.js';

export function createScratchpadTools(runId: string) {
  return {
    readScratchpad: tool({
      description: 'Read shared scratchpad notes for this agent run. Use this to avoid repeating context in prompts.',
      inputSchema: z.object({}),
      execute: async () => {
        emitProgress({ type: 'fetch:start', label: 'Reading scratchpad', detail: runId });
        const content = await readScratchpad(runId);
        emitProgress({ type: 'fetch:end', label: 'Scratchpad loaded', detail: runId });
        return content;
      },
    }),
    appendScratchpad: tool({
      description: 'Append compact notes to the shared scratchpad for this run. Keep notes short and factual.',
      inputSchema: z.object({ note: z.string().min(1).max(4000) }),
      execute: async ({ note }) => {
        emitProgress({ type: 'fetch:start', label: 'Appending scratchpad note', detail: runId });
        const result = await appendScratchpad(runId, note);
        emitProgress({ type: 'fetch:end', label: 'Scratchpad note saved', detail: runId });
        return result;
      },
    }),
    getSharedValue: tool({
      description: 'Get a value from the shared multi-agent scratchpad by key. Useful for retrieving volatile variables like staging_url, git_branch, or credentials.',
      inputSchema: z.object({
        key: z.string().describe('The key of the shared variable to retrieve.'),
      }),
      execute: async ({ key }) => {
        emitProgress({ type: 'fetch:start', label: `Reading shared value: ${key}`, detail: runId });
        const store = await getSharedScratchpad(runId);
        const value = store[key];
        emitProgress({ type: 'fetch:end', label: `Shared value loaded: ${key}`, detail: runId });
        return value !== undefined ? value : null;
      },
    }),
    setSharedValue: tool({
      description: 'Set a value in the shared multi-agent scratchpad by key. Useful for sharing volatile variables like staging_url, git_branch, or credentials with other agents.',
      inputSchema: z.object({
        key: z.string().describe('The key of the shared variable to set.'),
        value: z.any().describe('The JSON-serializable value to store.'),
      }),
      execute: async ({ key, value }) => {
        emitProgress({ type: 'fetch:start', label: `Setting shared value: ${key}`, detail: runId });
        const store = await getSharedScratchpad(runId);
        store[key] = value;
        await saveSharedScratchpad(runId, store);
        emitProgress({ type: 'fetch:end', label: `Shared value saved: ${key}`, detail: runId });
        return `Successfully set shared key "${key}".`;
      },
    }),
    listSharedKeys: tool({
      description: 'List all active keys currently stored in the shared multi-agent scratchpad for this run.',
      inputSchema: z.object({}),
      execute: async () => {
        emitProgress({ type: 'fetch:start', label: 'Listing shared keys', detail: runId });
        const store = await getSharedScratchpad(runId);
        const keys = Object.keys(store);
        emitProgress({ type: 'fetch:end', label: 'Shared keys listed', detail: runId });
        return keys;
      },
    }),
  };
}

