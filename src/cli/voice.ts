import chalk from 'chalk';
import { runManager } from '../agents/manager.js';
import { printPanel, printProgress, printTable } from './format.js';
import type { ProgressEvent } from '../runtime/progress.js';
import { checkVoiceRuntime, getVoiceConfig, startDeepgramVoiceAgentSession } from '../voice/deepgram.js';
import { checkTerminalVoiceRuntime, listTerminalVoiceInputDevices, playTerminalSpeech, startTerminalVoiceSession } from '../voice/terminal.js';
import type { ZilMateVoiceEvent } from '../voice/types.js';
import { loadTurns, saveTurns, type ChatTurn } from '../memory/history.js';
import { recall } from '../memory/long-term.js';
import { createTerminalConfirmation } from './confirm.js';

function yesNo(value: boolean) {
  return value ? 'yes' : 'no';
}

function voiceDebugEnabled() {
  return process.env.ZILMATE_VOICE_DEBUG === 'true';
}

function cleanSpokenText(text: string) {
  return text
    .replace(/[🛠️✨🚀✅❌⚠️]/g, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function voiceProgress(event: ProgressEvent) {
  if (!voiceDebugEnabled() && event.type !== 'tool:error') return;
  printProgress(event);
}

function transcript(turns: ChatTurn[]) {
  if (turns.length === 0) return '';
  return turns
    .slice(-12)
    .map((turn) => `${turn.role === 'user' ? 'User' : 'ZilMate'}: ${turn.content}`)
    .join('\n');
}

function memoryBlock(memories: Awaited<ReturnType<typeof recall>>) {
  if (memories.length === 0) return '';
  return memories.map((memory) => `- [${memory.id}] ${memory.text}${memory.tags.length ? ` (tags: ${memory.tags.join(', ')})` : ''}`).join('\n');
}

export function printVoiceConfig() {
  const config = getVoiceConfig();
  printPanel('Realtime voice', [
    ['Enabled', yesNo(config.enabled)],
    ['Configured', yesNo(config.configured)],
    ['Mode', config.mode],
    ['Listen model', `${config.listenModel} (${config.listenVersion})`],
    ['TTS model', config.ttsModel],
    ['Language', config.language],
    ['Language hints', config.languageHints.join(', ') || '-'],
    ['Barge-in', yesNo(config.bargeIn)],
    ['Playback', process.env.ZILMATE_VOICE_PLAYBACK_MODE || 'stream'],
  ]);
}

export async function runVoiceDoctor() {
  const checks = [
    ...(await checkVoiceRuntime()),
    ...(await checkTerminalVoiceRuntime()),
  ];
  printTable(['Check', 'Status', 'Detail'], checks.map((check) => [
    check.name,
    check.ok ? 'pass' : 'warn',
    check.detail,
  ]));
}

export async function runVoiceTurn(message: string, sessionId = 'default') {
  const text = await runManager(message, {
    sessionId,
    ...(voiceDebugEnabled() ? { progress: voiceProgress } : {}),
  });
  console.log(chalk.bold.cyan('\nZilMate voice reply'));
  console.log(text);
}

export async function runVoiceAgentProbe() {
  const events: ZilMateVoiceEvent[] = [];
  await startDeepgramVoiceAgentSession({
    onEvent: (event) => {
      events.push(event);
      if (event.type === 'error') {
        console.log(chalk.red(`! ${event.message}`));
      } else if (event.type === 'status') {
        console.log(chalk.gray(`${event.label}${event.detail ? ` — ${event.detail}` : ''}`));
      } else if (event.type === 'transcript') {
        console.log(`${chalk.cyan(event.role)} ${event.text}`);
      } else {
        console.log(chalk.gray(`audio ${event.bytes} bytes`));
      }
    },
  });

  if (events.length === 0) {
    console.log(chalk.yellow('No voice events received.'));
  }
}

export async function listVoiceDevices() {
  const devices = await listTerminalVoiceInputDevices();
  if (devices.length === 0) {
    printPanel('Voice input devices', [
      ['Status', 'No devices detected'],
      ['Next', 'Install ffmpeg, then run zilmate voice devices'],
      ['Manual', 'Set ZILMATE_VOICE_INPUT_DEVICE'],
    ]);
    return;
  }
  printTable(['Name', 'Input'], devices.map((device) => [device.name, device.input]));
}

export async function runTerminalVoiceLive(sessionId = 'default') {
  let turns = await loadTurns(sessionId);
  console.log(chalk.cyan('ZilMate voice is live. Speak naturally. Type /talk for text chat, /exit to quit, or press Enter to stop.'));
  if (voiceDebugEnabled()) console.log(chalk.gray('Voice debug is on.'));
  const result = await startTerminalVoiceSession({
    sessionId,
    onUserTranscript: async (text) => {
      console.log(chalk.gray('ZilMate is thinking...'));
      const context = transcript(turns);
      const relevantMemory = memoryBlock(await recall(text, 6));
      const contextBlock = [
        context ? `Conversation so far in this same session:\n${context}` : '',
        relevantMemory ? `Relevant long-term memory:\n${relevantMemory}` : '',
      ].filter(Boolean).join('\n\n');
      const reply = await runManager(`${contextBlock ? `${contextBlock}\n\n` : ''}New user voice message:\n${text}\n\nVoice response rules:
- You are currently inside ZilMate realtime voice mode. The user is speaking to you and you can answer out loud.
- Current capabilities include: spoken replies, shared text/voice session history, long-term memory, background jobs and schedules, Composio app tools/triggers, web/docs research, time/date tools, local file tools, clipboard, screenshots, camera/photo analysis, image generation, and specialist subagents.
- If asked what tools/features you lack, do not say you lack voice, memory, tools, or app integrations. Mention genuine future gaps only.
- Answer as ZilMate in a natural spoken style.
- Keep the first response short: usually 1 to 3 sentences.
- Ask one clear follow-up if the request is vague.
- Do not use markdown bullets, long menus, emojis, or internal debug details unless the user asks.
- Do not mention specific product/domain names unless the user asked about them or they are necessary.
- If the user asks what you were doing earlier, where you left off, or to continue, use the conversation-so-far block first, then memory/scratchpad, before saying you do not remember.
- You may use your tools and subagents when useful, but keep the spoken answer concise.`, {
        sessionId,
        confirm: createTerminalConfirmation(),
        ...(voiceDebugEnabled() ? { progress: voiceProgress } : {}),
      });
      const cleaned = cleanSpokenText(reply);
      turns.push(
        { role: 'user', content: text, createdAt: new Date().toISOString() },
        { role: 'assistant', content: cleaned, createdAt: new Date().toISOString() },
      );
      await saveTurns(sessionId, turns);
      return cleaned;
    },
    onEvent: (event) => {
      if (event.type === 'error') {
        console.log(chalk.red(`! ${event.message}`));
      } else if (event.type === 'status') {
        if (voiceDebugEnabled()) {
          console.log(chalk.gray(`${event.label}${event.detail ? ` - ${event.detail}` : ''}`));
        } else if (event.label === 'Flux connected') {
          console.log(chalk.gray('Connected. Listening...'));
        } else if (event.label === 'TTS audio flushed') {
          console.log(chalk.gray('Speaking...'));
        }
      } else if (event.type === 'transcript') {
        const label = event.role === 'user' ? 'you' : event.role === 'assistant' ? 'ZilMate' : 'voice';
        console.log(`${chalk.cyan(label)}: ${event.text}`);
      }
    },
  });
  console.log(chalk.gray('Live voice stopped.'));
  return result.command;
}

export async function runVoiceSpeakTest(text = 'ZilMate voice playback is working.') {
  console.log(chalk.cyan('Testing ZilMate speaker output...'));
  let audioBytes = 0;
  const result = await playTerminalSpeech(text, {
    onEvent: (event) => {
      if (event.type === 'error') {
        console.log(chalk.red(`! ${event.message}`));
      } else if (event.type === 'status') {
        console.log(chalk.gray(`${event.label}${event.detail ? ` - ${event.detail}` : ''}`));
      } else if (event.type === 'audio') {
        audioBytes += event.bytes;
      }
    },
  });
  if (result.audioBytes === 0) {
    console.log(chalk.yellow('No audio bytes were received from Deepgram TTS.'));
  } else {
    console.log(chalk.green(`Speaker test received ${audioBytes || result.audioBytes} audio bytes.`));
  }
}
