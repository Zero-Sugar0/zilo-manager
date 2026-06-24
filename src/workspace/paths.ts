import { existsSync } from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';

export type WorkspaceLayout = {
  root: string;
  notebook: string;
  memoryJson: string;
  notesJson: string;
  knowledgeGraph: string;
  healLog: string;
  trustLog: string;
  skills: string;
  outputs: string;
  osint: string;
  pentest: string;
  images: string;
  logs: string;
  projects: string;
  attachments: string;
  backups: string;
  config: string;
  scratch: string;
  data: string;
  history: string;
};

export function defaultWorkspaceCandidates() {
  return [
    path.join(homedir(), 'Downloads', 'ZilMate'),
    path.join(homedir(), 'ZilMate'),
  ];
}

export function resolveWorkspaceRoot() {
  if (process.env.ZILMATE_WORKSPACE?.trim()) {
    return path.resolve(process.env.ZILMATE_WORKSPACE.trim());
  }
  for (const candidate of defaultWorkspaceCandidates()) {
    if (existsSync(candidate)) return candidate;
  }
  return process.platform === 'win32' || process.platform === 'darwin'
    ? path.join(homedir(), 'Downloads', 'ZilMate')
    : path.join(homedir(), 'ZilMate');
}

export function workspaceLayout(root = resolveWorkspaceRoot()): WorkspaceLayout {
  return {
    root,
    notebook: path.join(root, 'notebook.md'),
    memoryJson: path.join(root, 'memory.json'),
    notesJson: path.join(root, 'notes.json'),
    knowledgeGraph: path.join(root, 'knowledge-graph.json'),
    healLog: path.join(root, 'logs', 'heal.jsonl'),
    trustLog: path.join(root, 'logs', 'trust-actions.jsonl'),
    skills: path.join(root, 'skills'),
    outputs: path.join(root, 'outputs'),
    osint: path.join(root, 'outputs', 'osint'),
    pentest: path.join(root, 'outputs', 'pentest'),
    images: path.join(root, 'outputs', 'images'),
    logs: path.join(root, 'logs'),
    projects: path.join(root, 'projects'),
    attachments: path.join(root, 'attachments'),
    backups: path.join(root, 'backups'),
    config: path.join(root, 'config'),
    scratch: path.join(root, 'scratch'),
    data: path.join(root, 'data'),
    history: path.join(root, 'config', 'history.txt'),
  };
}

export function legacyDataRoot() {
  return path.resolve('.zilo-manager');
}
