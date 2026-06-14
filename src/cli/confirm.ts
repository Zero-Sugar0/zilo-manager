import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import chalk from 'chalk';
import type { ConfirmationHandler } from '../runtime/confirm.js';
import { hasSessionApproval } from '../runtime/confirm.js';

export function createReadlineConfirmation(rl: readline.Interface): ConfirmationHandler {
  return async (request) => {
    const { toolkitSlug, toolSlug, summary, action, access, targetTools, details } = request;

    if (hasSessionApproval(request)) {
      console.log(chalk.gray(`\nApproved for this session: ${toolkitSlug} / ${action || toolSlug}`));
      return true;
    }

    console.log(chalk.yellow(`\nZilMate wants to use ${toolkitSlug}`));
    console.log(`${chalk.gray('Action:')} ${action || 'External app action'}`);
    console.log(`${chalk.gray('Access:')} ${access || 'Write'}`);
    console.log(`${chalk.gray('Tool:')} ${(targetTools && targetTools.length > 0) ? targetTools.join(', ') : toolSlug}`);
    if (details && details.length > 0) {
      console.log(chalk.gray('Details:'));
      for (const detail of details) {
        if (detail.trim()) console.log(`- ${detail}`);
      }
    } else {
      console.log(`${chalk.gray('Details:')} ${summary}`);
    }

    const answer = (await rl.question('Proceed? (y/N/s=session) ')).trim().toLowerCase();
    if (answer === 's' || answer === 'session' || answer === 'ys' || answer === 'yes-session') {
      console.log(chalk.green('Approved for this CLI session.'));
      return 'session';
    }
    return answer === 'y' || answer === 'yes';
  };
}

export function createTerminalConfirmation(): ConfirmationHandler {
  return async (request) => {
    if (!process.stdin.isTTY || !process.stdout.isTTY) return false;
    const rl = readline.createInterface({ input, output });
    try {
      return await createReadlineConfirmation(rl)(request);
    } finally {
      rl.close();
    }
  };
}
