import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const version = pkg.version;
const tag = `v${version}`;
const title = `ZilMate ${tag}`;

const notes = `# ${title}

ZilMate ${tag} is the latest npm release for the CLI and server SDK.

## Install

\`\`\`powershell
npm install -g zilmate@${version}
zilmate setup
zilmate doctor
\`\`\`

## Highlights

- Sequential permission prompts (one approval at a time) for OSINT, pentest, Composio, and orchestration tools.
- Trigger orchestration with LLM routing, policy storage, and propose/apply workflow with user confirmation.
- Personal context store (VIP contacts, projects, urgency rules) for smarter prioritization.
- Agent skills discovery (SKILL.md) via listSkills, searchSkills, and readSkill tools.
- Cross-platform CLI runner fixes for Windows OSINT/pentest tools (NUL stdin wrapper).
- Pentest tool installer (nmap, nuclei, subfinder, httpx, ffuf, sqlmap).
- Voice: Flux EOT tuning, nova-3 STT fallback, chunked Aura TTS with flush timing.

## Quick Checks

\`\`\`powershell
zilmate --version
zilmate menu
zilmate jobs list
zilmate memory
\`\`\`

## npm

Published package: \`zilmate@${version}\`
`;

const run = (command, commandArgs, options = {}) => {
  return execFileSync(command, commandArgs, {
    encoding: 'utf8',
    stdio: options.stdio ?? 'pipe',
    ...options,
  });
};

if (dryRun) {
  console.log(`Tag: ${tag}`);
  console.log(`Title: ${title}`);
  console.log('');
  console.log(notes);
  process.exit(0);
}

try {
  run('gh', ['auth', 'status'], { stdio: 'pipe' });
} catch {
  console.error('GitHub CLI is not authenticated. Run: gh auth login -h github.com');
  process.exit(1);
}

const notesPath = join(tmpdir(), `zilmate-${version}-github-release.md`);
writeFileSync(notesPath, notes);

run(
  'gh',
  [
    'release',
    'create',
    tag,
    '--repo',
    'zester4/zilo-manager',
    '--title',
    title,
    '--notes-file',
    notesPath,
    '--latest',
  ],
  { stdio: 'inherit' },
);
