import { tool } from 'ai';
import { z } from 'zod';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { emitProgress } from '../runtime/progress.js';

const execFileAsync = promisify(execFile);

async function runCommand(command: string, cwd: string) {
  const shell = process.platform === 'win32' ? 'powershell.exe' : '/bin/sh';
  const args = process.platform === 'win32' 
    ? ['-NoProfile', '-Command', command]
    : ['-c', command];
    
  try {
    const { stdout, stderr } = await execFileAsync(shell, args, {
      cwd,
      timeout: 180000, // 3 minutes timeout
      maxBuffer: 50 * 1024 * 1024, // 50MB buffer
      windowsHide: true,
    });
    return { success: true, exitCode: 0, stdout: stdout.trim(), stderr: stderr.trim() };
  } catch (error: any) {
    return {
      success: false,
      exitCode: error.code ?? 1,
      stdout: error.stdout?.toString().trim() ?? '',
      stderr: error.stderr?.toString().trim() ?? '',
    };
  }
}

function parseDiagnostics(buildOutput: string, testOutput: string): string {
  const tsErrorRegex = /(\S+\.ts[x]?)\((\d+),(\d+)\): error (TS\d+): (.*)/g;
  const tsErrors: string[] = [];
  let match;
  
  while ((match = tsErrorRegex.exec(buildOutput)) !== null) {
    tsErrors.push(`- File: ${match[1]}, Line: ${match[2]}, Column: ${match[3]}, Code: ${match[4]}, Message: ${match[5]}`);
  }

  // Fallback if no regex match but build output has TS errors
  if (tsErrors.length === 0 && (buildOutput.includes('error TS') || buildOutput.includes('TypeScript error'))) {
    tsErrors.push('Detected TypeScript compilation errors. Output snippet:');
    tsErrors.push(buildOutput.substring(0, 1000));
  }

  const playwrightErrors: string[] = [];
  if (testOutput.includes('Error:') || testOutput.includes('expect(') || testOutput.includes('failed')) {
    const lines = testOutput.split('\n');
    let captureStack = false;
    let currentError: string[] = [];
    
    for (const line of lines) {
      if (line.includes('Error:') || line.includes('expect(') || line.includes('✕') || /^\s*\d+\)/.test(line)) {
        if (currentError.length > 0) {
          playwrightErrors.push(currentError.join('\n'));
          currentError = [];
        }
        captureStack = true;
        currentError.push(line.trim());
      } else if (captureStack && (line.trim().startsWith('at ') || line.trim().startsWith('-'))) {
        currentError.push(line.trim());
      } else if (line.trim() === '' && currentError.length > 5) {
        captureStack = false;
      }
    }
    if (currentError.length > 0) {
      playwrightErrors.push(currentError.join('\n'));
    }
  }

  const report: string[] = [];
  if (tsErrors.length > 0) {
    report.push('=== COMPILATION FAILURES DETECTED ===');
    report.push(tsErrors.join('\n'));
    report.push('\n[ACTION REQUIRED] Please review the compilation errors above, locate the files, fix the type or import mismatches, and run the sandbox dev loop again.');
  }

  if (playwrightErrors.length > 0) {
    report.push('=== PLAYWRIGHT TEST FAILURES DETECTED ===');
    report.push(playwrightErrors.slice(0, 8).map(err => `- ${err}`).join('\n\n'));
    report.push('\n[ACTION REQUIRED] Please review the test assertion or environment failures above, locate the test/source files, fix the bugs, and run the sandbox dev loop again.');
  }

  if (tsErrors.length === 0 && playwrightErrors.length === 0) {
    if (buildOutput.includes('Failed') || testOutput.includes('Failed') || testOutput.includes('fail')) {
      report.push('=== UNDIAGNOSED FAILURES DETECTED ===');
      report.push('Build or test failed but could not parse exact locations. Raw build output snippet:\n' + buildOutput.substring(0, 500));
      report.push('\nRaw test output snippet:\n' + testOutput.substring(0, 500));
    }
  }

  return report.join('\n\n');
}

export const sandboxDevTools = {
  executeSandboxDevLoop: tool({
    description: 'Compile the current workspace, run Playwright/unit test suites inside the isolated sandbox loop, detect exact build or test failures, and feed errors back to the caller for self-healing.',
    inputSchema: z.object({
      compileCommand: z.string().optional().default('npm run build').describe('Command to compile or build the workspace.'),
      testCommand: z.string().optional().default('npx playwright test').describe('Command to run Playwright E2E or unit tests.'),
      cwd: z.string().optional().describe('Optional directory to run the loop in.'),
    }),
    execute: async ({ compileCommand, testCommand, cwd }) => {
      const activeCwd = cwd || process.cwd();
      emitProgress({ type: 'tool:start', label: 'Starting Sandbox Compile & Test Loop', detail: compileCommand });
      
      const { SwarmTraceTracker } = await import('../observability/traces.js');
      const tracker = SwarmTraceTracker.getInstance();
      await tracker.recordEvent('tool_call', 'executeSandboxDevLoop', `Compile: ${compileCommand}`);
      
      // Step 1: Compile Code
      const buildResult = await runCommand(compileCommand, activeCwd);
      
      if (!buildResult.success) {
        emitProgress({ type: 'tool:error', label: 'Sandbox Compilation Failed' });
        await tracker.recordEvent('tool_call', 'Sandbox Compile Failed', buildResult.stderr || 'Build failed');
        const diagnostics = parseDiagnostics(buildResult.stdout + '\n' + buildResult.stderr, '');
        return {
          success: false,
          stage: 'COMPILE',
          exitCode: buildResult.exitCode,
          stdout: buildResult.stdout,
          stderr: buildResult.stderr,
          diagnostics,
        };
      }
      
      emitProgress({ type: 'step', label: 'Compilation passed. Running test suites...' });
      await tracker.recordEvent('tool_call', 'Sandbox Compile Passed', 'Running test suites...');
      
      // Step 2: Run tests
      const testResult = await runCommand(testCommand, activeCwd);
      
      const diagnostics = parseDiagnostics(buildResult.stdout, testResult.stdout + '\n' + testResult.stderr);
      
      if (!testResult.success) {
        emitProgress({ type: 'tool:error', label: 'Sandbox Test Suite Failed' });
        await tracker.recordEvent('tool_call', 'Sandbox Tests Failed', testResult.stderr || 'Tests failed');
        return {
          success: false,
          stage: 'TEST',
          exitCode: testResult.exitCode,
          stdout: testResult.stdout,
          stderr: testResult.stderr,
          diagnostics,
        };
      }
      
      emitProgress({ type: 'tool:end', label: 'Sandbox Loop Passed Perfectly!' });
      await tracker.recordEvent('tool_call', 'Sandbox Loop Passed', 'All compile & test checks passed cleanly.');
      return {
        success: true,
        stage: 'COMPLETE',
        exitCode: 0,
        stdout: testResult.stdout,
        stderr: testResult.stderr,
        diagnostics: 'All checks passed cleanly! Zero errors detected.',
      };
    },
  }),
};
