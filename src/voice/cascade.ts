import { randomUUID } from 'node:crypto';
import { requireDeepgram } from '../config/env.js';
import { getVoiceConfig } from './deepgram.js';
import type { ZilMateVoiceEvent } from './types.js';

type LiveConnection = {
  on: (event: string, handler: (data: unknown) => void | Promise<void>) => void;
  send: (chunk: Buffer | Uint8Array) => void;
  keepAlive?: () => void;
  requestClose?: () => void;
  disconnect: () => void;
  sendText?: (text: string) => void;
  flush?: () => void;
  clear?: () => void;
};

type DeepgramClient = {
  listen: {
    live: (options: Record<string, unknown>, endpoint?: string) => LiveConnection;
  };
  speak: {
    live: (options: Record<string, unknown>) => LiveConnection;
  };
};

type DeepgramModule = {
  createClient: (apiKey: string) => DeepgramClient;
};

type WebSocketConstructor = new (
  url: string,
  protocols?: string | string[],
  options?: { headers?: Record<string, string> }
) => {
  readyState: number;
  send: (data: string | Buffer | Uint8Array) => void;
  close: () => void;
  ping?: () => void;
  on: (event: string, handler: (...args: unknown[]) => void) => void;
};

type WsModule = {
  default?: WebSocketConstructor;
  WebSocket?: WebSocketConstructor;
};

export type CascadedVoiceSessionOptions = {
  sessionId?: string;
  audio: AsyncIterable<Buffer | Uint8Array>;
  onEvent?: (event: ZilMateVoiceEvent) => void;
  onAudio?: (chunk: Uint8Array) => void;
  onUserTranscript: (text: string) => Promise<string | void> | string | void;
};

const dynamicImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<unknown>;

function now() {
  return new Date().toISOString();
}

function emit(options: CascadedVoiceSessionOptions, event: ZilMateVoiceEvent) {
  options.onEvent?.(event);
}

async function loadClient() {
  const module = await dynamicImport('@deepgram/sdk') as DeepgramModule;
  return module.createClient(requireDeepgram());
}

async function loadWebSocket() {
  const module = await dynamicImport('ws') as WsModule;
  const WebSocket = module.default || module.WebSocket;
  if (!WebSocket) throw new Error('The ws package is required for Deepgram Flux v2 streaming.');
  return WebSocket;
}

function transcriptText(data: unknown) {
  const record = data && typeof data === 'object' ? data as Record<string, unknown> : {};
  if (typeof record.transcript === 'string') return record.transcript.trim();
  const channel = record.channel && typeof record.channel === 'object' ? record.channel as Record<string, unknown> : {};
  const alternatives = Array.isArray(channel.alternatives) ? channel.alternatives : [];
  const first = alternatives[0] && typeof alternatives[0] === 'object' ? alternatives[0] as Record<string, unknown> : {};
  return typeof first.transcript === 'string' ? first.transcript.trim() : '';
}

function isFinalTurn(data: unknown) {
  const record = data && typeof data === 'object' ? data as Record<string, unknown> : {};
  if (record.type === 'TurnInfo') return record.event === 'EndOfTurn';
  return record.is_final === true || record.speech_final === true;
}

function listenOptions() {
  const config = getVoiceConfig();
  const options: Record<string, unknown> = {
    model: config.listenModel,
    encoding: 'linear16',
    sample_rate: 16000,
  };
  if (config.listenModel.startsWith('flux-')) {
    if (config.eotThreshold !== undefined) options.eot_threshold = config.eotThreshold;
    if (config.eagerEotThreshold !== undefined) options.eager_eot_threshold = config.eagerEotThreshold;
  } else {
    options.channels = 1;
    options.interim_results = true;
    options.smart_format = true;
    options.punctuate = true;
    options.language = config.language;
  }
  if (config.listenModel === 'flux-general-multi' && config.languageHints.length > 0) {
    options.language_hint = config.languageHints;
  }
  return options;
}

function novaListenOptions() {
  const config = getVoiceConfig();
  return {
    model: config.sttFallbackModel,
    encoding: 'linear16',
    sample_rate: 16000,
    channels: 1,
    interim_results: true,
    smart_format: true,
    punctuate: true,
    language: config.language,
  };
}

