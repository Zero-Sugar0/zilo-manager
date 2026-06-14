import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { tool } from 'ai';
import { z } from 'zod';
import { requestConfirmation } from '../runtime/confirm.js';
import { emitProgress } from '../runtime/progress.js';
import { commandExists } from './cli-runner.js';

const execFileAsync = promisify(execFile);

// ─── Platform helpers ────────────────────────────────────────────────────────

const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';
const IS_LINUX = process.platform === 'linux';

async function confirmInstallAction(toolName: string, details: string[]) {
  return requestConfirmation({
    toolkitSlug: 'ZILMATE',
    toolSlug: 'OSINT_INSTALL',
    action: `Install ${toolName}`,
    access: 'Write',
    targetTools: ['ZILMATE_OSINT'],
    details,
    summary: details.join('; '),
  });
}

/**
 * Check whether a Python module is importable.
 * Tries `python` on Windows first (Anaconda compat), then `python3`.
 */
async function pythonModuleExists(module: string): Promise<boolean> {
  const pythons = IS_WIN ? ['python', 'python3'] : ['python3', 'python'];
  for (const py of pythons) {
    try {
      await execFileAsync(py, ['-c', `import ${module}`], { windowsHide: true, timeout: 8_000 });
      return true;
    } catch { /* try next */ }
  }
  return false;
}

/**
 * Run a process and stream stderr/stdout back as a combined string.
 * Resolves even on non-zero exit (many installers use non-zero for warnings).
 */
function runInstallCommand(command: string, args: string[], env?: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      shell: IS_WIN, // Required on Windows so PATH is resolved correctly
    });
    let output = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (c) => { output += c; });
    child.stderr.on('data', (c) => { output += c; });
    child.on('error', reject);
    child.on('close', () => resolve(output));
  });
}

/** pip install — works on all platforms; uses `pip` on Windows, `pip3` on Unix */
async function pipInstall(pkg: string): Promise<string> {
  const pip = IS_WIN ? 'pip' : 'pip3';
  return runInstallCommand(pip, ['install', '--upgrade', pkg]);
}

/** pipx install — preferred for CLI tools; falls back gracefully */
async function pipxInstall(pkg: string): Promise<string> {
  // Ensure pipx is available
  if (!(await commandExists('pipx'))) {
    await pipInstall('pipx');
  }
  return runInstallCommand('pipx', ['install', '--force', pkg]);
}

// ─── Tool definitions ────────────────────────────────────────────────────────

export type InstallResult = {
  tool: string;
  status: 'installed' | 'already_present' | 'failed';
  detail: string;
};

