import { tool } from 'ai';
import { z } from 'zod';
import { execFile, exec, spawn, execSync } from 'node:child_process';
import { promisify } from 'node:util';
import { emitProgress } from '../runtime/progress.js';
import { cpus, totalmem, freemem, platform, arch, release } from 'node:os';

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

// In-memory registry to track background/asynchronous processes spawned by the agent
interface BackgroundProcess {
  id: string;
  command: string;
  cwd: string;
  status: 'running' | 'completed' | 'failed' | 'killed';
  exitCode: number | null;
  child: any;
  readonly stdout: string;
  readonly stderr: string;
  startTime: string;
  endTime: string | undefined;
  error: string | undefined;
}

const backgroundProcesses = new Map<string, BackgroundProcess>();


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

  executeCommandAsync: tool({
    description: 'Execute any shell/PowerShell command asynchronously in the background. Returns a background process ID immediately. Useful for long-running commands, starting servers, running listeners, or anytime you do not want to block the agent.',
    inputSchema: z.object({
      command: z.string().min(1).describe('The command to run in the background (e.g., "npm run dev", "npm run chat listen")'),
      cwd: z.string().optional().describe('Working directory. Default: current directory'),
      env: z.record(z.string(), z.string()).optional().describe('Environment variables to set.'),
    }),
    execute: async ({ command, cwd, env }) => {
      emitProgress({ type: 'tool:start', label: 'Spawning background command', detail: command });
      
      const id = `bg-${Math.random().toString(36).substring(2, 8)}`;
      const shell = process.platform === 'win32' ? 'powershell.exe' : '/bin/sh';
      const args = process.platform === 'win32' 
        ? ['-NoProfile', '-Command', command]
        : ['-c', command];

      const mergedEnv = env ? { ...process.env, ...env } : process.env;
      
      let stdoutAccumulated = '';
      let stderrAccumulated = '';

      try {
        const child = spawn(shell, args, {
          cwd: cwd || process.cwd(),
          env: mergedEnv as NodeJS.ProcessEnv,
          windowsHide: true,
        });

        const procEntry = {
          id,
          command,
          cwd: cwd || process.cwd(),
          status: 'running' as const,
          exitCode: null as number | null,
          child,
          get stdout() { return stdoutAccumulated; },
          get stderr() { return stderrAccumulated; },
          startTime: new Date().toISOString(),
          endTime: undefined as string | undefined,
          error: undefined as string | undefined,
        };

        backgroundProcesses.set(id, procEntry);

        child.stdout?.on('data', (data) => {
          stdoutAccumulated += data.toString();
        });

        child.stderr?.on('data', (data) => {
          stderrAccumulated += data.toString();
        });

        child.on('close', (code) => {
          const proc = backgroundProcesses.get(id);
          if (proc && proc.status === 'running') {
            proc.status = code === 0 ? 'completed' : 'failed';
            proc.exitCode = code;
            proc.endTime = new Date().toISOString();
          }
        });

        child.on('error', (err) => {
          const proc = backgroundProcesses.get(id);
          if (proc) {
            proc.status = 'failed';
            proc.error = err.message;
            proc.endTime = new Date().toISOString();
          }
        });

        emitProgress({ type: 'tool:end', label: 'Background command spawned', detail: `ID: ${id}` });

        return {
          success: true,
          id,
          status: 'running',
          message: `Command started in the background. Use checkCommandStatus with ID '${id}' to monitor output.`,
          command,
        };
      } catch (error: any) {
        emitProgress({ type: 'tool:error', label: 'Failed to spawn background command', detail: error.message });
        return {
          success: false,
          error: error.message,
          command,
        };
      }
    },
  }),

  checkCommandStatus: tool({
    description: 'Check the status and get current accumulated stdout/stderr logs of a running or completed background command.',
    inputSchema: z.object({
      id: z.string().describe('The ID of the background command to check (e.g., "bg-a3f89e").'),
    }),
    execute: async ({ id }) => {
      const proc = backgroundProcesses.get(id);
      if (!proc) {
        return {
          success: false,
          error: `Background process with ID '${id}' not found. Current background process IDs: ${Array.from(backgroundProcesses.keys()).join(', ') || 'none'}`
        };
      }

      return {
        success: true,
        id: proc.id,
        command: proc.command,
        cwd: proc.cwd,
        status: proc.status,
        exitCode: proc.exitCode,
        startTime: proc.startTime,
        endTime: proc.endTime,
        error: proc.error,
        stdout: proc.stdout,
        stderr: proc.stderr,
      };
    },
  }),

  sendInputToProcess: tool({
    description: 'Send input (stdin) to a running background process. Useful to answer prompts, confirm installations, or write inputs to an interactive process.',
    inputSchema: z.object({
      id: z.string().describe('The ID of the background command to send input to.'),
      input: z.string().describe('The string input to send (a newline will be appended automatically if not present).'),
    }),
    execute: async ({ id, input }) => {
      const proc = backgroundProcesses.get(id);
      if (!proc) {
        return { success: false, error: 'Background process not found' };
      }
      if (proc.status !== 'running') {
        return { success: false, error: `Background process is not running. Status: ${proc.status}` };
      }
      if (!proc.child.stdin) {
        return { success: false, error: 'Standard input stream (stdin) is not available for this process.' };
      }

      try {
        const text = input.endsWith('\n') ? input : `${input}\n`;
        proc.child.stdin.write(text);
        return {
          success: true,
          message: `Successfully wrote input to process ${id}.`
        };
      } catch (err: any) {
        return { success: false, error: `Failed to write to stdin: ${err.message}` };
      }
    }
  }),

  killCommand: tool({
    description: 'Kill/terminate a running background command.',
    inputSchema: z.object({
      id: z.string().describe('The ID of the background command to kill.'),
    }),
    execute: async ({ id }) => {
      const proc = backgroundProcesses.get(id);
      if (!proc) {
        return { success: false, error: 'Background process not found' };
      }
      if (proc.status !== 'running') {
        return { success: false, error: `Background process is already in status: ${proc.status}` };
      }

      try {
        if (process.platform === 'win32') {
          if (proc.child.pid) {
            execSync(`taskkill /pid ${proc.child.pid} /T /F`, { windowsHide: true });
          } else {
            proc.child.kill('SIGKILL');
          }
        } else {
          proc.child.kill('SIGKILL');
        }
        
        proc.status = 'killed';
        proc.endTime = new Date().toISOString();
        return { success: true, message: `Background process ${id} terminated successfully.` };
      } catch (err: any) {
        return { success: false, error: `Failed to terminate background process: ${err.message}` };
      }
    },
  }),

  listBackgroundCommands: tool({
    description: 'List all running and completed background commands with their IDs, commands, status, and runtimes.',
    inputSchema: z.object({}),
    execute: async () => {
      const list = Array.from(backgroundProcesses.values()).map(p => ({
        id: p.id,
        command: p.command,
        cwd: p.cwd,
        status: p.status,
        exitCode: p.exitCode,
        startTime: p.startTime,
        endTime: p.endTime,
      }));

      return {
        success: true,
        processes: list,
        count: list.length
      };
    }
  }),
};
