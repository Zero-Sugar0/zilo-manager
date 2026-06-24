// src/cli/theme.ts
import chalk from 'chalk';

export const theme = {
  accent: chalk.hex('#FF6B35'),
  accentSoft: chalk.hex('#FFB347'),
  brand: chalk.hex('#22D3EE'),
  brandBright: chalk.hex('#67E8F9'),
  ok: chalk.hex('#4ADE80'),
  warn: chalk.hex('#FBBF24'),
  error: chalk.hex('#F87171'),
  muted: chalk.hex('#94A3B8'),
  dim: chalk.hex('#64748B'),
  text: chalk.hex('#E2E8F0'),
  textBright: chalk.hex('#F8FAFC'),
  panel: chalk.hex('#334155'),
  box: chalk.hex('#475569'),
  userBg: chalk.bgHex('#1E293B'),
  agentLabel: chalk.bold.hex('#22D3EE'),
  tool: chalk.hex('#A78BFA'),
  subagent: chalk.hex('#F472B6'),
  thinking: chalk.hex('#FB923C'),
  // Department colors
  deptStrategy: chalk.hex('#0EA5E9'),
  deptEngineering: chalk.hex('#F43F5E'),
  deptGrowth: chalk.hex('#10B981'),
  deptOperations: chalk.hex('#F59E0B'),
  deptData: chalk.hex('#8B5CF6'),
};

export function termWidth(max = 100) {
  return Math.min(process.stdout.columns || 80, max);
}

/**
 * Wraps text to a specific width, preserving paragraphs.
 */
export function wrapText(text: string, width: number): string[] {
  const result: string[] = [];
  const paragraphs = text.split('\n');
  for (const paragraph of paragraphs) {
    if (!paragraph.trim()) {
      result.push('');
      continue;
    }
    const words = paragraph.split(/\s+/);
    let currentLine = '';
    for (const word of words) {
      if (!currentLine) {
        currentLine = word;
      } else if ((currentLine + ' ' + word).length <= width) {
        currentLine += ' ' + word;
      } else {
        result.push(currentLine.padEnd(width));
        currentLine = word;
      }
    }
    if (currentLine) result.push(currentLine.padEnd(width));
  }
  return result;
}

export function boxLine(char: 'top' | 'mid' | 'bot', width: number) {
  const inner = Math.max(20, width - 2);
  if (char === 'top') return theme.accent(`╭${'─'.repeat(inner)}╮`);
  if (char === 'bot') return theme.accent(`╰${'─'.repeat(inner)}╯`);
  return theme.panel(`├${'─'.repeat(inner)}┤`);
}