const OSINT_TOOLS = [
  // ── Username scanners ──────────────────────────────────────────────────────

  {
    name: 'sherlock',
    description: 'Username scanner across 300+ social networks',
    check: () => commandExists('sherlock'),
    install: async () => {
      // pipx is the recommended method since 2025
      return pipxInstall('sherlock-project');
    },
  },

  {
    name: 'maigret',
    description: 'Deep username dossier across 3,000+ sites',
    check: () => commandExists('maigret'),
    install: async () => {
      // pip3 install maigret is the official PyPI method
      return pipInstall('maigret');
    },
  },

  {
    name: 'blackbird',
    description: 'Username + email scanner (WhatsMyName, 600+ sites) with PDF export',
    check: () => commandExists('blackbird'),
    install: async (): Promise<string> => {
      // Blackbird ships as a Python CLI via pip
      const out = await pipInstall('blackbird-osint');
      return out;
    },
  },

  {
    name: 'naminter',
    description: 'TLS-impersonation username scanner (bypasses Cloudflare)',
    check: () => commandExists('naminter'),
    install: async () => pipInstall('naminter'),
  },

  {
    name: 'linkook',
    description: 'Recursive profile link mapper',
    check: () => commandExists('linkook'),
    install: async () => pipInstall('linkook'),
  },

  // ── Email / identity tools ─────────────────────────────────────────────────

  {
    name: 'holehe',
    description: 'Silent email registration check across 120+ platforms',
    check: () => commandExists('holehe'),
    install: async () => {
      // Official: pip3 install holehe
      return pipInstall('holehe');
    },
  },

  // ── Phone ──────────────────────────────────────────────────────────────────

  {
    name: 'phoneinfoga',
    description: 'International phone number intelligence scanner',
    check: () => commandExists('phoneinfoga'),
    install: async (): Promise<string> => {
      if (IS_MAC) {
        // Homebrew is the cleanest Mac install
        if (await commandExists('brew')) {
          return runInstallCommand('brew', ['install', 'sundowndev/tap/phoneinfoga']);
        }
      }
      if (IS_LINUX) {
        // Official bash installer (fetches the right binary for arch)
        return runInstallCommand('bash', [
          '-c',
          'bash <( curl -sSL https://raw.githubusercontent.com/sundowndev/phoneinfoga/master/support/scripts/install )',
        ]);
      }
      if (IS_WIN) {
        // Windows: download the .exe via PowerShell into %USERPROFILE%\bin
        return runInstallCommand('powershell.exe', [
          '-NoProfile',
          '-Command',
          `
$dir = "$env:USERPROFILE\\bin"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$url = "https://github.com/sundowndev/phoneinfoga/releases/latest/download/phoneinfoga_Windows_x86_64.zip"
$zip = "$env:TEMP\\phoneinfoga.zip"
Invoke-WebRequest -Uri $url -OutFile $zip
Expand-Archive -Path $zip -DestinationPath $dir -Force
Write-Output "PhoneInfoga extracted to $dir — ensure $dir is on your PATH"
          `.trim(),
        ]);
      }
      return 'Unsupported platform for PhoneInfoga auto-install. See: https://sundowndev.github.io/phoneinfoga/getting-started/install/';
    },
  },

  // ── Domain recon ──────────────────────────────────────────────────────────

  {
    name: 'theHarvester',
    description: 'Domain email/subdomain/employee harvester',
    check: () => commandExists('theHarvester'),
    install: async (): Promise<string> => {
      if (IS_LINUX || IS_MAC) {
        // Clone & pip-install is the most reliable method (apt version often lags)
        const out = await runInstallCommand('bash', [
          '-c',
          [
            'git clone https://github.com/laramies/theHarvester /tmp/theHarvester 2>&1 || true',
            'cd /tmp/theHarvester',
            'pip3 install -r requirements/base.txt',
            'pip3 install -e .',
          ].join(' && '),
        ]);
        return out;
      }
      if (IS_WIN) {
        return runInstallCommand('powershell.exe', [
          '-NoProfile', '-Command',
          'git clone https://github.com/laramies/theHarvester $env:TEMP\\theHarvester; cd $env:TEMP\\theHarvester; pip install -r requirements/base.txt; pip install -e .',
        ]);
      }
      return pipInstall('theHarvester');
    },
  },

  // ── Frameworks ────────────────────────────────────────────────────────────

  {
    name: 'spiderfoot',
    description: 'Automated reconnaissance framework (200+ modules)',
    check: () => pythonModuleExists('spiderfoot'),
    install: async (): Promise<string> => {
      if (IS_WIN || IS_MAC || IS_LINUX) {
        // Clone SpiderFoot — pip package may be stale
        const out = await runInstallCommand('bash', [
          '-c',
          [
            'git clone https://github.com/smicallef/spiderfoot /tmp/spiderfoot 2>&1 || true',
            'cd /tmp/spiderfoot',
            'pip3 install -r requirements.txt',
          ].join(' && '),
        ]);
        return out;
      }
      return pipInstall('spiderfoot');
    },
  },

  // ── File forensics ────────────────────────────────────────────────────────

  {
    name: 'exiftool',
    description: 'File metadata extractor (GPS, camera serial, author, etc.)',
    check: () => commandExists('exiftool'),
    install: async (): Promise<string> => {
      if (IS_WIN) {
        // Chocolatey is the easiest Windows path
        if (await commandExists('choco')) {
          return runInstallCommand('choco', ['install', 'exiftool', '-y']);
        }
        // Winget fallback
        if (await commandExists('winget')) {
          return runInstallCommand('winget', ['install', '--id', 'OliverBetz.ExifTool', '--accept-package-agreements', '--accept-source-agreements']);
        }
        return 'Install ExifTool manually: https://exiftool.org/#download (add exiftool.exe to PATH)';
      }
      if (IS_MAC) {
        if (await commandExists('brew')) {
          return runInstallCommand('brew', ['install', 'exiftool']);
        }
        return 'Install Homebrew first: https://brew.sh, then run: brew install exiftool';
      }
      // Linux: apt
      return runInstallCommand('sudo', ['apt-get', 'install', '-y', 'libimage-exiftool-perl']);
    },
  },

  // ── Shodan CLI ────────────────────────────────────────────────────────────

  {
    name: 'shodan',
    description: 'Shodan CLI for querying open ports, services, CVEs',
    check: () => commandExists('shodan'),
    install: async () => pipInstall('shodan'),
  },
] as const;

