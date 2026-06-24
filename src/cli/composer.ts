// src/cli/composer.ts
import readline from 'node:readline/promises';
import { theme, termWidth, boxLine, wrapText } from './theme.js';

export async function readComposerLine(
  rl: readline.Interface,
  placeholder = 'Try "plan my week" or "build a Next.js dashboard"',
): Promise<string> {
  const w = termWidth(92);
  let lines: string[] = [];

  console.log('');
  console.log(boxLine('top', w));
  console.log(theme.accent('│ ') + theme.dim(placeholder));

  let multilineMode = false;

  while (true) {
    const promptPrefix = theme.accent('│ ') + theme.brandBright(lines.length === 0 ? '> ' : '  ');
    const answer = await rl.question(promptPrefix);
    const trimmed = answer.trim();

    if (lines.length === 0 && (trimmed === '/multiline' || trimmed === '/paste')) {
      multilineMode = true;
      console.log(theme.accent('│ ') + theme.muted(' (Multiline mode: Type your message. Send an empty line to finish.)'));
      continue;
    }

    if (multilineMode) {
      if (!trimmed) break;
      lines.push(answer);
      continue;
    }

    if (trimmed.endsWith('\\')) {
      lines.push(answer.slice(0, -1));
      continue;
    }

    lines.push(answer);
    break;
  }

  const finalMessage = lines.join('\n');

  // Calculate how many terminal lines we need to clear.
  // This is tricky because the user input might wrap.
  const promptLen = 4; // length of "│ > "
  let linesUsed = 1; // Initial newline at top
  linesUsed += 1; // boxLine('top')
  linesUsed += 1; // placeholder line

  if (multilineMode) {
    linesUsed += 1; // The "(Multiline mode...)" hint line
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line !== undefined) {
      const wrapped = wrapText(line, w - promptLen);
      linesUsed += Math.max(1, wrapped.length);
    }
  }

  if (multilineMode) {
    linesUsed += 1; // The final empty line entered to exit multiline mode
  }

  // Account for the fact that we might have had the command line /multiline too
  if (multilineMode) {
      linesUsed += 1;
  }

  // Clear everything we just printed to replace it with the pretty box
  for (let i = 0; i < linesUsed; i++) {
    process.stdout.write('\x1b[1A\x1b[2K');
  }

  return finalMessage;
}
