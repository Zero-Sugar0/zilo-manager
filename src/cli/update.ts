import { exec, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { printPanel } from './format.js';

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);
const packageName = 'zilmate';

function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function parseVersion(version: string) {
  return version
    .trim()
    .replace(/^v/, '')
    .split('.')
    .map((part) => Number.parseInt(part, 10) || 0);
}

export function compareVersions(left: string, right: string) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const diff = (a[index] ?? 0) - (b[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export async function latestNpmVersion() {
  const { stdout } = process.platform === 'win32'
    ? await execAsync(`${npmCommand()} view ${packageName} version`, { windowsHide: true, timeout: 30_000 })
    : await execFileAsync(npmCommand(), ['view', packageName, 'version'], { windowsHide: true, timeout: 30_000 });
  return stdout.trim();
}

export async function printVersionStatus(currentVersion: string) {
  try {
    const latest = await latestNpmVersion();
    const comparison = compareVersions(currentVersion, latest);
    printPanel('ZilMate version', [
      ['Current', currentVersion],
      ['Latest', latest],
      ['Status', comparison < 0 ? 'update available' : 'up to date'],
      ['Update', comparison < 0 ? 'zilmate update' : '-'],
    ]);
  } catch (error) {
    printPanel('ZilMate version', [
      ['Current', currentVersion],
      ['Latest', 'could not check npm'],
      ['Status', error instanceof Error ? error.message : String(error)],
      ['Manual', 'npm install -g zilmate@latest'],
    ]);
  }
}

export async function runSelfUpdate(options: { tag?: string; dryRun?: boolean } = {}) {
  const tag = options.tag || 'latest';
  if (!/^[A-Za-z0-9._-]+$/.test(tag)) {
    throw new Error('Update tag can only contain letters, numbers, dot, underscore, or dash.');
  }
  const spec = `${packageName}@${tag}`;
  const args = ['install', '-g', spec];
  if (options.dryRun) {
    printPanel('Update dry run', [
      ['Command', `${npmCommand()} ${args.join(' ')}`],
      ['Run', 'zilmate update'],
    ]);
    return;
  }

  printPanel('Updating ZilMate', [
    ['Package', spec],
    ['Command', `${npmCommand()} ${args.join(' ')}`],
  ]);

  try {
    const result = process.platform === 'win32'
      ? await execAsync(`${npmCommand()} ${args.join(' ')}`, { windowsHide: true, timeout: 120_000 })
      : await execFileAsync(npmCommand(), args, { windowsHide: true, timeout: 120_000 });
    const { stdout, stderr } = result;
    if (stdout.trim()) console.log(stdout.trim());
    if (stderr.trim()) console.error(stderr.trim());
    printPanel('Update complete', [
      ['Verify', 'zilmate --version'],
      ['Health', 'zilmate doctor'],
    ]);
  } catch (error: any) {
    let detail = error?.message || String(error);
    const stderr = error?.stderr || '';

    // If there is stderr, it usually contains the real reason (e.g. EPERM, EBUSY)
    if (stderr.trim()) {
      detail = `${detail}\n${stderr.trim()}`;
    }

    // Clean up common messy npm error output
    if (detail.includes('npm warn deprecated')) {
      const parts = detail.split('\n');
      const filtered = parts.filter((p: string) => !p.includes('npm warn deprecated'));
      if (filtered.length > 0) {
        detail = filtered.join('\n').trim();
      }
    }

    const tips: [string, string][] = [
      ['Reason', detail.slice(0, 500) + (detail.length > 500 ? '...' : '')],
      ['Try', `${npmCommand()} install -g ${spec}`],
    ];

    if (process.platform === 'win32') {
      if (detail.includes('EPERM') || detail.includes('EBUSY') || detail.includes('Access is denied')) {
        tips.push(['Note', 'Files might be locked. Close all ZilMate windows and try again in a new terminal.']);
        tips.push(['Admin', 'Try running your terminal as Administrator']);
      }
    } else if (detail.includes('EACCES')) {
      tips.push(['Note', 'Try running with sudo']);
    }

    printPanel('Update failed', tips);
    throw error;
  }
}