// ─── Exported tools ──────────────────────────────────────────────────────────

export const osintInstallTools = {
  checkOsintTools: tool({
    description:
      'Check which OSINT tools are already installed on this machine. Always run this before installing to see what is missing.',
    inputSchema: z.object({}),
    execute: async () => {
      const checks = await Promise.all(
        OSINT_TOOLS.map(async (entry) => ({
          tool: entry.name,
          description: entry.description,
          available: await entry.check(),
        })),
      );
      const available = checks.filter((c) => c.available).map((c) => c.tool);
      const missing = checks.filter((c) => !c.available).map((c) => c.tool);
      return {
        platform: process.platform,
        available,
        missing,
        readyForInvestigation: missing.length === 0,
        details: checks,
      };
    },
  }),

  installOsintTools: tool({
    description:
      'Install OSINT tools on this machine. Works cross-platform (Windows/macOS/Linux). Skips tools already present. Optionally target a subset. Run checkOsintTools first.',
    inputSchema: z.object({
      tools: z
        .array(
          z.enum([
            'sherlock', 'maigret', 'blackbird', 'naminter', 'linkook',
            'holehe', 'phoneinfoga', 'theHarvester', 'spiderfoot', 'exiftool', 'shodan',
          ]),
        )
        .optional()
        .describe('Subset to install. Omit to install everything missing.'),
      force: z
        .boolean()
        .optional()
        .default(false)
        .describe('If true, reinstalls even tools already present.'),
    }),
    execute: async ({ tools: subset, force }) => {
      const targets = subset
        ? OSINT_TOOLS.filter((t) => (subset as string[]).includes(t.name))
        : OSINT_TOOLS;

      const results: InstallResult[] = [];

      for (const entry of targets) {
        emitProgress({ type: 'tool:start', label: `Checking ${entry.name}` });
        const exists = await entry.check();

        if (exists && !force) {
          results.push({ tool: entry.name, status: 'already_present', detail: 'Found on PATH — skipped.' });
          emitProgress({ type: 'tool:end', label: `${entry.name} already installed` });
          continue;
        }

        const approved = await confirmInstallAction(entry.name, [
          `Platform: ${process.platform}`,
          `Tool: ${entry.name}`,
          entry.description,
          'Uses pip3/pipx (Python tools), brew (macOS), apt (Linux), choco/winget (Windows)',
          'Network access required — downloads packages from PyPI and GitHub',
        ]);
        if (!approved) {
          results.push({ tool: entry.name, status: 'failed', detail: 'User declined installation.' });
          emitProgress({ type: 'tool:end', label: `${entry.name} skipped` });
          continue;
        }

        try {
          emitProgress({ type: 'tool:start', label: `Installing ${entry.name}`, detail: entry.description });
          const output = await entry.install();
          results.push({ tool: entry.name, status: 'installed', detail: output.slice(0, 400) });
          emitProgress({ type: 'tool:end', label: `${entry.name} installed` });
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          results.push({ tool: entry.name, status: 'failed', detail });
          emitProgress({ type: 'tool:end', label: `${entry.name} failed` });
        }
      }

      const installed = results.filter((r) => r.status === 'installed').length;
      const skipped = results.filter((r) => r.status === 'already_present').length;
      const failed = results.filter((r) => r.status === 'failed');

      return {
        platform: process.platform,
        summary: { installed, skipped, failed: failed.length },
        failed: failed.map((f) => ({ tool: f.tool, detail: f.detail })),
        results,
      };
    },
  }),
};