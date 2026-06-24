import readline from 'node:readline/promises';
import { existsSync } from 'node:fs';
import { readFile, appendFile } from 'node:fs/promises';
import { stdin as input, stdout as output } from 'node:process';
import { randomUUID } from 'node:crypto';
import { requireGatewayAuth } from '../config/env.js';
import { applyStoredModelSelections } from '../config/model-store.js';
import { models } from '../config/models.js';
import { runManager } from '../agents/manager.js';
import { loadTurns, saveTurns, type ChatTurn } from '../memory/history.js';
import { recall } from '../memory/long-term.js';
import { memoryBackendName } from '../memory/redis.js';
import { workspaceLayout } from '../workspace/paths.js';
import { clearSessionApprovals } from '../runtime/confirm.js';
import { withAskHandler } from '../runtime/ask.js';
import { printProgress } from './format.js';
import { createReadlineConfirmation } from './confirm.js';
import { createReadlineAskHandler } from './ask.js';
import { checkVoiceRuntime, getVoiceConfig } from '../voice/deepgram.js';
import { runTerminalVoiceLive } from './voice.js';
import { printModelBrowser, runModelPicker } from './models.js';
import { readComposerLine } from './composer.js';
import { printAssistantTurn, printTips, printUserTurn, printWelcomeCard } from './render.js';
import { theme } from './theme.js';
import { runSwarmCli } from './swarm.js';

function transcript(turns: ChatTurn[]) {
  if (turns.length === 0) return '';
  return turns
    .slice(-10)
    .map((turn) => `${turn.role === 'user' ? 'User' : 'ZilMate'}: ${turn.content}`)
    .join('\n');
}

function memoryBlock(memories: Awaited<ReturnType<typeof recall>>) {
  if (memories.length === 0) return '';
  return memories.map((memory) => `- [${memory.id}] ${memory.text}${memory.tags.length ? ` (tags: ${memory.tags.join(', ')})` : ''}`).join('\n');
}

