import chalk from 'chalk';
import logUpdate from 'log-update';
import { marked } from 'marked';
import type { Tokens } from 'marked';
import type { ProgressEvent } from '../runtime/progress.js';
import { getDeptTheme, toolBadge, wrapText, theme as zilTheme, boxLine } from './theme.js';

const maxWidth = () => Math.min(process.stdout.columns || 96, 110);
const divider = (color = chalk.gray) => color('─'.repeat(Math.min(maxWidth(), 88)));
const zilmateBanner = String.raw`
███████╗██╗██╗     ███╗   ███╗ █████╗ ████████╗███████╗
╚══███╔╝██║██║     ████╗ ████║██╔══██╗╚══██╔══╝██╔════╝
  ███╔╝ ██║██║     ██╔████╔██║███████║   ██║   █████╗
 ███╔╝  ██║██║     ██║╚██╔╝██║██╔══██║   ██║   ██╔══╝
███████╗██║███████╗██║ ╚═╝ ██║██║  ██║   ██║   ███████╗
╚══════╝╚═╝╚══════╝╚═╝     ╚═╝╚═╝  ╚═╝   ╚═╝   ╚══════╝
`;

function stripInline(markdown: string) {
  return markdown
    .replace(/\_/g, '_')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .trim();
}

function protectMachineTokens(markdown: string) {
  return markdown.replace(/\b[A-Z][A-Z0-9]+(?:_[A-Z0-9]+)+\b/g, (token) => token.replace(/_/g, '\\_'));
}

