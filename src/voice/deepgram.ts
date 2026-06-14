import { randomUUID } from 'node:crypto';
import { env, requireDeepgram } from '../config/env.js';
import type { ZilMateVoiceConfig, ZilMateVoiceEvent, ZilMateVoiceSessionOptions, ZilMateVoiceSessionResult } from './types.js';

type DeepgramClient = {
  agent: () => DeepgramAgentConnection;
};

type DeepgramAgentConnection = {
  on: (event: string, handler: (data: unknown) => void | Promise<void>) => void;
  configure: (settings: unknown) => void;
  keepAlive: () => void;
  send: (chunk: Buffer | Uint8Array) => void;
  injectAgentMessage: (content: string) => void;
  disconnect: () => void;
};

type DeepgramModule = {
  createClient: (apiKey: string) => DeepgramClient;
};

const dynamicImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<unknown>;

function now() {
  return new Date().toISOString();
}

function normalizeVoiceMode(value: string): 'agent' {
  return value === 'agent' ? 'agent' : 'agent';
}

export function getVoiceConfig(): ZilMateVoiceConfig {
  const config: ZilMateVoiceConfig = {
    enabled: env.zilmateVoiceEnabled,
    mode: normalizeVoiceMode(env.zilmateVoiceMode),
    listenModel: env.zilmateVoiceListenModel,
    listenVersion: env.zilmateVoiceListenVersion,
    ttsModel: env.zilmateVoiceTtsModel,
    language: env.zilmateVoiceLanguage,
    languageHints: env.zilmateVoiceLanguageHints,
    bargeIn: env.zilmateVoiceBargeIn,
    sttFallbackModel: env.zilmateVoiceSttFallbackModel,
    useNovaFallback: env.zilmateVoiceUseNovaFallback,
    configured: Boolean(env.deepgramApiKey),
  };
  if (env.zilmateVoiceEotThreshold !== undefined) config.eotThreshold = env.zilmateVoiceEotThreshold;
  if (env.zilmateVoiceEagerEotThreshold !== undefined) config.eagerEotThreshold = env.zilmateVoiceEagerEotThreshold;
  return config;
}

export async function loadDeepgramClient() {
  const module = await dynamicImport('@deepgram/sdk') as DeepgramModule;
  return module.createClient(requireDeepgram());
}

export async function checkVoiceRuntime() {
  const checks: Array<{ name: string; ok: boolean; detail: string }> = [
    {
      name: 'Deepgram key',
      ok: Boolean(env.deepgramApiKey),
      detail: env.deepgramApiKey ? 'DEEPGRAM_API_KEY is configured' : 'Missing DEEPGRAM_API_KEY',
    },
    {
      name: 'Voice enabled',
      ok: env.zilmateVoiceEnabled,
      detail: env.zilmateVoiceEnabled ? 'Realtime voice mode is enabled' : 'ZILMATE_VOICE_ENABLED=false',
    },
    {
      name: 'Listen model',
      ok: env.zilmateVoiceListenVersion === 'v2' || env.zilmateVoiceListenModel.startsWith('nova-'),
      detail: `${env.zilmateVoiceListenModel} (${env.zilmateVoiceListenVersion})`,
    },
    {
      name: 'TTS model',
      ok: Boolean(env.zilmateVoiceTtsModel),
      detail: env.zilmateVoiceTtsModel,
    },
  ];

  try {
    await dynamicImport('@deepgram/sdk');
    checks.push({ name: 'Deepgram SDK', ok: true, detail: '@deepgram/sdk is installed' });
  } catch {
    checks.push({ name: 'Deepgram SDK', ok: false, detail: 'Install dependencies after updating package.json' });
  }

  return checks;
}

function voiceSettings() {
  const config = getVoiceConfig();
  const listenProvider: Record<string, unknown> = {
    type: 'deepgram',
    model: config.listenModel,
  };

  if (config.listenVersion) listenProvider.version = config.listenVersion;
  if (config.listenModel === 'flux-general-multi' && config.languageHints.length > 0) {
    listenProvider.language_hints = config.languageHints;
  } else if (!config.listenModel.startsWith('flux-')) {
    listenProvider.language = config.language;
    listenProvider.smart_format = true;
  }

  return {
    audio: {
      input: {
        encoding: 'linear16',
        sample_rate: 16000,
      },
      output: {
        encoding: 'linear16',
        sample_rate: 24000,
        container: 'none',
      },
    },
    agent: {
      language: config.language,
      listen: {
        provider: listenProvider,
      },
      think: {
        provider: {
          type: 'open_ai',
          model: 'gpt-4o-mini',
        },
        prompt: [
          'You are only the realtime voice transport for ZilMate.',
          'Do not claim limitations, tools, identity, training data, browsing ability, or assistant capabilities.',
          'Keep any automatic response extremely brief while the real ZilMate brain prepares an injected reply.',
          'If unsure, say only: One moment.',
        ].join(' '),
      },
      speak: {
        provider: {
          type: 'deepgram',
          model: config.ttsModel,
        },
      },
      greeting: 'ZilMate is listening.',
    },
  };
}

