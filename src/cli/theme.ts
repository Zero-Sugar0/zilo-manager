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

  // Department Colors & Icons
  departments: {
    Strategy: { color: chalk.hex('#0EA5E9'), icon: '🎯' },
    Engineering: { color: chalk.hex('#F43F5E'), icon: '🛠️' },
    Growth: { color: chalk.hex('#10B981'), icon: '📈' },
    Operations: { color: chalk.hex('#F59E0B'), icon: '⚙️' },
    Data: { color: chalk.hex('#8B5CF6'), icon: '📊' },
    Security: { color: chalk.hex('#14B8A6'), icon: '🛡️' },
    Revenue: { color: chalk.hex('#EC4899'), icon: '💰' },
    General: { color: chalk.hex('#94A3B8'), icon: '🌐' },
  }
};

export type SwarmDepartment = keyof typeof theme.departments;

export function getDeptTheme(dept?: string) {
  const d = (dept || 'General') as SwarmDepartment;
  return theme.departments[d] || theme.departments.General;
}

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

export function boxLine(char: 'top' | 'mid' | 'bot', width: number, customColor = theme.accent) {
  const inner = Math.max(20, width - 2);
  if (char === 'top') return customColor(`╭${'─'.repeat(inner)}╮`);
  if (char === 'bot') return customColor(`╰${'─'.repeat(inner)}╯`);
  return theme.panel(`├${'─'.repeat(inner)}┤`);
}

export function agentCard(agentName: string, dept: string, content: string, width = 80) {
  const { color, icon } = getDeptTheme(dept);
  const innerWidth = width - 4;
  const lines = wrapText(content, innerWidth);

  const header = color(`╭─ ${icon} ${agentName.toUpperCase()} ──`);
  const top = header + color('─'.repeat(Math.max(0, width - header.length - 1)) + '╮');

  const result = [top];
  for (const line of lines) {
    result.push(color('│ ') + theme.text(line) + color(' │'));
  }
  result.push(color(`╰${'─'.repeat(width - 2)}╯`));
  return result.join('\n');
}

export function toolBadge(name: string, status: 'start' | 'end' | 'error' = 'start') {
  const icon = status === 'start' ? '▶' : status === 'error' ? '✖' : '✔';
  const color = status === 'start' ? theme.tool : status === 'error' ? theme.error : theme.ok;
  return color(`${icon} [${name}]`);
}
