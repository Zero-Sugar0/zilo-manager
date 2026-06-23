import chalk from 'chalk';
import { marked } from 'marked';
import type { Tokens } from 'marked';
import type { ProgressEvent } from '../runtime/progress.js';
import { createActivitySpinner, type ActivitySpinner } from './spinner.js';

const maxWidth = () => Math.min(process.stdout.columns || 96, 120);
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
    .replace(/\\_/g, '_')
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
  if (token.depth === 2) return `${chalk.bold.cyan(text)}\n${chalk.cyan('─'.repeat(Math.min(text.length, 60)))}`;
  return chalk.bold.underline(text);
}

function renderList(token: Tokens.List, indent = 0) {
  const pad = ' '.repeat(indent);
  return token.items
    .map((item, index) => {
      const marker = token.ordered ? chalk.cyan(`${index + 1}.`) : chalk.cyan('•');
      const raw = 'text' in item ? String(item.text) : '';
      const text = renderInline(stripInline(raw).replace(/\n+/g, ' '));
      return `${pad}${marker} ${text}`;
    })
    .join('\n');
}

function renderCode(token: Tokens.Code) {
  const lang = token.lang ? chalk.gray(` ${token.lang}`) : '';
  return `${chalk.gray(`┌─ code${lang}`)}\n${chalk.cyan(token.text)}\n${chalk.gray('└─')}`;
}

function renderBlockquote(token: Tokens.Blockquote) {
  const body = renderTokens(token.tokens || [], 0)
    .split('\n')
    .map((line) => `${chalk.gray('│')} ${chalk.gray.italic(line)}`)
    .join('\n');
  return body;
}