function emit(events: ZilMateVoiceEvent[], options: ZilMateVoiceSessionOptions, event: ZilMateVoiceEvent) {
  events.push(event);
  options.onEvent?.(event);
}

function conversationEvent(data: Record<string, unknown>): ZilMateVoiceEvent | null {
  const text = typeof data.content === 'string'
    ? data.content
    : typeof data.text === 'string'
      ? data.text
      : typeof data.transcript === 'string'
        ? data.transcript
        : '';
  if (!text) return null;
  const role = data.role === 'user' || data.role === 'assistant' ? data.role : 'unknown';
  return {
    type: 'transcript',
    role,
    text,
    final: data.final === true || data.is_final === true,
    timestamp: now(),
  };
}

export async function startDeepgramVoiceAgentSession(options: ZilMateVoiceSessionOptions = {}): Promise<ZilMateVoiceSessionResult> {
  if (!env.zilmateVoiceEnabled) {
    throw new Error('Realtime voice is disabled. Run `zilmate setup` or set ZILMATE_VOICE_ENABLED=true.');
  }

  const sessionId = options.sessionId || `voice_${randomUUID()}`;
  const events: ZilMateVoiceEvent[] = [];
  const deepgram = await loadDeepgramClient();
  const connection = deepgram.agent();
  let settingsSent = false;
  let settingsReadyResolve: () => void;
  const settingsReady = new Promise<void>((resolve) => {
    settingsReadyResolve = resolve;
  });

  const handleMessage = async (data: unknown) => {
    if (data && typeof data === 'object' && 'type' in data) {
      const record = data as Record<string, unknown>;
      if (record.type === 'Welcome') {
        emit(events, options, { type: 'status', label: 'Deepgram connected', timestamp: now() });
        if (!settingsSent) {
          settingsSent = true;
          connection.configure(voiceSettings());
        }
        return;
      }
      if (record.type === 'SettingsApplied') {
        settingsReadyResolve();
        emit(events, options, { type: 'status', label: 'Voice settings applied', timestamp: now() });
        return;
      }
      if (record.type === 'ConversationText') {
        const event = conversationEvent(record);
        if (event) {
          emit(events, options, event);
          if (event.type === 'transcript' && event.role === 'user' && event.text.trim() && options.onUserTranscript) {
            const answer = await options.onUserTranscript(event.text);
            if (answer && typeof answer === 'string') {
              emit(events, options, {
                type: 'transcript',
                role: 'assistant',
                text: answer,
                final: true,
                timestamp: now(),
              });
              connection.injectAgentMessage(answer);
            }
          }
        }
        return;
      }
      if (record.type === 'UserStartedSpeaking') {
        emit(events, options, {
          type: 'status',
          label: 'User started speaking',
          ...(env.zilmateVoiceBargeIn ? { detail: 'barge-in enabled' } : {}),
          timestamp: now(),
        });
        return;
      }
      if (record.type === 'AgentAudioDone') {
        emit(events, options, { type: 'status', label: 'Agent audio done', timestamp: now() });
        return;
      }
      emit(events, options, { type: 'status', label: String(record.type), timestamp: now() });
      return;
    }

    if (data instanceof Uint8Array) {
      options.onAudio?.(data);
      emit(events, options, { type: 'audio', bytes: data.byteLength, timestamp: now() });
    }
  };

  connection.on('Welcome', handleMessage);
  connection.on('SettingsApplied', handleMessage);
  connection.on('ConversationText', handleMessage);
  connection.on('UserStartedSpeaking', handleMessage);
  connection.on('AgentThinking', handleMessage);
  connection.on('AgentStartedSpeaking', handleMessage);
  connection.on('AgentAudioDone', handleMessage);
  connection.on('Unhandled', handleMessage);
  connection.on('Audio', async (data) => {
    if (data instanceof Uint8Array) {
      options.onAudio?.(data);
      emit(events, options, { type: 'audio', bytes: data.byteLength, timestamp: now() });
    }
  });

  connection.on('Open', () => {
    emit(events, options, { type: 'status', label: 'Voice socket opened', timestamp: now() });
  });

  connection.on('Close', () => {
    emit(events, options, { type: 'status', label: 'Voice socket closed', timestamp: now() });
  });

  connection.on('Error', (error) => {
    const message = error instanceof Error
      ? error.message
      : typeof error === 'object'
        ? JSON.stringify(error)
        : String(error);
    emit(events, options, { type: 'error', message, timestamp: now() });
  });

  const keepAlive = setInterval(() => connection.keepAlive(), 5000);
  try {
    if (options.audio) {
      await settingsReady;
      for await (const chunk of options.audio) {
        connection.send(chunk);
      }
    } else {
      emit(events, options, {
        type: 'status',
        label: 'No audio stream attached',
        detail: 'Use the SDK with a live PCM stream, or use browser voice where getUserMedia supplies audio.',
        timestamp: now(),
      });
    }
  } finally {
    clearInterval(keepAlive);
    connection.disconnect();
  }

  return { sessionId, events };
}