function splitSpeechChunks(text: string, maxLen = 420) {
  const trimmed = text.trim();
  if (trimmed.length <= maxLen) return [trimmed];
  const sentences = trimmed.match(/[^.!?]+[.!?]+|\S+/g) || [trimmed];
  const chunks: string[] = [];
  let current = '';
  for (const sentence of sentences) {
    if ((current + sentence).length > maxLen && current) {
      chunks.push(current.trim());
      current = sentence;
    } else {
      current += sentence;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

async function speakChunked(speak: LiveConnection, ttsState: ReturnType<typeof listenForTtsAudio>, text: string) {
  const chunks = splitSpeechChunks(text);
  await ttsState.waitForOpen();
  for (const chunk of chunks) {
    speak.sendText?.(chunk);
    speak.flush?.();
    await ttsState.waitForFlush();
  }
}

function listenEndpoint() {
  const config = getVoiceConfig();
  return config.listenModel.startsWith('flux-') ? '/v2/listen' : undefined;
}

function speakOptions() {
  const config = getVoiceConfig();
  return {
    model: config.ttsModel,
    encoding: 'linear16',
    sample_rate: 24000,
    container: 'none',
  };
}

function listenForTtsAudio(
  speak: LiveConnection,
  options: Pick<CascadedVoiceSessionOptions, 'onEvent' | 'onAudio'>,
) {
  let audioBytes = 0;
  let flushed = false;
  let opened = false;
  let resolveOpen: (() => void) | undefined;
  let rejectOpen: ((error: Error) => void) | undefined;
  const flushWaiters: Array<() => void> = [];
  const openedPromise = new Promise<void>((resolve, reject) => {
    resolveOpen = resolve;
    rejectOpen = reject;
  });

  speak.on('Open', () => {
    opened = true;
    resolveOpen?.();
    emit(options as CascadedVoiceSessionOptions, { type: 'status', label: 'TTS socket opened', timestamp: now() });
  });
  speak.on('Close', () => emit(options as CascadedVoiceSessionOptions, { type: 'status', label: 'TTS socket closed', timestamp: now() }));
  speak.on('Error', (error) => {
    const message = error instanceof Error ? error.message : JSON.stringify(error);
    rejectOpen?.(new Error(message));
    emit(options as CascadedVoiceSessionOptions, { type: 'error', message, timestamp: now() });
  });
  speak.on('Warning', (warning) => emit(options as CascadedVoiceSessionOptions, { type: 'status', label: 'TTS warning', detail: JSON.stringify(warning), timestamp: now() }));
  speak.on('Flushed', () => {
    flushed = true;
    emit(options as CascadedVoiceSessionOptions, { type: 'status', label: 'TTS audio flushed', detail: `${audioBytes} bytes`, timestamp: now() });
    for (const waiter of flushWaiters.splice(0)) waiter();
  });
  speak.on('Audio', (chunk) => {
    if (chunk instanceof Uint8Array) {
      audioBytes += chunk.byteLength;
      options.onAudio?.(chunk);
      emit(options as CascadedVoiceSessionOptions, { type: 'audio', bytes: chunk.byteLength, timestamp: now() });
    }
  });

  return {
    get audioBytes() {
      return audioBytes;
    },
    get flushed() {
      return flushed;
    },
    waitForOpen: async () => {
      if (opened) return;
      await Promise.race([
        openedPromise,
        new Promise((_resolve, reject) => {
          setTimeout(() => reject(new Error('Timed out waiting for Deepgram TTS socket to open.')), 10_000);
        }),
      ]);
    },
    waitForFlush: () => new Promise<void>((resolve, reject) => {
      flushWaiters.push(resolve);
      setTimeout(() => reject(new Error('Timed out waiting for TTS flush.')), 20_000);
    }),
  };
}

export async function speakWithDeepgram(text: string, options: Pick<CascadedVoiceSessionOptions, 'onEvent' | 'onAudio'> = {}) {
  const deepgram = await loadClient();
  const speak = deepgram.speak.live(speakOptions());
  const state = listenForTtsAudio(speak, options);
  await state.waitForOpen();
  for (const chunk of splitSpeechChunks(text)) {
    speak.sendText?.(chunk);
    speak.flush?.();
    await state.waitForFlush();
  }
  speak.requestClose?.();
  speak.disconnect();
  return { audioBytes: state.audioBytes };
}

function appendQuery(url: URL, key: string, value: unknown) {
  if (Array.isArray(value)) {
    for (const item of value) url.searchParams.append(key, String(item));
    return;
  }
  if (value !== undefined && value !== null && value !== '') {
    url.searchParams.set(key, String(value));
  }
}

async function createFluxListenConnection(options: Record<string, unknown>): Promise<LiveConnection> {
  const WebSocket = await loadWebSocket();
  const url = new URL('/v2/listen', 'wss://api.deepgram.com');
  for (const [key, value] of Object.entries(options)) appendQuery(url, key, value);

  const handlers = new Map<string, Array<(data: unknown) => void | Promise<void>>>();
  const buffered: Array<string | Buffer | Uint8Array> = [];
  let open = false;
  let closed = false;

  const emitLocal = (event: string, data: unknown) => {
    for (const handler of handlers.get(event) || []) {
      void handler(data);
    }
  };

  const socket = new WebSocket(url.toString(), undefined, {
    headers: {
      Authorization: `Token ${requireDeepgram()}`,
    },
  });

  socket.on('open', () => {
    open = true;
    emitLocal('open', undefined);
    while (buffered.length > 0) socket.send(buffered.shift()!);
  });
  socket.on('close', (code, reason) => {
    closed = true;
    emitLocal('close', { code, reason: Buffer.isBuffer(reason) ? reason.toString('utf8') : String(reason || '') });
  });
  socket.on('unexpected-response', (_request, response) => {
    const statusCode = response && typeof response === 'object' && 'statusCode' in response
      ? (response as { statusCode?: number }).statusCode
      : undefined;
    const statusMessage = response && typeof response === 'object' && 'statusMessage' in response
      ? (response as { statusMessage?: string }).statusMessage
      : undefined;
    emitLocal('error', new Error(`Deepgram rejected Flux websocket${statusCode ? ` (${statusCode}${statusMessage ? ` ${statusMessage}` : ''})` : ''}. Check DEEPGRAM_API_KEY access to Flux v2.`));
  });
  socket.on('error', (error) => {
    emitLocal('error', error);
  });
  socket.on('message', (message) => {
    const text = Buffer.isBuffer(message) ? message.toString('utf8') : String(message);
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      emitLocal('Message', data);
      if (typeof data.type === 'string') emitLocal(data.type, data);
    } catch {
      emitLocal('error', new Error(`Unable to parse Flux message: ${text.slice(0, 200)}`));
    }
  });

  return {
    on: (event, handler) => {
      handlers.set(event, [...(handlers.get(event) || []), handler]);
    },
    send: (chunk) => {
      if (closed) return;
      if (open) socket.send(chunk);
      else buffered.push(chunk);
    },
    keepAlive: () => {
      if (closed || !open) return;
      socket.ping?.();
    },
    requestClose: () => {
      if (!closed) socket.send(JSON.stringify({ type: 'CloseStream' }));
    },
    disconnect: () => {
      if (!closed) socket.close();
    },
  };
}

export async function startCascadedVoiceSession(options: CascadedVoiceSessionOptions) {
  const sessionId = options.sessionId || `voice_${randomUUID()}`;
  const config = getVoiceConfig();
  const deepgram = await loadClient();
  const useNova = config.useNovaFallback || !config.listenModel.startsWith('flux-');
  const listen = useNova
    ? deepgram.listen.live(novaListenOptions())
    : config.listenModel.startsWith('flux-')
      ? await createFluxListenConnection(listenOptions())
      : deepgram.listen.live(listenOptions(), listenEndpoint());
  const speak = deepgram.speak.live(speakOptions());
  const ttsState = listenForTtsAudio(speak, options);
  let pendingTranscript = '';
  let answering = Promise.resolve();

  listen.on('open', () => emit(options, { type: 'status', label: useNova ? 'Nova listening' : 'Flux listening', detail: useNova ? config.sttFallbackModel : config.listenModel, timestamp: now() }));
  listen.on('close', (data) => {
    const record = data && typeof data === 'object' ? data as Record<string, unknown> : {};
    const code = typeof record.code === 'number' ? record.code : undefined;
    const reason = typeof record.reason === 'string' ? record.reason : '';
    const detail = code ? `${code}${reason ? ` ${reason}` : ''}` : undefined;
    emit(options, {
      type: 'status',
      label: 'Flux socket closed',
      ...(detail ? { detail } : {}),
      timestamp: now(),
    });
  });
  listen.on('error', (error) => emit(options, { type: 'error', message: error instanceof Error ? error.message : JSON.stringify(error), timestamp: now() }));
  listen.on('Connected', () => emit(options, { type: 'status', label: 'Flux connected', detail: getVoiceConfig().listenModel, timestamp: now() }));
  listen.on('SpeechStarted', () => {
    speak.clear?.();
    emit(options, { type: 'status', label: 'User started speaking', detail: 'barge-in enabled', timestamp: now() });
  });
  const onTurn = (data: unknown) => {
    const text = transcriptText(data);
    if (!text) return;
    pendingTranscript = text;
    if (!isFinalTurn(data)) return;

    const finalText = pendingTranscript;
    pendingTranscript = '';
    emit(options, { type: 'transcript', role: 'user', text: finalText, final: true, timestamp: now() });
    answering = answering.then(async () => {
      const reply = await options.onUserTranscript(finalText);
      if (!reply || typeof reply !== 'string') return;
      emit(options, { type: 'transcript', role: 'assistant', text: reply, final: true, timestamp: now() });
      await speakChunked(speak, ttsState, reply);
    }).catch((error) => {
      emit(options, { type: 'error', message: error instanceof Error ? error.message : String(error), timestamp: now() });
    });
  };
  listen.on('Results', onTurn);
  listen.on('TurnInfo', onTurn);

  const keepAlive = setInterval(() => {
    listen.keepAlive?.();
  }, 5000);

  try {
    for await (const chunk of options.audio) {
      listen.send(chunk);
    }
    await answering;
  } finally {
    clearInterval(keepAlive);
    listen.requestClose?.();
    speak.requestClose?.();
    listen.disconnect();
    speak.disconnect();
  }

  return { sessionId };
}
