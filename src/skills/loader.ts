import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';

export type SkillSummary = {
  id: string;
  name: string;
  description: string;
  path: string;
};

export type SkillContent = SkillSummary & {
  body: string;
};

function parseFrontmatter(raw: string) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/m.exec(raw);
  if (!match) return { meta: {} as Record<string, string>, body: raw };
  const meta: Record<string, string> = {};
  for (const line of match[1]!.split('\n')) {
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return { meta, body: match[2]!.trim() };
}

async function findSkillFiles(root: string, found: string[] = []) {
  if (!existsSync(root)) return found;
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      await findSkillFiles(full, found);
      continue;
    }
    if (entry.name === 'SKILL.md') found.push(full);
  }
  return found;
}

function skillRoots() {
  const roots = [
    path.resolve('.agents', 'skills'),
    path.resolve('plugins'),
    path.resolve('skills'),
  ];
  const extra = (process.env.ZILMATE_SKILL_PATHS || '').split(path.delimiter).map((p) => p.trim()).filter(Boolean);
  roots.push(...extra);
  const homeSkills = path.join(homedir(), '.agents', 'skills');
  if (existsSync(homeSkills)) roots.push(homeSkills);
  return [...new Set(roots)];
}

export async function discoverSkills(): Promise<SkillSummary[]> {
  const files = new Set<string>();
  for (const root of skillRoots()) {
    for (const file of await findSkillFiles(root)) files.add(file);
  }

  const skills: SkillSummary[] = [];
  for (const file of files) {
    const raw = await readFile(file, 'utf8');
    const { meta } = parseFrontmatter(raw);
    const folder = path.basename(path.dirname(file));
    skills.push({
      id: meta.name || folder,
      name: meta.name || folder,
      description: meta.description || 'Agent skill',
      path: file,
    });
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

export async function readSkill(skillId: string): Promise<SkillContent | null> {
  const skills = await discoverSkills();
  const match = skills.find((s) => s.id === skillId || s.name === skillId || s.path.includes(skillId));
  if (!match) return null;
  const raw = await readFile(match.path, 'utf8');
  const { meta, body } = parseFrontmatter(raw);
  return {
    ...match,
    name: meta.name || match.name,
    description: meta.description || match.description,
    body,
  };
}

export async function searchSkills(query: string, limit = 5): Promise<SkillSummary[]> {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const skills = await discoverSkills();
  if (terms.length === 0) return skills.slice(0, limit);
  return skills
    .map((skill) => {
      const hay = `${skill.name} ${skill.description}`.toLowerCase();
      const score = terms.reduce((s, t) => s + (hay.includes(t) ? 1 : 0), 0);
      return { skill, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => item.skill);
}

export function skillPathsHint() {
  return skillRoots().filter((root) => existsSync(root));
}
