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

ZilMate ${tag} — Fully continuous conversational threads, multi-line terminal tables, background shell utilities, and direct messaging for multi-platform integrations.

## Install

\`\`\`powershell
npm install -g zilmate@${version}
zilmate setup
zilmate doctor
zilmate menu
\`\`\`

## Highlights

- **Word-Wrapped Terminal Tables** — Replaced flat table cell truncation with a smart word-wrapping renderer (\`wrapCellText\` and \`renderRowLines\`) inside \`src/cli/format.ts\`. This ensures long description texts and complex schedules are shown completely across beautifully structured multiline terminal rows.
- **Asynchronous Background Shell Tools Suite** — Engineered five advanced, type-safe execution tools (\`executeCommandAsync\`, \`checkCommandStatus\`, \`sendInputToProcess\`, \`killCommand\`, and \`listBackgroundCommands\`) in \`src/tools/shell.tool.ts\` for initiating and managing non-blocking tasks.
- **Telegram Concurrency Conflict (LockError) Resolved** — Configured \`concurrency: "queue"\` on active chat instances inside \`src/cli/chat.ts\` to sequence overlapping long-polling events and avoid lock acquisition failure errors.
- **Interactive Chat Integration Portal CLI** — Added a dedicated \`"zilmate chat"\` entry in \`package.json\` that triggers a beautiful keyboard-guided terminal UI to toggle Slack, Telegram, and iMessage listeners with multi-select checkboxes.
- **Telegram-Tailored Formatting Rules** — Dynamic platform detection structures the AI responses with bold titles instead of hashes, formatting tables as preformatted monospace blocks for a premium presentation.
- **Continuous Conversational Chat SDK Support** — Fully integrated event routing inside \`src/cli/chat.ts\` for multi-turn conversational capabilities over Telegram and Slack without repeating mentions.

## Quick Checks

\`\`\`powershell
zilmate setup
zilmate doctor
zilmate menu
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
