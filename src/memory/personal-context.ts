import { randomUUID } from 'node:crypto';
import { readJson, writeJson } from './local-store.js';
import { getRedis } from './redis.js';

const contextKey = 'zilo-manager:personal-context:v1';
const contextFile = 'personal-context.json';

export type PersonalContact = {
  id: string;
  name: string;
  email?: string;
  handle?: string;
  role?: string;
  vip: boolean;
  notes?: string;
};

export type PersonalProject = {
  id: string;
  name: string;
  status: 'active' | 'paused' | 'done';
  description?: string;
  tags: string[];
};

export type PersonalContext = {
  ownerName?: string;
  businessName?: string;
  urgencyRules: string[];
  workflows: string[];
  contacts: PersonalContact[];
  projects: PersonalProject[];
  updatedAt: string;
};

const emptyContext = (): PersonalContext => ({
  urgencyRules: [],
  workflows: [],
  contacts: [],
  projects: [],
  updatedAt: new Date().toISOString(),
});

export async function loadPersonalContext(): Promise<PersonalContext> {
  const redis = getRedis();
  if (redis) {
    const stored = await redis.get<PersonalContext>(contextKey);
    if (stored) return stored;
  }
  return readJson<PersonalContext>(contextFile, emptyContext());
}

export async function savePersonalContext(context: PersonalContext) {
  const next = { ...context, updatedAt: new Date().toISOString() };
  const redis = getRedis();
  if (redis) {
    await redis.set(contextKey, next);
    return next;
  }
  await writeJson(contextFile, next);
  return next;
}

export function formatPersonalContextForPrompt(context: PersonalContext) {
  const lines: string[] = [];
  if (context.ownerName) lines.push(`Owner: ${context.ownerName}`);
  if (context.businessName) lines.push(`Business: ${context.businessName}`);
  if (context.urgencyRules.length) {
    lines.push('Urgency rules:');
    for (const rule of context.urgencyRules) lines.push(`- ${rule}`);
  }
  if (context.workflows.length) {
    lines.push('Workflows:');
    for (const workflow of context.workflows) lines.push(`- ${workflow}`);
  }
  const vips = context.contacts.filter((c) => c.vip);
  if (vips.length) {
    lines.push('VIP contacts:');
    for (const contact of vips) {
      lines.push(`- ${contact.name}${contact.email ? ` <${contact.email}>` : ''}${contact.role ? ` (${contact.role})` : ''}`);
    }
  }
  const active = context.projects.filter((p) => p.status === 'active');
  if (active.length) {
    lines.push('Active projects:');
    for (const project of active) lines.push(`- ${project.name}${project.description ? `: ${project.description}` : ''}`);
  }
  return lines.join('\n');
}

export async function upsertContact(input: Omit<PersonalContact, 'id'> & { id?: string }) {
  const context = await loadPersonalContext();
  const id = input.id || randomUUID().slice(0, 8);
  const contact: PersonalContact = { ...input, id };
  const index = context.contacts.findIndex((c) => c.id === id);
  if (index >= 0) context.contacts[index] = contact;
  else context.contacts.push(contact);
  await savePersonalContext(context);
  return contact;
}

export async function upsertProject(input: Omit<PersonalProject, 'id'> & { id?: string }) {
  const context = await loadPersonalContext();
  const id = input.id || randomUUID().slice(0, 8);
  const project: PersonalProject = { ...input, id };
  const index = context.projects.findIndex((p) => p.id === id);
  if (index >= 0) context.projects[index] = project;
  else context.projects.push(project);
  await savePersonalContext(context);
  return project;
}

export async function addUrgencyRule(rule: string) {
  const context = await loadPersonalContext();
  const trimmed = rule.trim();
  if (trimmed && !context.urgencyRules.includes(trimmed)) context.urgencyRules.push(trimmed);
  await savePersonalContext(context);
  return context.urgencyRules;
}

export async function addWorkflow(note: string) {
  const context = await loadPersonalContext();
  const trimmed = note.trim();
  if (trimmed && !context.workflows.includes(trimmed)) context.workflows.push(trimmed);
  await savePersonalContext(context);
  return context.workflows;
}