function renderTable(token: Tokens.Table) {
  const rows = [
    token.header.map((cell) => stripInline(cell.text)),
    ...token.rows.map((row) => row.map((cell) => stripInline(cell.text))),
  ];
  const widths = tableWidths(rows[0] || [], rows.slice(1));
  const top = `╭${widths.map((width) => '─'.repeat(width + 2)).join('┬')}╮`;
  const middle = `├${widths.map((width) => '─'.repeat(width + 2)).join('┼')}┤`;
  const bottom = `╰${widths.map((width) => '─'.repeat(width + 2)).join('┴')}╯`;

  const renderMultiLineRow = (row: string[], header = false) => {
    const lines: string[][] = row.map((cell, index) => wrapText(cell, widths[index]!));
    const height = Math.max(...lines.map((l) => l.length));
    const output: string[] = [];

    for (let i = 0; i < height; i++) {
      const parts = lines.map((cellLines, index) => {
        const text = cellLines[i] || '';
        const padded = text.padEnd(widths[index]!);
        return ` ${header ? chalk.bold.cyanBright(padded) : colorCell(padded)} `;
      });
      output.push(`│${parts.join('│')}│`);
    }
    return output.join('\n');
  };

  return [
    chalk.cyan(top),
    renderMultiLineRow(rows[0] || [], true),
    chalk.cyan(middle),
    ...rows.slice(1).map((row) => renderMultiLineRow(row)),
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

/**
 * Wraps text into an array of strings based on a maximum width.
 * Preserves words when possible.
 */
export function wrapText(value: unknown, width: number): string[] {
  const text = value === undefined || value === null ? '' : String(value).replace(/\s+/g, ' ').trim();
  if (text.length <= width) return [text];

  const lines: string[] = [];
  const words = text.split(' ');
  let currentLine = '';

  for (const word of words) {
    if ((currentLine + word).length <= width) {
      currentLine += (currentLine ? ' ' : '') + word;
    } else {
      if (currentLine) lines.push(currentLine);
      if (word.length > width) {
        // Force split long words
        let remaining = word;
        while (remaining.length > width) {
          lines.push(remaining.slice(0, width));
          remaining = remaining.slice(width);
        }
        currentLine = remaining;
      } else {
        currentLine = word;
      }
    }
  }
  if (currentLine) lines.push(currentLine);
  return lines;
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
  const minimums = headers.map((header) => Math.min(Math.max(header.length, 6), 12));
  const natural = headers.map((header, index) => Math.max(header.length, ...rows.map((row) => plain(row[index]).length)));

  // Weights: Give more space to columns with lots of text
  let widths = natural.map((width, index) => Math.max(minimums[index]!, Math.min(width, index === headers.length - 1 ? 60 : 30)));
  let total = widths.reduce((sum, width) => sum + width, 0);

  while (total > available) {
    const index = widths
      .map((width, itemIndex) => ({ width, itemIndex, min: minimums[itemIndex]! }))
      .filter((item) => item.width > item.min)
      .sort((a, b) => b.width - a.width)[0]?.itemIndex;
    if (index === undefined) break;
    widths[index] = widths[index]! - 1;
    total -= 1;
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

  const renderMultiLineRow = (row: string[], header = false) => {
    const lines: string[][] = row.map((cell, index) => wrapText(cell, widths[index]!));
    const height = Math.max(...lines.map((l) => l.length));
    const output: string[] = [];

    for (let i = 0; i < height; i++) {
      const parts = lines.map((cellLines, index) => {
        const text = cellLines[i] || '';
        const padded = text.padEnd(widths[index]!);
        return ` ${header ? chalk.bold.cyanBright(padded) : colorCell(padded)} `;
      });
      output.push(`│${parts.join('│')}│`);
    }
    return output.join('\n');
  };

  console.log(chalk.cyan(top));
  console.log(renderMultiLineRow(headers, true));
  console.log(chalk.cyan(middle));
  rows.forEach((row, index) => {
    console.log(renderMultiLineRow(row));
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
  printProgressWithSpinner(event);
}

let activeSpinner: ActivitySpinner | undefined;

export function createProgressPrinter() {
  return (event: ProgressEvent) => printProgressWithSpinner(event);
}

function printProgressWithSpinner(event: ProgressEvent) {
  if (event.type === 'thinking') {
    if (!activeSpinner) activeSpinner = createActivitySpinner(event.label || 'Thinking');
    else activeSpinner.update(event.label || 'Thinking', event.detail);
    return;
  }

  if (event.type === 'done') {
    activeSpinner?.stop('Ready');
    activeSpinner = undefined;
    console.log(chalk.green(`✓ ${event.label}`));
    return;
  }

  if (activeSpinner) {
    activeSpinner.stop();
    activeSpinner = undefined;
  }

  if (event.type === 'tool:start') {
    const label = event.detail ? `${event.label}(${event.detail.slice(0, 80)})` : event.label;
    console.log(`${chalk.green('●')} ${chalk.hex('#A78BFA')(label)}`);
    return;
  }

  if (event.type === 'tool:end') {
    const summary = event.detail ? `${event.label} · ${event.detail.slice(0, 100)}` : event.label;
    console.log(`${chalk.gray('  └')} ${chalk.gray(summary)}`);
    return;
  }

  if (event.type === 'subagent:start') {
    const isDept = event.agent?.startsWith('dept:');
    const deptName = isDept ? event.agent!.split(':')[1] : null;
    const color = deptName === 'Strategy' ? chalk.hex('#0EA5E9') :
                  deptName === 'Engineering' ? chalk.hex('#F43F5E') :
                  deptName === 'Growth' ? chalk.hex('#10B981') :
                  deptName === 'Revenue' ? chalk.hex('#EC4899') :
                  deptName === 'Operations' ? chalk.hex('#F59E0B') :
                  deptName === 'Security' ? chalk.hex('#14B8A6') :
                  deptName === 'Data' ? chalk.hex('#8B5CF6') : chalk.magenta;

    console.log(color(`\n╭─ ${event.agent || 'subagent'} ─ ${event.label}`));
    if (event.detail) console.log(chalk.gray(`│  ${clip(event.detail, maxWidth() - 6)}`));
    console.log(color('╰─'));
    return;
  }

  const icons: Record<ProgressEvent['type'], string> = {
    thinking: '…',
    step: '→',
    'tool:start': '▶',
    'tool:end': '✓',
    'tool:error': '!',
    'search:start': '⌕',
    'search:end': '✓',
    'fetch:start': '↓',
    'fetch:end': '✓',
    done: '✓',
    'subagent:start': '◆',
    'subagent:step': '│',
    'subagent:end': '◆',
  };
  const colors: Record<ProgressEvent['type'], (value: string) => string> = {
    thinking: chalk.gray,
    step: chalk.magenta,
    'tool:start': chalk.cyan,
    'tool:end': chalk.green,
    'tool:error': chalk.red,
    'search:start': chalk.blue,
    'search:end': chalk.green,
    'fetch:start': chalk.blue,
    'fetch:end': chalk.green,
    done: chalk.green,
    'subagent:start': chalk.bold.magenta,
    'subagent:step': chalk.magenta,
    'subagent:end': chalk.bold.green,
  };

  const icon = icons[event.type];
  const color = colors[event.type];
  const prefix = event.agent && event.type.startsWith('subagent') ? chalk.magenta(`[${event.agent}] `) : '';
  const detail = event.detail ? chalk.gray(` — ${event.detail.length > 120 ? `${event.detail.slice(0, 117)}...` : event.detail}`) : '';
  console.log(`${prefix}${color(`${icon} ${event.label}`)}${detail}`);
}

export function printError(message: string) {
  console.error(chalk.red(message));
}


