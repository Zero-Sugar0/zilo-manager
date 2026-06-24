import { tool } from 'ai';
import { z } from 'zod';
import { readScratchpad, appendScratchpad } from '../memory/scratchpad.js';
import { emitProgress } from '../runtime/progress.js';

export const swarmMemoryTools = {
  getSharedScratchpad: tool({
    description: 'Read the shared swarm scratchpad for transient context. If you are a specialist, this is your departmental scratchpad. If you are the COO, you can access any departmental scratchpad by specifying sessionId (e.g. "default:engineering").',
    inputSchema: z.object({
      sessionId: z.string().optional().describe('The session or department scope (e.g., "default", "default:engineering"). Defaults to your current scope.'),
    }),
    execute: async ({ sessionId }) => {
      const id = sessionId || 'default';
      const content = await readScratchpad(id);
      return { scope: id, content };
    },
  }),
  appendSharedScratchpad: tool({
    description: 'Append to the shared swarm scratchpad. Use to communicate transient state to other agents in your immediate department or swarm loop.',
    inputSchema: z.object({
      content: z.string().describe('The content to append to the scratchpad.'),
      sessionId: z.string().optional().describe('The session or department scope. Defaults to your current scope.'),
    }),
    execute: async ({ content, sessionId }) => {
      const id = sessionId || 'default';
      emitProgress({ type: 'step', label: `Updating scratchpad [${id}]` });
      await appendScratchpad(id, content);
      return { status: 'Scratchpad updated', scope: id };
    },
  }),
};
