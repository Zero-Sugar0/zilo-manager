import { spawn } from 'node:child_process';

const IS_WIN = process.platform === 'win32';

/** Python CLIs on Windows often abort when stdin is a closed pipe instead of a TTY or NUL device. */
const WIN_INTERACTIVE_CLI = new Set([
  'sherlock', 'blackbird', 'naminter', 'maigret', 'holehe', 'linkook',
  'nmap', 'nuclei', 'subfinder', 'httpx', 'ffuf', 'sqlmap',
]);

function quoteWinArg(arg: string) {
  if (/[\s"&|<>^]/.test(arg)) return `"${arg.replace(/"/g, '\\"')}"`;
  return arg;
}

function buildWinCommand(command: string, args: string[]) {
  const line = [command, ...args.map(quoteWinArg)].join(' ');
  return `${line} < NUL`;
}

export type CliRunOptions = {
  timeoutMs?: number;
  /** Force Windows NUL-stdin wrapper even for unknown commands. */
  interactive?: boolean;
  env?: NodeJS.ProcessEnv;
};

/**
 * Cross-platform CLI runner used by OSINT and pentest tools.
 * On Windows, wraps known interactive CLIs with cmd.exe + NUL stdin.
 */
export function runCliTool(command: string, args: string[], options: CliRunOptions = {}): Promise<string> {
  const timeoutMs = options.timeoutMs ?? 120_000;
  const useWinWrapper = IS_WIN && (options.interactive === true || WIN_INTERACTIVE_CLI.has(command.toLowerCase()));

  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      CI: '1',
      PYTHONUNBUFFERED: '1',
      NO_COLOR: '1',
      ...options.env,
    };

    const spawnArgs = useWinWrapper
      ? { cmd: 'cmd.exe', args: ['/d', '/s', '/c', buildWinCommand(command, args)] }
      : { cmd: command, args };

    const child = spawn(spawnArgs.cmd, spawnArgs.args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: !useWinWrapper && IS_WIN,
      windowsHide: true,
      env,
    });

    let out = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (c) => { out += c; });
    child.stderr.on('data', (c) => { out += c; });
    child.on('error', reject);

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`Tool timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);

    child.on('close', (code) => {
      clearTimeout(timer);
      if (out.trim()) resolve(out);
      else reject(new Error(
        code === 0
          ? `${command} produced no output.`
          : `${command} failed (exit ${code ?? 'unknown'}). On Windows, ensure the tool is on PATH or run installOsintTools / installPentestTools first.`,
      ));
    });
  });
}

export async function commandExists(command: string): Promise<boolean> {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileAsync = promisify(execFile);
  const probe = IS_WIN ? 'where' : 'which';
  try {
    await execFileAsync(probe, [command], { windowsHide: true, timeout: 6_000 });
    return true;
  } catch {
    return false;
  }
}
