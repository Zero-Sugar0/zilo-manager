import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { randomUUID } from 'node:crypto';
import { requireGatewayAuth } from '../config/env.js';
import { runManager } from '../agents/manager.js';
import { loadTurns, saveTurns, type ChatTurn } from '../memory/history.js';
import { recall } from '../memory/long-term.js';
import { memoryBackendName } from '../memory/redis.js';
import { clearSessionApprovals } from '../runtime/confirm.js';
import { printAssistant, printProgress, printStatus, printUserPrompt, printZilMateBanner } from './format.js';
import { createReadlineConfirmation } from './confirm.js';
import { checkVoiceRuntime, getVoiceConfig } from '../voice/deepgram.js';
import { runTerminalVoiceLive } from './voice.js';

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
  clearSessionApprovals();
  let rl = readline.createInterface({ input, output });
  let turns = await loadTurns(sessionId);
  const runId = randomUUID();
  let voiceMode = false;

  printZilMateBanner('Personal assistant CLI with subagents, tools, memory, and jobs.');
  printStatus('Session:', sessionId);
  printStatus('Memory:', memoryBackendName());
  printStatus('Run:', runId);
  console.log('Type /exit to quit, /clear to clear this session, /voice to start voice mode, /voice -q to stop voice mode, or /help for commands.\n');

  try {
    while (true) {
      let answer: string;
      try {
        answer = await rl.question(printUserPrompt());
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/readline was closed|aborted/i.test(message)) break;
        throw error;
      }
      const message = answer.trim();
      if (!message) continue;
      if (message === '/exit' || message === '/quit') break;
      if (message === '/help') {
        console.log('Commands: /exit, /quit, /clear, /help, /voice, /voice -q');
        continue;
      }
      if (message === '/voice' || message === '/voice on') {
        const config = getVoiceConfig();
        const checks = await checkVoiceRuntime();
        const failing = checks.filter((check) => !check.ok);
        if (!config.configured) {
          console.log('Voice needs DEEPGRAM_API_KEY. Run `zilmate voice setup` first.');
          continue;
        }
        if (failing.some((check) => check.name === 'Deepgram SDK')) {
          console.log('Voice needs the Deepgram SDK installed. Run `npm install`, then `zilmate voice doctor`.');
          continue;
        }
        console.log(`Voice mode is starting. Model: ${config.listenModel} -> ${config.ttsModel}.`);
        rl.close();
        try {
          const command = await runTerminalVoiceLive(sessionId);
          turns = await loadTurns(sessionId);
          if (command === 'exit') break;
        } catch (error) {
          console.log(error instanceof Error ? error.message : String(error));
        }
        rl = readline.createInterface({ input, output });
        continue;
      }
      if (message === '/voice -q' || message === '/voice off' || message === '/voice stop') {
        voiceMode = false;
        console.log('Voice mode is off for this chat session.');
        continue;
      }
      if (message === '/clear') {
        turns = [];
        await saveTurns(sessionId, turns);
        console.log('Session cleared.');
        continue;
      }

      const context = transcript(turns);
      const relevantMemory = memoryBlock(await recall(message, 6));
      const voiceInstruction = voiceMode
        ? 'This is a voice-mode turn. Answer in a natural spoken style: brief, direct, conversational, and easy to listen to.'
        : 'Answer as ZilMate. Delegate to subagents when useful and return a concise final answer.';
      const prompt = context
        ? `Conversation so far:\n${context}\n\n${relevantMemory ? `Relevant long-term memory:\n${relevantMemory}\n\n` : ''}New user message:\n${message}\n\n${voiceInstruction}`
        : `${relevantMemory ? `Relevant long-term memory:\n${relevantMemory}\n\n` : ''}${message}\n\n${voiceInstruction}`;

      const response = await runManager(prompt, {
        progress: printProgress,
        sessionId,
        confirm: createReadlineConfirmation(rl),
      });
      printAssistant(response);

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



