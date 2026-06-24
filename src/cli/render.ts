// src/cli/render.ts
import { models } from '../config/models.js';
import { theme, termWidth, boxLine, wrapText } from './theme.js';
import { renderMarkdown } from './format.js';

export function printWelcomeCard(options: {
  cwd: string;
  sessionId: string;
  model?: string;
  workspace?: string;
}) {
  const w = termWidth(92);
  const pad = Math.max(0, w - 4);
  console.log('');
  console.log(boxLine('top', w));
  console.log(theme.accent('│ ') + theme.textBright('* Welcome to ZilMate CEO Dashboard'.padEnd(pad)));
  console.log(theme.accent('│ ') + theme.muted(`/help commands · /swarm business · /model pick · /exit`.padEnd(pad)));
  console.log(theme.accent('│ ') + theme.muted(`cwd: ${options.cwd}`.slice(0, pad).padEnd(pad)));
  if (options.workspace) {
    console.log(theme.accent('│ ') + theme.muted(`workspace: ${options.workspace}`.slice(0, pad).padEnd(pad)));
  }
  console.log(theme.accent('│ ') + theme.muted(`session: ${options.sessionId} · manager: ${options.model || models.manager}`.slice(0, pad).padEnd(pad)));
  console.log(boxLine('bot', w));
  console.log('');
}

export function printTips() {
  const tips = [
    'Use /swarm to launch the Digital Corporation hierarchical agent fleet.',
    'ZilMate knows your workspace, git status, jobs, and memory — ask it to continue where you left off.',
    'Delegate coding to the coding agent; it can spawn appBuilder and qaIntegration sub-coders.',
    'Real-world business tools (Stripe, HubSpot, GitHub) are available through departmental agents.',
    'Run /heal after long sessions to save learnings to your notebook and knowledge graph.',
  ];
  console.log(theme.textBright('Tips for getting started:'));
  tips.forEach((tip, index) => {
    console.log(`  ${theme.brand(String(index + 1))}. ${theme.text(tip)}`);
  });
  console.log('');
}

export function printUserTurn(message: string) {
  const w = termWidth(92);
  const padding = 4; // Length of '│ > '
  const innerWidth = Math.max(10, w - padding - 2);
  const lines = wrapText(message, innerWidth);

  // Filter out excessive empty lines that might come from pasting
  const displayLines = lines.filter((line, i) => {
    const prev = lines[i - 1];
    return line.trim() || (i > 0 && prev !== undefined && prev.trim());
  });

  console.log('');
  console.log(boxLine('top', w));
  for (const line of displayLines) {
    console.log(theme.accent('│ ') + theme.textBright(`> ${line}`));
  }
  console.log(boxLine('bot', w));
}

export function printAssistantTurn(markdown: string) {
  console.log('');
  console.log(theme.agentLabel('ZilMate'));
  console.log(theme.dim('─'.repeat(Math.min(termWidth() - 4, 72))));
  console.log(renderMarkdown(markdown));
  console.log('');
}

export function printToolStart(name: string, detail?: string) {
  const label = detail ? `${name}(${detail})` : name;
  console.log(`${theme.ok('●')} ${theme.tool(label)}`);
}

export function printToolDone(summary: string) {
  console.log(`${theme.dim('  └')} ${theme.muted(summary)}`);
}

export function printThinkingStatus(label = 'ZilMate is thinking') {
  console.log(`${theme.thinking('✶')} ${theme.thinking(label)} ${theme.dim('(Ctrl+C to interrupt)')}`);
}
