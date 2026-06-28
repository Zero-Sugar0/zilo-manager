import { createDigitalCorporationMain } from '../agents/swarm/main.js';
import { printMarkdown, printProgress, printError, createProgressPrinter } from './format.js';
import { createTerminalConfirmation } from './confirm.js';
import { withProgressListener } from '../runtime/progress.js';
import { SwarmTraceTracker, loadSessionSpans, renderTraceTree, generateHtmlDashboard, openBrowser } from '../observability/traces.js';
import { workspaceLayout } from '../workspace/paths.js';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import chalk from 'chalk';

export async function runSwarmCli(task: string, options: { session: string; html?: boolean }) {
  try {
    const mainAgent = await createDigitalCorporationMain(options.session);

    const tracker = SwarmTraceTracker.getInstance();
    const span = await tracker.startSpan({
      sessionId: options.session,
      agentKey: 'coo',
      agentName: 'COO (Chief Operating Officer)',
      department: 'Strategy',
      task,
    });

    await withProgressListener(createProgressPrinter(), async () => {
      const result = await tracker.runWithSpan(span, async () => {
        return await mainAgent.generate({
          prompt: task,
          onStepFinish: (step) => {
            if (step.toolCalls && step.toolCalls.length > 0) {
              const names = step.toolCalls.map((c: { toolName?: string }) => c.toolName).filter(Boolean).join(', ');
              printProgress({ type: 'step', label: 'COO orchestrating', detail: names });
              tracker.recordEvent('tool_call', 'COO_orchestrating', names).catch(() => {});
            }
          },
        });
      });

      printMarkdown(result.text);
    });

    // Output the beautiful Trace Tree
    console.log('\n' + '─'.repeat(30) + ' 📊 LIVE SWARM TRACE TREE ' + '─'.repeat(30));
    const spans = await loadSessionSpans(options.session);
    const tree = renderTraceTree(spans);
    console.log(tree);
    console.log('─'.repeat(86) + '\n');

    if (options.html) {
      try {
        const logsDir = workspaceLayout().logs;
        await mkdir(logsDir, { recursive: true });
        const dashboardHtml = generateHtmlDashboard(spans, options.session);
        const filename = `swarm-dashboard-${options.session}.html`;
        const filepath = path.join(logsDir, filename);
        await writeFile(filepath, dashboardHtml, 'utf8');

        console.log(chalk.greenBright.bold('\n🌌 Glassmorphic Swarm Intelligence Dashboard Generated Successfully!'));
        console.log(chalk.gray('📁 Path: ') + chalk.cyan(filepath));
        console.log(chalk.gray('🚀 Opening in default browser...\n'));
        openBrowser(filepath);
      } catch (err: any) {
        printError(`Failed to generate HTML dashboard: ${err.message}`);
      }
    }
  } catch (error) {
    printError(`Swarm execution failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}


