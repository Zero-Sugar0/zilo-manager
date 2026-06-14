import { tool } from 'ai';
import { z } from 'zod';
import { discoverSkills, readSkill, searchSkills, skillPathsHint } from '../skills/loader.js';
import { emitProgress } from '../runtime/progress.js';

export const skillTools = {
  listSkills: tool({
    description: 'List available agent skills (SKILL.md files). Use before specialized tasks to see if a skill already documents the workflow.',
    inputSchema: z.object({}),
    execute: async () => {
      emitProgress({ type: 'fetch:start', label: 'Discovering skills' });
      const skills = await discoverSkills();
      emitProgress({ type: 'fetch:end', label: 'Skills discovered', detail: `${skills.length} skill(s)` });
      return { skills, searchPaths: skillPathsHint() };
    },
  }),

  searchSkills: tool({
    description: 'Search skills by keyword in name or description. Use when the user asks how to do something that might have a skill.',
    inputSchema: z.object({
      query: z.string().min(2),
      limit: z.number().int().min(1).max(20).optional(),
    }),
    execute: async ({ query, limit }) => {
      emitProgress({ type: 'search:start', label: 'Searching skills', detail: query });
      const skills = await searchSkills(query, limit ?? 5);
      emitProgress({ type: 'search:end', label: 'Skill search complete', detail: `${skills.length} match(es)` });
      return { query, skills };
    },
  }),

  readSkill: tool({
    description: 'Load one skill by id/name and return its full instructions. Follow the skill when it matches the user task.',
    inputSchema: z.object({
      skillId: z.string().min(1),
    }),
    execute: async ({ skillId }) => {
      emitProgress({ type: 'fetch:start', label: 'Reading skill', detail: skillId });
      const skill = await readSkill(skillId);
      if (!skill) throw new Error(`Skill not found: ${skillId}. Run listSkills first.`);
      emitProgress({ type: 'fetch:end', label: 'Skill loaded', detail: skill.name });
      return skill;
    },
  }),
};
