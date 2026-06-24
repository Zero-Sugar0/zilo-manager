import { tool } from 'ai';
import { z } from 'zod';
import { getWorkspaceRoot } from '../workspace/output-paths.js';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const CORPORATE_MEMORY_FILE = 'corporate-notebook.md';
const DEPARTMENTS_DIR = 'departments';

async function ensureMemoryDir() {
  const root = getWorkspaceRoot();
  const dir = path.join(root, 'swarm-memory');
  await mkdir(dir, { recursive: true });
  await mkdir(path.join(dir, DEPARTMENTS_DIR), { recursive: true });
  return dir;
}

export const swarmCollaborationTools = {
  delegateTask: tool({
    description: 'Delegate a specific sub-task to another specialist agent. Use this for tasks outside your expertise or for cross-departmental collaboration.',
    inputSchema: z.object({
      targetAgent: z.string().describe('The name of the agent to delegate to (e.g., "fullStackCoder", "seoExpert").'),
      task: z.string().describe('The specific instructions or request for the target agent.'),
      priority: z.enum(['low', 'medium', 'high']).optional().default('medium'),
    }),
    execute: async ({ targetAgent, task, priority }) => {
      return {
        status: 'delegated',
        targetAgent,
        message: `Task delegated to ${targetAgent} with ${priority} priority.`,
        instruction: `Please switch context to ${targetAgent} to complete: ${task}`
      };
    },
  }),

  readCorporateContext: tool({
    description: 'Read the global corporate notebook, including mission statements, strategic goals, and cross-departmental updates.',
    inputSchema: z.object({}),
    execute: async () => {
      const dir = await ensureMemoryDir();
      const filePath = path.join(dir, CORPORATE_MEMORY_FILE);
      try {
        const content = await readFile(filePath, 'utf-8');
        return { content };
      } catch (e) {
        return { content: '# Corporate Notebook\n\nNo high-level strategy has been set yet. The CEO should initialize this.' };
      }
    },
  }),

  updateCorporateContext: tool({
    description: 'Update the global corporate notebook with new strategic goals or executive updates. Only for use by CEO and Department Heads.',
    inputSchema: z.object({
      content: z.string().describe('The new content to append or set in the corporate notebook.'),
      mode: z.enum(['append', 'overwrite']).optional().default('append'),
    }),
    execute: async ({ content, mode }) => {
      const dir = await ensureMemoryDir();
      const filePath = path.join(dir, CORPORATE_MEMORY_FILE);
      let newContent = content;

      if (mode === 'append') {
        try {
          const existing = await readFile(filePath, 'utf-8');
          newContent = `${existing}\n\n---\n## Update (${new Date().toISOString()})\n\n${content}`;
        } catch (e) {
          newContent = `# Corporate Notebook\n\n${content}`;
        }
      }

      await writeFile(filePath, newContent);
      return { status: 'success', message: 'Corporate context updated.' };
    },
  }),

  accessDepartmentalMemory: tool({
    description: 'Access the private memory and work logs for a specific department.',
    inputSchema: z.object({
      department: z.enum(['Strategy', 'Engineering', 'Growth', 'Operations', 'Data', 'Revenue', 'Security']),
    }),
    execute: async ({ department }) => {
      const dir = await ensureMemoryDir();
      const filePath = path.join(dir, DEPARTMENTS_DIR, `${department.toLowerCase()}.md`);
      try {
        const content = await readFile(filePath, 'utf-8');
        return { department, content };
      } catch (e) {
        return { department, content: `No records found for ${department} department.` };
      }
    },
  }),
};
