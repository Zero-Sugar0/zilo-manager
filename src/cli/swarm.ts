import { createDigitalCorporationMain } from '../agents/swarm/main.js';
import { printMarkdown, printProgress, printError, printTable, clip } from './format.js';
import { createTerminalConfirmation } from './confirm.js';
import { listSpecialists, createSwarmSpecialist } from '../agents/swarm/registry.js';
import chalk from 'chalk';

export async function runSwarmCli(task: string, options: { session: string }) {
  if (task === 'dashboard' || task === 'status') {
    return printSwarmDashboard();
  }

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

async function printSwarmDashboard() {
  console.log(chalk.bold.cyan('\nDigital Corporation Swarm Dashboard'));
  console.log(chalk.gray('Status: ACTIVE · Agents: 30 · Departments: 7\n'));

  const specialists = listSpecialists();
  const headers = ['Department', 'Agent', 'Mission / Capabilities'];
  const rows: string[][] = [];

  specialists.forEach(key => {
    // We instantiate to get the config, this is lightweight
    const agent = createSwarmSpecialist(key);
    const config = (agent as any).config;
    rows.push([
      config.department,
      config.name,
      config.instructions.split('\n')[0] // First line is the persona/mission
    ]);
  });

  printTable(headers, rows);

  console.log(chalk.gray(`\nRun ${chalk.cyan('zilmate swarm <task>')} to delegate a business objective.`));
}