export async function startInteractiveChat(sessionId = 'default') {
  requireGatewayAuth();
  await applyStoredModelSelections();
  clearSessionApprovals();

  const layout = workspaceLayout();
  const historyFile = layout.history;
  let history: string[] = [];
  if (existsSync(historyFile)) {
    history = (await readFile(historyFile, 'utf8')).split('\n').filter(Boolean).slice(-100);
  }

  const completer = (line: string): [string[], string] => {
    const completions = ['/exit', '/quit', '/clear', '/help', '/voice', '/swarm', '/model', '/model pick', '/model next', '/heal'];
    const hits = completions.filter((c) => c.startsWith(line));
    return [hits.length ? hits : completions, line];
  };

  let rl = readline.createInterface({
    input,
    output,
    history: history,
    historySize: 100,
    completer,
  });
  let turns = await loadTurns(sessionId);
  const runId = randomUUID();
  let voiceMode = false;
  let modelBrowser = { provider: undefined as string | undefined, page: 1 };

  printWelcomeCard({
    cwd: process.cwd(),
    sessionId,
    model: models.manager,
    workspace: layout.root,
  });
  printTips();
  console.log(theme.muted(`Memory: ${memoryBackendName()} · Run: ${runId.slice(0, 8)}`));
  console.log(theme.muted('Commands: /exit · /clear · /help · /voice · /model · /model pick\n'));

  try {
    while (true) {
      let answer: string;
      try {
        answer = await readComposerLine(rl);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/readline was closed|aborted/i.test(message)) break;
        throw error;
      }
      const message = answer.trim();
      if (!message) continue;

      if (existsSync(historyFile)) {
        await appendFile(historyFile, `${message}\n`, 'utf8');
      }

      if (message === '/exit' || message === '/quit') break;
      if (message === '/help') {
        console.log(theme.textBright('Commands'));
        console.log(`  ${theme.brand('/exit')}        Quit`);
        console.log(`  ${theme.brand('/clear')}       Clear session history`);
        console.log(`  ${theme.brand('/paste')}       Enter multiline mode (paste text)`);
        console.log(`  ${theme.brand('/swarm')}       Launch Digital Corporation task`);
        console.log(`  ${theme.brand('/voice')}       Start live voice mode`);
        console.log(`  ${theme.brand('/model')}       Browse AI Gateway models`);
        console.log(`  ${theme.brand('/model pick')}  Choose manager/coding/image models`);
        console.log(`  ${theme.brand('/model next')}  Next model page`);
        console.log(theme.muted('Tip: Use "\\" at the end of a line for simple multiline input.'));
        continue;
      }
      if (message === '/swarm' || message.startsWith('/swarm ')) {
        const swarmTask = message.slice('/swarm'.length).trim();
        if (!swarmTask) {
          console.log(theme.warn('Provide a business task, e.g. /swarm "Analyze our Q1 revenue trends"'));
          continue;
        }
        await runSwarmCli(swarmTask, { session: sessionId });
        continue;
      }
      if (message === '/model pick') {
        try {
          await runModelPicker();
        } catch (error) {
          console.log(error instanceof Error ? error.message : String(error));
        }
        continue;
      }
      if (message === '/model' || message.startsWith('/model ')) {
        const rawQuery = message.slice('/model'.length).trim();
        if (rawQuery === 'next') {
          modelBrowser.page += 1;
        } else if (rawQuery && rawQuery !== 'pick') {
          modelBrowser = { provider: rawQuery, page: 1 };
        }
        try {
          const result = await printModelBrowser({
            ...(modelBrowser.provider ? { provider: modelBrowser.provider } : {}),
            page: modelBrowser.page,
            limit: 20,
          });
          modelBrowser.page = result.page;
        } catch (error) {
          console.log(error instanceof Error ? error.message : String(error));
        }
        continue;
      }
      if (message === '/voice' || message === '/voice on') {
        const config = getVoiceConfig();
        const checks = await checkVoiceRuntime();
        const failing = checks.filter((check) => !check.ok);
        if (!config.configured) {
          console.log(theme.warn('Voice needs DEEPGRAM_API_KEY. Run `zilmate voice setup` first.'));
          continue;
        }
        if (failing.some((check) => check.name === 'Deepgram SDK')) {
          console.log(theme.warn('Install Deepgram SDK: `npm install`, then `zilmate voice doctor`.'));
          continue;
        }
        console.log(theme.text(`Voice mode · ${config.listenModel} → ${config.ttsModel}`));
        rl.close();
        try {
          const command = await runTerminalVoiceLive(sessionId);
          turns = await loadTurns(sessionId);
          if (command === 'exit') break;
        } catch (error) {
          console.log(error instanceof Error ? error.message : String(error));
        }
        rl = readline.createInterface({
          input,
          output,
          history: (await readFile(historyFile, 'utf8')).split('\n').filter(Boolean).slice(-100),
          historySize: 100,
          completer,
        });
        continue;
      }
      if (message === '/voice -q' || message === '/voice off' || message === '/voice stop') {
        voiceMode = false;
        console.log(theme.muted('Voice mode off for this chat session.'));
        continue;
      }
      if (message === '/clear') {
        turns = [];
        await saveTurns(sessionId, turns);
        console.log(theme.ok('Session cleared.'));
        continue;
      }

      printUserTurn(message);

      const context = transcript(turns);
      const relevantMemory = memoryBlock(await recall(message, 6));
      const voiceInstruction = voiceMode
        ? 'This is a voice-mode turn. Answer in a natural spoken style: brief, direct, conversational, and easy to listen to.'
        : 'Answer as ZilMate. Delegate to subagents when useful and return a concise final answer.';
      const prompt = context
        ? `Conversation so far:\n${context}\n\n${relevantMemory ? `Relevant long-term memory:\n${relevantMemory}\n\n` : ''}New user message:\n${message}\n\n${voiceInstruction}`
        : `${relevantMemory ? `Relevant long-term memory:\n${relevantMemory}\n\n` : ''}${message}\n\n${voiceInstruction}`;

      const response = await withAskHandler(createReadlineAskHandler(rl), () =>
        runManager(prompt, {
          progress: printProgress,
          sessionId,
          confirm: createReadlineConfirmation(rl),
        }),
      );
      printAssistantTurn(response);

      turns.push(
        { role: 'user', content: message, createdAt: new Date().toISOString() },
        { role: 'assistant', content: response, createdAt: new Date().toISOString() },
      );
      await saveTurns(sessionId, turns);
    }
  } finally {
    rl.close();
  }
}

async function handleHotkeys(response: string) {
  // This could be expanded to wait for a single keypress [c] for copy, [h] for heal, etc.
  // For now we just return as it requires setting raw mode on stdin which can be tricky inside while(true)
}
