import { createDigitalCorporationMain } from '../agents/swarm/main.js';
import { printMarkdown, printProgress, printError } from './format.js';
import { createTerminalConfirmation } from './confirm.js';

export async function runSwarmCli(task: string, options: { session: string }) {
  try {
    const mainAgent = await createDigitalCorporationMain(options.session);

    const result = await mainAgent.generate({
      prompt: task,
      onStepFinish: (step) => {
        if (step.toolCalls && step.toolCalls.length > 0) {
          const names = step.toolCalls.map(c => c.toolName).join(', ');
          printProgress({ type: 'step', label: 'Swarm COO orchestrating', detail: names });
        }
      }
    });

    printMarkdown(result.text);
  } catch (error) {
    printError(`Swarm execution failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
