import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { getComposioStatus } from '../tools/composio.tool.js';
import { listMemories } from '../memory/long-term.js';
import { runDoctor } from './doctor.js';
import { printDoctorChecks } from './health.js';
import { createCliJob, listCliJobs } from './jobs.js';
import { printAppsStatus } from './apps.js';
import { printMemoryTable } from './memory.js';
import { printPanel, printZilMateBanner } from './format.js';
import { runSetup, runChatSetup } from './setup.js';
import { startInteractiveChat } from './interactive.js';
import { hasGatewayAuth, hasChatIntegration } from '../config/env.js';
import { printWelcomeScreen } from './welcome.js';
import { printVoiceConfig, runVoiceDoctor } from './voice.js';
import { runVoiceSetup, setVoiceEnabled } from './setup.js';
import { runSelfUpdate } from './update.js';
import { listCameraDevicesCli, runCameraDoctorCli } from './camera.js';

async function ask(rl: readline.Interface, prompt: string) {
  return (await rl.question(prompt)).trim();
}

export async function startMainMenu() {
  const rl = readline.createInterface({ input, output });
  try {
    while (true) {
      printZilMateBanner('Main Menu');
      printPanel('Choose an action', [
        ['1', 'Talk to ZilMate'],
        ['2', 'Create a job'],
        ['3', 'View jobs'],
        ['4', 'Setup/config'],
        ['5', 'Check health'],
        ['6', 'Connect apps'],
        ['7', 'Manage memory'],
        ['8', 'Trigger workflows'],
        ['9', 'Voice setup/status'],
        ['10', 'Chat channels (Slack/TG)'],
        ['11', 'Update ZilMate'],
        ['12', 'Camera tools'],
        ['0', 'Exit'],
      ]);

      if (!hasGatewayAuth()) {
        printPanel('Setup needed', [
          ['Gateway', 'missing'],
          ['Next', 'Choose 4 to run setup, or 0 to exit'],
        ]);
      }

      const choice = await ask(rl, 'Select: ');
      if (choice === '0') break;
      if (choice === '1') {
        if (!hasGatewayAuth()) {
          const setup = await ask(rl, 'AI Gateway key is missing. Run setup now? (Y/n) ');
          if (setup.toLowerCase() === 'n' || setup.toLowerCase() === 'no') continue;
          rl.close();
          await runSetup();
          return;
        }
        rl.close();
        await startInteractiveChat();
        return;
      }
      if (choice === '2') {
        const task = await ask(rl, 'Job task: ');
        const schedule = await ask(rl, 'Schedule (blank for once): ');
        if (task) await createCliJob(task, schedule ? { schedule } : {});
      } else if (choice === '3') {
        await listCliJobs({});
      } else if (choice === '4') {
        rl.close();
        await runSetup();
        return;
      } else if (choice === '5') {
        printDoctorChecks(await runDoctor());
      } else if (choice === '6') {
        printAppsStatus(await getComposioStatus());
      } else if (choice === '7') {
        printMemoryTable(await listMemories());
      } else if (choice === '8') {
        console.log('Try: zilmate triggers types gmail');
        console.log('Try: zilmate triggers list');
        console.log('Try: zilmate triggers listen');
      } else if (choice === '9') {
        printVoiceConfig();
        printPanel('Voice actions', [
          ['1', 'Run voice setup'],
          ['2', 'Enable voice'],
          ['3', 'Disable voice'],
          ['4', 'Voice doctor'],
          ['0', 'Back'],
        ]);
        const voiceChoice = await ask(rl, 'Select: ');
        if (voiceChoice === '1') {
          rl.close();
          await runVoiceSetup();
          return;
        }
        if (voiceChoice === '2') await setVoiceEnabled(true);
        if (voiceChoice === '3') await setVoiceEnabled(false);
        if (voiceChoice === '4') await runVoiceDoctor();
      } else if (choice === '10') {
        printPanel('Chat actions', [
          ['1', 'Run chat setup'],
          ['2', 'Start chat listener (production)'],
          ['0', 'Back'],
        ]);
        const chatChoice = await ask(rl, 'Select: ');
        if (chatChoice === '1') {
          rl.close();
          await runChatSetup();
          return;
        }
        if (chatChoice === '2') {
          if (!hasChatIntegration()) {
             console.log('Chat integration not configured. Run chat setup first.');
          } else {
             console.log('To start the listener, run: zilmate chat listen');
             console.log('This will connect to Slack/Telegram and wait for messages.');
          }
        }
      } else if (choice === '11') {
        const confirm = await ask(rl, 'Update ZilMate from npm now? (y/N) ');
        if (confirm.toLowerCase() === 'y' || confirm.toLowerCase() === 'yes') {
          await runSelfUpdate();
          return;
        }
      } else if (choice === '12') {
        printPanel('Camera actions', [
          ['1', 'Camera doctor'],
          ['2', 'List camera devices'],
          ['0', 'Back'],
        ]);
        const cameraChoice = await ask(rl, 'Select: ');
        if (cameraChoice === '1') await runCameraDoctorCli();
        if (cameraChoice === '2') await listCameraDevicesCli();
      }
      await ask(rl, '\nPress Enter to continue...');
    }
  } finally {
    rl.close();
  }
}

export async function startDefaultLauncher() {
  await printWelcomeScreen();
  await startMainMenu();
}
