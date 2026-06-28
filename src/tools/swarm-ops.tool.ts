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

/**
 * Peer-to-Peer Message Bus factory tool.
 * Dynamically launches a peer specialist in a Joint War Room sub-thread.
 */
export function getCollaborateWithPeerTool(callingAgentName: string) {
  return tool({
    description: 'Invite a peer specialist agent from the digital corporation swarm to a collaborative "Joint War Room" thread to solve cross-functional tasks or negotiate payload contracts directly without involving the COO.',
    inputSchema: z.object({
      peerKey: z.string().describe("The key of the specialist peer to collaborate with (e.g., 'frontendArchitect', 'backendArchitect', 'qaEngineer', 'creativeDirector', 'marketAnalyst', 'seoExpert', 'fullStackCoder')."),
      task: z.string().describe('Describe the task/problem to collaborate on. Be specific and clear about what you need from them.'),
      context: z.string().optional().describe('Optional context (e.g., API schemas, file contents, error logs, or code blocks) to share with the peer.'),
    }),
    execute: async ({ peerKey, task, context }) => {
      emitProgress({ type: 'step', label: `Joint War Room: ${callingAgentName} invited ${peerKey}` });
      
      const { specialistRegistry } = await import('../agents/swarm/registry.js');
      const { SwarmAgent } = await import('../runtime/swarm.js');
      const { SwarmTraceTracker } = await import('../observability/traces.js');
      
      const tracker = SwarmTraceTracker.getInstance();
      await tracker.recordEvent('collaboration', `Collab Invite: ${callingAgentName} -> ${peerKey}`, task);
      
      const peerConfig = specialistRegistry[peerKey];
      if (!peerConfig) {
        throw new Error(`Specialist peer with key "${peerKey}" was not found in the corporation registry. Available peers: ${Object.keys(specialistRegistry).join(', ')}`);
      }
      
      // Instantiate and run the peer agent in their own context
      const peerAgent = new SwarmAgent(peerConfig);
      await peerAgent.init();
      
      const prompt = `[JOINT WAR ROOM COLLABORATION]
You have been invited by your peer ${callingAgentName} to a Joint War Room to collaborate on a task.

Sender: ${callingAgentName}
Task: ${task}

Shared Context / Inputs:
${context || 'None provided'}

Please analyze the request, use your specialized tools to investigate or complete the task, and provide a clear, comprehensive report or resolution back to your peer.`;

      const response = await peerAgent.run(prompt);
      
      emitProgress({ type: 'step', label: `Joint War Room: ${peerKey} delivered collaboration report to ${callingAgentName}` });
      return {
        sender: callingAgentName,
        recipient: peerKey,
        task,
        responseReport: response,
      };
    }
  });
}