function renderInline(markdown: string) {
  return markdown
    .replace(/\\_/g, '_')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, text, href) => `${chalk.blue.underline(text)} ${chalk.gray(`(${href})`)}`)
    .replace(/`([^`]+)`/g, (_match, code) => chalk.yellow(String(code).replace(/\\_/g, '_')))
    .replace(/\*\*([^*]+)\*\*/g, (_match, text) => chalk.bold(text))
    .replace(/__([^_]+)__/g, (_match, text) => chalk.bold(text))
    .replace(/\*([^*]+)\*/g, (_match, text) => chalk.italic(text));
}

function renderHeading(token: Tokens.Heading) {
  const text = stripInline(token.text);
  if (token.depth === 1) {
    return `${chalk.cyan(divider())}\n${chalk.bold.cyanBright(text)}\n${chalk.cyan(divider())}`;
  }
  if (token.depth === 2) {
    return `\n${chalk.bold.cyan(text)}\n${chalk.cyan('─'.repeat(Math.min(text.length + 2, 40)))}`;
  }
  return `\n${chalk.bold.white(text)}`;
}

function renderList(token: Tokens.List, indent = 0) {
  const bullet = token.ordered ? (i: number) => chalk.cyan(`${i + 1}.`) : () => chalk.cyan('•');
  return token.items
    .map((item, i) => `${'  '.repeat(indent)}${bullet(i)} ${renderInline(item.text)}`)
    .join('\n');
}

function renderCode(token: Tokens.Code) {
  const text = token.text.trim();
  const border = chalk.gray('│');
  return text.split('\n').map(line => `${border} ${chalk.yellow(line)}`).join('\n');
}

function renderBlockquote(token: Tokens.Blockquote) {
  return chalk.italic.gray(token.text.trim().split('\n').map(l => `> ${l}`).join('\n'));
}

export function wrapCellText(text: string, width: number): string[] {
  const str = text === undefined || text === null ? '' : String(text).replace(/\s+/g, ' ').trim();
  const w = Math.max(1, width);
  if (str.length === 0) {
    return [''.padEnd(w)];
  }
  const lines: string[] = [];
  let remaining = str;
  while (remaining.length > 0) {
    if (remaining.length <= w) {
      lines.push(remaining.padEnd(w));
      break;
    }
    let splitAt = remaining.lastIndexOf(' ', w);
    if (splitAt === -1 || splitAt === 0) {
      splitAt = w;
    }
    const chunk = remaining.slice(0, splitAt).trim();
    lines.push(chunk.padEnd(w));
    remaining = remaining.slice(splitAt).trim();
  }
  return lines;
}

function renderTable(token: Tokens.Table) {
  const headers = token.header.map(h => stripInline(h.text));
  const rows = token.rows.map(row => row.map(cell => stripInline(cell.text)));
  return renderTableString(headers, rows);
}

function renderTableString(headers: string[], rows: string[][]) {
  if (rows.length === 0) return '';
  const widths = tableWidths(headers, rows);
  const top = `╭${widths.map((width) => '─'.repeat(width + 2)).join('┬')}╮`;
  const middle = `├${widths.map((width) => '─'.repeat(width + 2)).join('┼')}┤`;
  const bottom = `╰${widths.map((width) => '─'.repeat(width + 2)).join('┴')}╯`;

  const renderRowLines = (row: string[], header = false) => {
    const cellLines = row.map((cell, index) => wrapCellText(cell, widths[index] ?? 12));
    const maxLines = Math.max(...cellLines.map(lines => lines.length));
    
    const lines: string[] = [];
    for (let lineIdx = 0; lineIdx < maxLines; lineIdx++) {
      const lineCells = cellLines.map((lines, colIdx) => {
        const value = lines[lineIdx] || ''.padEnd(widths[colIdx] ?? 12);
        return ` ${header ? chalk.bold.cyanBright(value) : colorCell(value)} `;
      });
      lines.push(`│${lineCells.join('│')}│`);
    }
    return lines.join('\n');
  };

  return [
    chalk.cyan(top),
    renderRowLines(headers, true),
    chalk.cyan(middle),
    ...rows.map((row) => renderRowLines(row)),
    chalk.cyan(bottom),
  ].join('\n');
}

function renderTokens(tokens: unknown[], indent = 0): string {
  const chunks: string[] = [];
  for (const rawToken of tokens) {
    const token = rawToken as Tokens.Generic;
    switch (token.type) {
      case 'heading':
        chunks.push(renderHeading(token as Tokens.Heading));
        break;
      case 'paragraph':
        chunks.push(renderInline(token.text));
        break;
      case 'list':
        chunks.push(renderList(token as Tokens.List, indent));
        break;
      case 'code':
        chunks.push(renderCode(token as Tokens.Code));
        break;
      case 'blockquote':
        chunks.push(renderBlockquote(token as Tokens.Blockquote));
        break;
      case 'table':
        chunks.push(renderTable(token as Tokens.Table));
        break;
      case 'hr':
        chunks.push(divider());
        break;
      case 'space':
        break;
      default:
        if ('raw' in token) chunks.push(renderInline(String(token.raw).trim()));
    }
  }
  return chunks.filter(Boolean).join('\n\n');
}

export function renderMarkdown(markdown: string) {
  const cleaned = protectMachineTokens(markdown.trim());
  if (!cleaned) return '';
  return renderTokens(marked.lexer(cleaned));
}

export function printMarkdown(markdown: string) {
  console.log(renderMarkdown(markdown));
}

export function printJson(value: unknown) {
  console.log(chalk.gray(JSON.stringify(value, null, 2)));
}

export function clip(value: unknown, width: number) {
  const text = value === undefined || value === null ? '' : String(value).replace(/\s+/g, ' ').trim();
  if (text.length <= width) return text.padEnd(width);
  return `${text.slice(0, Math.max(0, width - 1))}…`;
}

function plain(value: unknown) {
  return value === undefined || value === null ? '' : String(value).replace(/\s+/g, ' ').trim();
}

export function printPanel(title: string, rows: Array<[string, string]>) {
  const width = Math.min(maxWidth(), 88);
  console.log(chalk.cyan(`╭${'─'.repeat(width - 2)}╮`));
  console.log(chalk.cyan('│') + chalk.bold.cyanBright(` ${clip(title, width - 4)} `) + chalk.cyan('│'));
  console.log(chalk.cyan(`├${'─'.repeat(width - 2)}┤`));
  for (const [label, value] of rows) {
    const line = `${label.padEnd(20)} ${value}`;
    console.log(chalk.cyan('│') + ` ${clip(line, width - 4)} ` + chalk.cyan('│'));
  }
  console.log(chalk.cyan(`╰${'─'.repeat(width - 2)}╯`));
}

function colorCell(value: string) {
  const trimmed = value.trim().toLowerCase();
  if (['pass', 'ready', 'enabled', 'yes', 'succeeded', 'running', 'configured'].includes(trimmed)) return chalk.green(value);
  if (['queued', 'warn', 'warning', 'local fallback', 'local schedules only'].includes(trimmed)) return chalk.yellow(value);
  if (['fail', 'failed', 'error', 'missing', 'no'].includes(trimmed)) return chalk.red(value);
  if (['off', 'disabled', 'skipped', 'none', '-'].includes(trimmed)) return chalk.gray(value);
  if (/^job_[a-f0-9-]+/i.test(trimmed)) return chalk.cyan(value);
  return value;
}

function tableWidths(headers: string[], rows: string[][]) {
  const available = Math.max(40, maxWidth() - headers.length * 3 - 1);
  const minimums = headers.map((header) => Math.min(Math.max(header.length, 4), 12));
  const natural = headers.map((header, index) => Math.max(header.length, ...rows.map((row) => plain(row[index]).length)));
  
  const totalNatural = natural.reduce((sum, w) => sum + w, 0);
  if (totalNatural <= available) {
    return natural;
  }

  let widths = [...minimums];
  let total = widths.reduce((sum, w) => sum + w, 0);
  if (total >= available) {
    return widths;
  }

  let remaining = available - total;
  while (remaining > 0) {
    let bestIndex = -1;
    let maxDiff = -1;
    for (let i = 0; i < widths.length; i++) {
      const diff = natural[i]! - widths[i]!;
      if (diff > maxDiff) {
        maxDiff = diff;
        bestIndex = i;
      }
    }

    if (bestIndex === -1 || maxDiff <= 0) {
      break;
    }

    widths[bestIndex]! += 1;
    remaining -= 1;
  }

  return widths;
}

export function printTable(headers: string[], rows: string[][]) {
  if (rows.length === 0) {
    printPanel('Table', [['Status', 'No rows']]);
    return;
  }

  const widths = tableWidths(headers, rows);
  const top = `╭${widths.map((width) => '─'.repeat(width + 2)).join('┬')}╮`;
  const middle = `├${widths.map((width) => '─'.repeat(width + 2)).join('┼')}┤`;
  const bottom = `╰${widths.map((width) => '─'.repeat(width + 2)).join('┴')}╯`;

  const renderRowLines = (row: string[], header = false) => {
    const cellLines = row.map((cell, index) => wrapCellText(cell, widths[index] ?? 12));
    const maxLines = Math.max(...cellLines.map(lines => lines.length));
    
    const lines: string[] = [];
    for (let lineIdx = 0; lineIdx < maxLines; lineIdx++) {
      const lineCells = cellLines.map((lines, colIdx) => {
        const value = lines[lineIdx] || ''.padEnd(widths[colIdx] ?? 12);
        return ` ${header ? chalk.bold.cyanBright(value) : colorCell(value)} `;
      });
      lines.push(`│${lineCells.join('│')}│`);
    }
    return lines.join('\n');
  };

  console.log(chalk.cyan(top));
  console.log(renderRowLines(headers, true));
  console.log(chalk.cyan(middle));
  rows.forEach((row, index) => {
    console.log(renderRowLines(row));
    if (index < rows.length - 1) console.log(chalk.gray(`├${widths.map((width) => '─'.repeat(width + 2)).join('┼')}┤`));
  });
  console.log(chalk.cyan(bottom));
}

export function statusText(value: boolean, label = 'on') {
  return value ? chalk.green(label) : chalk.gray('off');
}

export function printZilMateBanner(subtitle?: string) {
  const width = Math.min(maxWidth(), 64);
  const line = '═'.repeat(width);
  console.log(chalk.cyanBright(line));
  console.log(chalk.cyanBright(zilmateBanner));
  if (subtitle) console.log(chalk.whiteBright(`  ${subtitle}`));
  console.log(chalk.gray('  CLI assistant · subagents · memory · jobs · tools'));
  console.log(chalk.cyanBright(line));
}

export function printTitle(title: string, subtitle?: string) {
  console.log(chalk.cyan(divider(chalk.cyan)));
  console.log(chalk.bold.cyanBright(title));
  if (subtitle) console.log(chalk.gray(subtitle));
  console.log(chalk.cyan(divider(chalk.cyan)));
}

export function printStatus(label: string, value: string) {
  console.log(`${chalk.gray(label)} ${chalk.white(value)}`);
}

export function printAssistant(markdown: string) {
  console.log(chalk.bold.cyan('\nZilMate'));
  console.log(divider());
  printMarkdown(markdown);
  console.log('');
}

export function printUserPrompt() {
  return chalk.bold.green('You> ');
}

export function printThinking() {
  printProgress({ type: 'thinking', label: 'Thinking' });
}

export function printProgress(event: ProgressEvent) {
  printProgressWithSticky(event);
}

export function createProgressPrinter() {
  return (event: ProgressEvent) => printProgressWithSticky(event);
}

// ─── Formatting helpers ───────────────────────────────────────────────────────
export function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

export function padAnsiLine(line: string, targetWidth: number): string {
  const visibleLen = stripAnsi(line).length;
  if (visibleLen >= targetWidth) {
    return line;
  }
  return line + ' '.repeat(targetWidth - visibleLen);
}

export function renderMarkdownToBoxLines(markdown: string, width: number): string[] {
  const cleaned = protectMachineTokens(markdown.trim());
  if (!cleaned) return [];
  const tokens = marked.lexer(cleaned);
  const lines: string[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token) continue;

    // Handle space tokens
    if (token.type === 'space') {
      if (lines.length > 0 && lines[lines.length - 1] !== '') {
        lines.push('');
      }
      continue;
    }

    switch (token.type) {
      case 'heading': {
        const headingToken = token as Tokens.Heading;
        const wrapped = wrapText(headingToken.text, width);
        wrapped.forEach(line => {
          lines.push(chalk.bold.cyan(renderInline(line)));
        });
        break;
      }
      case 'paragraph': {
        const paragraphToken = token as Tokens.Paragraph;
        const wrapped = wrapText(paragraphToken.text, width);
        wrapped.forEach(line => {
          lines.push(zilTheme.text(renderInline(line)));
        });
        break;
      }
      case 'list': {
        const listToken = token as Tokens.List;
        listToken.items.forEach((item, idx) => {
          const bullet = listToken.ordered ? `${idx + 1}. ` : '• ';
          const bulletLen = bullet.length;
          const wrapped = wrapText(item.text, width - bulletLen);
          if (wrapped.length > 0) {
            lines.push(chalk.cyan(bullet) + zilTheme.text(renderInline(wrapped[0]!)));
            for (let j = 1; j < wrapped.length; j++) {
              lines.push(' '.repeat(bulletLen) + zilTheme.text(renderInline(wrapped[j]!)));
            }
          }
        });
        break;
      }
      case 'code': {
        const codeToken = token as Tokens.Code;
        const codeLines = codeToken.text.split('\n');
        codeLines.forEach(line => {
          const wrapped = wrapText(line, width - 2);
          wrapped.forEach((wl, idx) => {
            const prefix = idx === 0 ? '▕ ' : '  ';
            lines.push(chalk.gray(prefix) + chalk.yellow(wl));
          });
        });
        break;
      }
      case 'blockquote': {
        const blockquoteToken = token as Tokens.Blockquote;
        const wrapped = wrapText(blockquoteToken.text, width - 2);
        wrapped.forEach(line => {
          lines.push(chalk.gray('│ ') + chalk.italic(renderInline(line)));
        });
        break;
      }
      case 'hr': {
        lines.push(chalk.gray('─'.repeat(width)));
        break;
      }
      default: {
        if ('raw' in token) {
          const wrapped = wrapText(String(token.raw).trim(), width);
          wrapped.forEach(line => {
            lines.push(zilTheme.text(renderInline(line)));
          });
        }
      }
    }

    // Add an empty line between blocks, unless it's the last block or next is space
    if (i < tokens.length - 1 && tokens[i+1]?.type !== 'space') {
      lines.push('');
    }
  }

  return lines;
}

export function agentCard(agentName: string, dept: string, content: string, width = 80) {
  const { color, icon } = getDeptTheme(dept);
  const innerWidth = width - 4;
  
  // Render markdown to box lines of width innerWidth
  const lines = renderMarkdownToBoxLines(content, innerWidth);

  const header = color(`╭─ ${icon} ${agentName.toUpperCase()} ──`);
  const visibleHeaderLen = stripAnsi(header).length;
  const top = header + color('─'.repeat(Math.max(0, width - visibleHeaderLen - 1)) + '╮');

  const result = [top];
  for (const line of lines) {
    const padded = padAnsiLine(line, innerWidth);
    result.push(color('│ ') + padded + color(' │'));
  }
  result.push(color(`╰${'─'.repeat(width - 2)}╯`));
  return result.join('\n');
}

// ─── Display state ────────────────────────────────────────────────────────────
// Tracks the active specialist panel so tool calls inside it can be indented.
interface DisplayState {
  activeSpecialist: string | null;
  activeDept: string | null;
  stepCount: number;
  toolStartTimes: Map<string, number>;
  sessionStart: number;
  thinkStart: number;
}

const displayState: DisplayState = {
  activeSpecialist: null,
  activeDept: null,
  stepCount: 0,
  toolStartTimes: new Map(),
  sessionStart: Date.now(),
  thinkStart: 0,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtMs(ms: number): string {
  if (ms < 1000) return chalk.gray(`${ms}ms`);
  return chalk.gray(`${(ms / 1000).toFixed(1)}s`);
}

function formatWorkedTime(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) {
    const secs = ms / 1000;
    return `${secs.toFixed(1)}s`;
  }

  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;

  if (secs === 0) {
    return `${mins}${mins === 1 ? 'min' : 'mins'}`;
  }
  return `${mins}m ${secs}s`;
}

function fmtElapsed(startMs: number): string {
  return fmtMs(Date.now() - startMs);
}

/** Right-align a string to fill the terminal width, padding with spaces */
function rightAlign(left: string, right: string, width: number): string {
  // ANSI escape codes add invisible chars — approximate visible length by stripping them
  const visibleLeft = left.replace(/\x1b\[[0-9;]*m/g, '');
  const visibleRight = right.replace(/\x1b\[[0-9;]*m/g, '');
  const gap = Math.max(1, width - visibleLeft.length - visibleRight.length);
  return left + ' '.repeat(gap) + right;
}

function truncate(str: string, max: number): string {
  if (!str) return '';
  const s = str.replace(/\n/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** Indent prefix: '' for CEO-level, '  ' for COO, '    ' for specialist tools */
function indent(): string {
  return displayState.activeSpecialist ? '    ' : '  ';
}

// ─── Specialist panel renderers ───────────────────────────────────────────────
function openSpecialistPanel(name: string, dept: string, detail?: string) {
  const w = Math.min(maxWidth(), 90);
  const { color, icon } = getDeptTheme(dept);
  const deptLabel = `${icon} ${dept.toUpperCase()} · ${name}`;
  const header = color(`╭─ ${deptLabel} ──`);
  const visibleHeaderLen = stripAnsi(header).length;
  const top = header + color('─'.repeat(Math.max(0, w - visibleHeaderLen - 1)) + '╮');

  console.log('');
  // Panel header: ╭─ 🎯 STRATEGY · Market Analyst ──────────────────────────╮
  console.log(top);
  if (detail) {
    const inner = w - 4;
    const lines = wrapText(truncate(detail, inner * 2), inner);
    for (const line of lines.slice(0, 2)) {
      const padded = padAnsiLine(chalk.hex('#94A3B8')(line), inner);
      console.log(color('│ ') + padded + color(' │'));
    }
    console.log(color(`├${'─'.repeat(w - 2)}┤`));
  }
}

function closeSpecialistPanel(name: string, dept: string, durationMs?: number) {
  const w = Math.min(maxWidth(), 90);
  const { color } = getDeptTheme(dept);
  const timing = durationMs !== undefined ? `  ${fmtMs(durationMs)}` : '';
  const doneLabel = chalk.green('✔ done') + timing;
  const visibleLen = stripAnsi(doneLabel).length;
  const pad = Math.max(0, w - visibleLen - 4);
  console.log(color(`╰${'─'.repeat(pad)}╯`) + ' ' + doneLabel);
  console.log('');
}

// ─── Thinking ticker state ────────────────────────────────────────────────────
let thinkingTimer: NodeJS.Timeout | null = null;
let thinkingFrame = 0;
let thinkingLabel = 'Thinking';

function triggerThinkingTick() {
  const w = Math.min(maxWidth(), 90);
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  const elapsed = fmtElapsed(displayState.thinkStart || Date.now());
  const hint = chalk.gray('(Ctrl+C to interrupt)');
  const spinner = frames[thinkingFrame % frames.length]!;
  thinkingFrame++;

  const leftText = `${zilTheme.thinking(spinner)} ${zilTheme.thinking(thinkingLabel)}`;
  const rightText = `${hint}  ${elapsed}`;
  
  const innerW = w - 4;
  const aligned = rightAlign(leftText, rightText, innerW);

  const top = boxLine('top', w, zilTheme.thinking);
  const mid = zilTheme.thinking('│ ') + aligned + zilTheme.thinking(' │');
  const bot = boxLine('bot', w, zilTheme.thinking);

  logUpdate(`${top}\n${mid}\n${bot}`);
}

function startThinkingTicker(label: string) {
  thinkingLabel = label;
  if (thinkingTimer) return;
  thinkingFrame = 0;
  thinkingTimer = setInterval(triggerThinkingTick, 80);
  triggerThinkingTick();
}

function stopThinkingTicker() {
  if (thinkingTimer) {
    clearInterval(thinkingTimer);
    thinkingTimer = null;
  }
}

// ─── Main handler ─────────────────────────────────────────────────────────────
function printProgressWithSticky(event: ProgressEvent) {
  const w = Math.min(maxWidth(), 90);

  // ── Thinking: live animated line via logUpdate ───────────────────────────
  if (event.type === 'thinking') {
    displayState.thinkStart = displayState.thinkStart || Date.now();
    startThinkingTicker(event.label || 'Thinking');
    return;
  }

  // ── Done: clear spinner, show total time ────────────────────────────────
  if (event.type === 'done') {
    stopThinkingTicker();
    logUpdate.clear();
    logUpdate.done();
    const worked = formatWorkedTime(Date.now() - displayState.sessionStart);
    console.log(chalk.green(`✔ ${event.label}`) + chalk.gray(`  (worked for ${worked})`));
    // Reset session state
    displayState.activeSpecialist = null;
    displayState.activeDept = null;
    displayState.stepCount = 0;
    displayState.sessionStart = Date.now();
    displayState.thinkStart = 0;
    return;
  }

  // Clear the live spinner line before printing a permanent line
  logUpdate.clear();

  // ── Specialist start: open department panel ──────────────────────────────
  if (event.type === 'specialist:start') {
    displayState.activeSpecialist = event.agent || event.label;
    displayState.activeDept = event.department || 'General';
    openSpecialistPanel(event.label, displayState.activeDept, event.detail);
  }

  // ── Specialist end: close department panel ───────────────────────────────
  else if (event.type === 'specialist:end') {
    const dept = event.department || displayState.activeDept || 'General';
    closeSpecialistPanel(event.label, dept, event.durationMs);
    displayState.activeSpecialist = null;
    displayState.activeDept = null;
  }

  // ── Tool start ───────────────────────────────────────────────────────────
  else if (event.type === 'tool:start') {
    displayState.toolStartTimes.set(event.label, Date.now());
    const pfx = indent();
    const pipe = displayState.activeSpecialist ? chalk.hex('#475569')('│ ') : '';
    const branch = chalk.hex('#475569')('├─ ');
    const badge = toolBadge(event.label, 'start');
    const detail = event.detail ? chalk.gray(` — ${truncate(event.detail, 72)}`) : '';
    console.log(`${pfx}${pipe}${branch}${badge}${detail}`);
  }

  // ── Tool end ─────────────────────────────────────────────────────────────
  else if (event.type === 'tool:end') {
    const startTime = displayState.toolStartTimes.get(event.label);
    displayState.toolStartTimes.delete(event.label);
    const timing = startTime ? `  ${fmtMs(Date.now() - startTime)}` : '';
    const pfx = indent();
    const pipe = displayState.activeSpecialist ? chalk.hex('#475569')('│ ') : '';
    const elbow = chalk.hex('#475569')('│   └ ');
    const badge = toolBadge(event.label, 'end');
    const detail = event.detail ? chalk.gray(` · ${truncate(event.detail, 60)}`) : '';
    console.log(`${pfx}${pipe}${elbow}${badge}${detail}${timing}`);
  }

  // ── Tool error ───────────────────────────────────────────────────────────
  else if (event.type === 'tool:error') {
    displayState.toolStartTimes.delete(event.label);
    const pfx = indent();
    const pipe = displayState.activeSpecialist ? chalk.hex('#475569')('│ ') : '';
    const elbow = chalk.hex('#475569')('│   └ ');
    const badge = toolBadge(event.label, 'error');
    const err = chalk.red(` — ${truncate(event.detail || 'Failed', 80)}`);
    console.log(`${pfx}${pipe}${elbow}${badge}${err}`);
  }

  // ── Subagent start (non-swarm agents like coding, research) ─────────────
  else if (event.type === 'subagent:start') {
    const isDept = event.agent?.startsWith('dept:');
    const deptName = (isDept ? event.agent!.split(':')[1] : event.department) || 'General';
    const agentDisplay = event.label;
    console.log('');
    console.log(agentCard(agentDisplay, deptName, agentDisplay + (event.detail ? `\n\n${event.detail}` : ''), w));
  }

  // ── Subagent step (e.g. coding agent tool calls) ─────────────────────────
  else if (event.type === 'subagent:step') {
    const agentTag = event.agent ? chalk.hex('#A78BFA')(`[${event.agent}] `) : '';
    console.log(`  ${agentTag}${chalk.hex('#6366F1')('│')} ${chalk.hex('#C4B5FD')(event.label)}`);
  }

  // ── Subagent end ─────────────────────────────────────────────────────────
  else if (event.type === 'subagent:end') {
    const agentTag = event.agent ? chalk.hex('#A78BFA')(`[${event.agent}] `) : '';
    console.log(`  ${agentTag}${chalk.green('◆')} ${chalk.green(event.label)}`);
  }

  // ── Step (Manager/COO summary of tool calls used in a loop step) ─────────
  else if (event.type === 'step') {
    displayState.stepCount += 1;
    const counter = chalk.hex('#64748B')(`[${displayState.stepCount}]`);
    const arrow = chalk.hex('#8B5CF6')('→');
    const label = chalk.hex('#C4B5FD')(event.label);
    const detail = event.detail ? chalk.gray(` · ${truncate(event.detail, 64)}`) : '';
    console.log(`${arrow} ${counter} ${label}${detail}`);
  }

  else {
    // ── Search / fetch events ────────────────────────────────────────────────
    const simpleIcons: Partial<Record<ProgressEvent['type'], string>> = {
      'search:start': '⌕',
      'search:end':   '✓',
      'fetch:start':  '↓',
      'fetch:end':    '✓',
    };
    const simpleColors: Partial<Record<ProgressEvent['type'], (s: string) => string>> = {
      'search:start': chalk.blue,
      'search:end':   chalk.green,
      'fetch:start':  chalk.blue,
      'fetch:end':    chalk.green,
    };

    const icon = simpleIcons[event.type];
    const color = simpleColors[event.type];
    if (icon && color) {
      const detail = event.detail ? chalk.gray(` — ${truncate(event.detail, 80)}`) : '';
      console.log(`  ${color(`${icon} ${event.label}`)}${detail}`);
    }
  }

  // If the thinking ticker is active, trigger an immediate tick to draw the status card
  // at the new bottom of the terminal.
  if (thinkingTimer) {
    triggerThinkingTick();
  }
}

export function printError(message: string) {
  console.error(chalk.red(`✖ ${message}`));
}
