import { tool } from 'ai';
import { z } from 'zod';
import { execFile, exec } from 'node:child_process';
import { promisify } from 'node:util';
import { emitProgress } from '../runtime/progress.js';
import { cpus, totalmem, freemem, platform, arch, release } from 'node:os';

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

export const shellTools = {
  executeCommand: tool({
    description: 'Execute any shell/PowerShell command. Handles npm, pnpm, yarn, pip, node, python, builds, tests, and any CLI tool. Cross-platform (Windows PowerShell/Unix sh).',
    inputSchema: z.object({
      command: z.string().min(1).describe('Command to run (e.g., "npm install", "python test_suite.py", "pnpm build", "dir", "ls -la")'),
      cwd: z.string().optional().describe('Working directory. Default: current directory'),
      timeout: z.number().int().min(1000).max(1800000).optional().describe('Timeout milliseconds (default: 300000 = 5 min, max: 30 min)'),
      env: z.record(z.string(), z.string()).optional().describe('Environment variables to set (e.g., {DEBUG: "true", NODE_ENV: "production"})'),
    }),
    execute: async ({ command, cwd, timeout, env }) => {
      emitProgress({ type: 'tool:start', label: 'Executing command', detail: command });
      
      try {
        const shell = process.platform === 'win32' ? 'powershell.exe' : '/bin/sh';
        const args = process.platform === 'win32' 
          ? ['-NoProfile', '-Command', command]
          : ['-c', command];

        const mergedEnv = env ? { ...process.env, ...env } : process.env;
        const { stdout, stderr } = await execFileAsync(shell, args, {
          cwd: cwd || process.cwd(),
          timeout: timeout ?? 300000,
          maxBuffer: 50 * 1024 * 1024, // 50MB buffer for large outputs
          windowsHide: true,
          env: mergedEnv as NodeJS.ProcessEnv,
        });

        emitProgress({ type: 'tool:end', label: 'Command executed', detail: command });

        return {
          success: true,
          exit: 0,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          command,
        };
      } catch (error: any) {
        const stdout = error.stdout?.toString().trim() ?? '';
        const stderr = error.stderr?.toString().trim() ?? '';
        const exit = error.code ?? 1;

        emitProgress({ 
          type: 'tool:error', 
          label: 'Command failed', 
          detail: `Exit ${exit}: ${stderr || 'No error message'}` 
        });

        return {
          success: false,
          exit,
          stdout,
          stderr,
          command,
        };
      }
    },
  }),

  executeAndSelfHeal: tool({
    description: 'Execute a shell command and automatically attempt to diagnose and suggest fixes for any errors (build, tests, scripts).',
    inputSchema: z.object({
      command: z.string().min(1).describe('The command to execute (e.g., "npm run build").'),
      context: z.string().optional().describe('Brief context of what this command is for (e.g., "Verifying new API route").'),
    }),
    execute: async ({ command, context }) => {
      emitProgress({ type: 'tool:start', label: 'Executing with self-heal', detail: command });

      const shell = process.platform === 'win32' ? 'powershell.exe' : '/bin/sh';
      const args = process.platform === 'win32'
        ? ['-NoProfile', '-Command', command]
        : ['-c', command];

      try {
        const { stdout, stderr } = await execFileAsync(shell, args, {
          timeout: 300000,
          maxBuffer: 10 * 1024 * 1024,
        });

        emitProgress({ type: 'tool:end', label: 'Execution success' });
        return { success: true, stdout: stdout.trim(), command };
      } catch (error: any) {
        const stderr = error.stderr?.toString().trim() ?? String(error);
        emitProgress({ type: 'tool:error', label: 'Execution failed', detail: 'Attempting self-diagnosis' });

        // Return structured error data for the agent to reason about and fix
        return {
          success: false,
          command,
          error: stderr,
          diagnosisHint: 'Analyze the error above. If it is a missing dependency, use installDependencies. If it is a code error, use Coder agent to patch the relevant files.',
          context: context || 'Unknown context'
        };
      }
    },
  }),

  installDependencies: tool({
    description: 'Install dependencies using npm, pnpm, or yarn. Auto-detects package manager. Great for "npm install", "pnpm add react", "yarn add --dev typescript".',
    inputSchema: z.object({
      command: z.string().min(1).describe('Install command (e.g., "install", "add react", "add -D typescript")'),
      manager: z.enum(['npm', 'pnpm', 'yarn']).optional().describe('Package manager to use. Auto-detect: pnpm if pnpm-lock.yaml exists, yarn if yarn.lock exists, else npm.'),
      cwd: z.string().optional().describe('Project directory. Default: current directory'),
      timeout: z.number().int().min(5000).max(1800000).optional().describe('Timeout in milliseconds. Default: 600000 (10 minutes)'),
    }),
    execute: async ({ command, manager, cwd, timeout }) => {
      emitProgress({ type: 'tool:start', label: 'Installing dependencies', detail: `${manager || 'auto-detect'} ${command}` });

      try {
        let pm = manager;
        if (!pm) {
          // Auto-detect based on lock files
          const fs = await import('node:fs/promises');
          const path = await import('node:path');
          const workDir = cwd || process.cwd();
          try {
            await fs.access(path.join(workDir, 'pnpm-lock.yaml'));
            pm = 'pnpm';
          } catch {
            try {
              await fs.access(path.join(workDir, 'yarn.lock'));
              pm = 'yarn';
            } catch {
              pm = 'npm';
            }
          }
        }

        const fullCommand = `${pm} ${command}`;
        const shell = process.platform === 'win32' ? 'powershell.exe' : '/bin/sh';
        const args = process.platform === 'win32'
          ? ['-NoProfile', '-Command', fullCommand]
          : ['-c', fullCommand];

        const { stdout, stderr } = await execFileAsync(shell, args, {
          cwd: cwd || process.cwd(),
          timeout: timeout ?? 600000,
          maxBuffer: 50 * 1024 * 1024,
          windowsHide: true,
        });

        emitProgress({ type: 'tool:end', label: 'Dependencies installed', detail: `${pm} ${command}` });

        return {
          success: true,
          exit: 0,
          manager: pm,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
        };
      } catch (error: any) {
        const stdout = error.stdout?.toString().trim() ?? '';
        const stderr = error.stderr?.toString().trim() ?? '';
        const exit = error.code ?? 1;

        emitProgress({ 
          type: 'tool:error', 
          label: 'Install failed', 
          detail: `Exit ${exit}` 
        });

        return {
          success: false,
          exit,
          manager: manager || 'auto',
          stdout,
          stderr,
        };
      }
    },
  }),

  runPipeline: tool({
    description: 'Run piped/chained commands (cmd1 | cmd2 | cmd3). Execute command pipelines, filters, and chains for complex CLI operations.',
    inputSchema: z.object({
      commands: z.array(z.string()).min(2).describe('Array of commands to pipe together (e.g., ["find . -type f", "grep test", "wc -l"])'),
      cwd: z.string().optional().describe('Working directory'),
      timeout: z.number().int().min(1000).max(600000).optional().describe('Timeout in milliseconds (default: 300000)'),
    }),
    execute: async ({ commands, cwd, timeout }) => {
      const pipelineStr = commands.join(' | ');
      emitProgress({ type: 'tool:start', label: 'Running pipeline', detail: pipelineStr });

      try {
        const shell = process.platform === 'win32' ? 'powershell.exe' : '/bin/sh';
        const args = process.platform === 'win32'
          ? ['-NoProfile', '-Command', pipelineStr]
          : ['-c', pipelineStr];

        const { stdout, stderr } = await execFileAsync(shell, args, {
          cwd: cwd || process.cwd(),
          timeout: timeout ?? 300000,
          maxBuffer: 50 * 1024 * 1024,
          windowsHide: true,
        });

        emitProgress({ type: 'tool:end', label: 'Pipeline completed' });

        return {
          success: true,
          exit: 0,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          pipeline: pipelineStr,
        };
      } catch (error: any) {
        const stdout = error.stdout?.toString().trim() ?? '';
        const stderr = error.stderr?.toString().trim() ?? '';
        const exit = error.code ?? 1;

        emitProgress({ 
          type: 'tool:error', 
          label: 'Pipeline failed', 
          detail: `Exit ${exit}` 
        });

        return {
          success: false,
          exit,
          stdout,
          stderr,
          pipeline: pipelineStr,
        };
      }
    },
  }),

  pythonScript: tool({
    description: 'Execute Python code or scripts. Perfect for testing, data processing, running test suites, or any Python automation.',
    inputSchema: z.object({
      code: z.string().min(1).describe('Python code (e.g., "print(\'hello\')" or multi-line script)'),
      cwd: z.string().optional().describe('Working directory'),
      timeout: z.number().int().min(1000).max(600000).optional().describe('Timeout in milliseconds (default: 300000)'),
    }),
    execute: async ({ code, cwd, timeout }) => {
      emitProgress({ type: 'tool:start', label: 'Running Python', detail: code.slice(0, 50) });

      try {
        const { stdout, stderr } = await execFileAsync('python', ['-c', code], {
          cwd: cwd || process.cwd(),
          timeout: timeout ?? 300000,
          maxBuffer: 50 * 1024 * 1024,
          windowsHide: true,
        });

        emitProgress({ type: 'tool:end', label: 'Python executed successfully' });

        return {
          success: true,
          exit: 0,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
        };
      } catch (error: any) {
        const stdout = error.stdout?.toString().trim() ?? '';
        const stderr = error.stderr?.toString().trim() ?? '';
        const exit = error.code ?? 1;

        emitProgress({ 
          type: 'tool:error', 
          label: 'Python failed', 
          detail: stderr || 'Execution error' 
        });

        return {
          success: false,
          exit,
          stdout,
          stderr,
        };
      }
    },
  }),

  getSystemInfo: tool({
    description: 'Get detailed system information: CPU cores, memory, OS, architecture, node version, current user, uptime.',
    inputSchema: z.object({}),
    execute: async () => {
      emitProgress({ type: 'tool:start', label: 'Fetching system info' });

      try {
        const os = await import('node:os');
        const { execSync } = await import('node:child_process');
        
        let currentUser = 'unknown';
        try {
          currentUser = process.platform === 'win32'
            ? (execSync('whoami', { encoding: 'utf-8', windowsHide: true }).trim().split('\\').pop() || 'unknown')
            : (execSync('whoami', { encoding: 'utf-8' }).trim());
        } catch {
          // Fallback
        }

        const systemInfo = {
          platform: platform(),
          arch: arch(),
          release: release(),
          cpuCores: cpus().length,
          totalMemoryGB: (totalmem() / (1024 ** 3)).toFixed(2),
          freeMemoryGB: (freemem() / (1024 ** 3)).toFixed(2),
          nodeVersion: process.version,
          currentUser,
          uptime: `${Math.floor(os.uptime() / 3600)} hours`,
          homeDir: os.homedir(),
        };

        emitProgress({ type: 'tool:end', label: 'System info retrieved' });

        return systemInfo;
      } catch (error: any) {
        return {
          platform: platform(),
          arch: arch(),
          error: error.message,
        };
      }
    },
  }),

  listProcesses: tool({
    description: 'List running processes (Windows: tasklist, Unix: ps aux). Filter by name if needed.',
    inputSchema: z.object({
      filter: z.string().optional().describe('Filter processes by name (partial match, case-insensitive)'),
      limit: z.number().int().min(1).max(500).optional().describe('Max processes to return (default: 100)'),
    }),
    execute: async ({ filter, limit }) => {
      emitProgress({ type: 'tool:start', label: 'Listing processes' });

      try {
        let command = process.platform === 'win32' 
          ? 'tasklist /FO CSV /V'
          : 'ps aux';

        const { stdout } = await execFileAsync(
          process.platform === 'win32' ? 'tasklist' : 'ps',
          process.platform === 'win32' ? ['/FO', 'CSV', '/V'] : ['aux'],
          { timeout: 10000, maxBuffer: 10 * 1024 * 1024 }
        );

        const lines = stdout.trim().split('\n');
        const maxResults = limit ?? 100;
        let processes = lines.slice(0, maxResults);

        if (filter) {
          const lowerFilter = filter.toLowerCase();
          processes = processes.filter(line => line.toLowerCase().includes(lowerFilter));
        }

        emitProgress({ type: 'tool:end', label: `Found ${processes.length} processes` });

        return {
          processes: processes.slice(0, maxResults),
          count: processes.length,
          filtered: !!filter,
        };
      } catch (error: any) {
        emitProgress({ type: 'tool:error', label: 'Failed to list processes', detail: error.message });
        return {
          error: error.message,
          processes: [],
          count: 0,
        };
      }
    },
  }),

  findInPath: tool({
    description: 'Find or check if a command/executable exists in system PATH. Useful to verify if node, python, npm, pnpm, etc. are installed.',
    inputSchema: z.object({
      command: z.string().min(1).describe('Command name to find (e.g., "python", "npm", "git", "node")'),
    }),
    execute: async ({ command }) => {
      emitProgress({ type: 'tool:start', label: 'Searching PATH', detail: command });

      try {
        const probe = process.platform === 'win32' ? 'where.exe' : 'which';
        const { stdout } = await execFileAsync(probe, [command], { 
          windowsHide: true, 
          timeout: 5000 
        });

        const foundPath = stdout.trim().split('\n')[0] || '';
        emitProgress({ type: 'tool:end', label: 'Found in PATH', detail: foundPath || command });

        return {
          found: true,
          command,
          path: foundPath,
        };
      } catch (error: any) {
        emitProgress({ type: 'tool:error', label: 'Command not found', detail: command });
        return {
          found: false,
          command,
          suggestion: `Install ${command} or add it to PATH`,
        };
      }
    },
  }),
};
