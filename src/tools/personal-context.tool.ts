import { tool } from 'ai';
import { z } from 'zod';
import {
  addUrgencyRule,
  addWorkflow,
  formatPersonalContextForPrompt,
  loadPersonalContext,
  savePersonalContext,
  upsertContact,
  upsertProject,
} from '../memory/personal-context.js';

export const personalContextTools = {
  getPersonalContext: tool({
    description: 'Load the user\'s personal/business context: VIP contacts, active projects, urgency rules, and workflow notes. Use for routing, prioritization, and personalized assistance.',
    inputSchema: z.object({}),
    execute: async () => {
      const context = await loadPersonalContext();
      return {
        context,
        summary: formatPersonalContextForPrompt(context),
      };
    },
  }),

  updatePersonalContext: tool({
    description: 'Update personal context the agent should know about the user\'s life and business. Use when the user defines what "urgent" means, names VIP contacts, or describes workflows.',
    inputSchema: z.object({
      ownerName: z.string().optional(),
      businessName: z.string().optional(),
      urgencyRule: z.string().optional().describe('Add one urgency rule, e.g. "Emails from alice@co.com are always urgent"'),
      workflow: z.string().optional().describe('Add one workflow note, e.g. "Invoice approvals happen in Stripe then Slack #finance"'),
      contact: z.object({
        id: z.string().optional(),
        name: z.string().min(1),
        email: z.string().optional(),
        handle: z.string().optional(),
        role: z.string().optional(),
        vip: z.boolean().optional().default(false),
        notes: z.string().optional(),
      }).optional(),
      project: z.object({
        id: z.string().optional(),
        name: z.string().min(1),
        status: z.enum(['active', 'paused', 'done']).optional().default('active'),
        description: z.string().optional(),
        tags: z.array(z.string()).optional().default([]),
      }).optional(),
    }),
    execute: async (input) => {
      const context = await loadPersonalContext();
      if (input.ownerName) context.ownerName = input.ownerName;
      if (input.businessName) context.businessName = input.businessName;
      await savePersonalContext(context);
      if (input.urgencyRule) await addUrgencyRule(input.urgencyRule);
      if (input.workflow) await addWorkflow(input.workflow);
      if (input.contact) {
        await upsertContact({
          name: input.contact.name,
          vip: input.contact.vip ?? false,
          ...(input.contact.id ? { id: input.contact.id } : {}),
          ...(input.contact.email ? { email: input.contact.email } : {}),
          ...(input.contact.handle ? { handle: input.contact.handle } : {}),
          ...(input.contact.role ? { role: input.contact.role } : {}),
          ...(input.contact.notes ? { notes: input.contact.notes } : {}),
        });
      }
      if (input.project) {
        await upsertProject({
          name: input.project.name,
          status: input.project.status ?? 'active',
          tags: input.project.tags ?? [],
          ...(input.project.id ? { id: input.project.id } : {}),
          ...(input.project.description ? { description: input.project.description } : {}),
        });
      }
      const updated = await loadPersonalContext();
      return { updated: true, summary: formatPersonalContextForPrompt(updated) };
    },
  }),
};
