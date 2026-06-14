import type { ProgressEvent } from '../runtime/progress.js';

export type ZilMateVoiceEvent =
  | { type: 'status'; label: string; detail?: string; timestamp: string }
  | { type: 'transcript'; role: 'user' | 'assistant' | 'unknown'; text: string; final?: boolean; timestamp: string }
  | { type: 'audio'; bytes: number; timestamp: string }
  | { type: 'error'; message: string; timestamp: string };

export type ZilMateVoiceConfig = {
  enabled: boolean;
  mode: 'agent';
  listenModel: string;
  listenVersion: string;
  ttsModel: string;
  language: string;
  languageHints: string[];
  bargeIn: boolean;
  eotThreshold?: number;
  eagerEotThreshold?: number;
  sttFallbackModel: string;
  useNovaFallback: boolean;
  configured: boolean;
};

export type ZilMateVoiceSessionOptions = {
  sessionId?: string;
  audio?: AsyncIterable<Buffer | Uint8Array>;
  onEvent?: (event: ZilMateVoiceEvent) => void;
  onAudio?: (chunk: Uint8Array) => void;
  onUserTranscript?: (text: string) => Promise<string | void> | string | void;
  onProgress?: (event: ProgressEvent) => void;
};

export type ZilMateVoiceSessionResult = {
  sessionId: string;
  events: ZilMateVoiceEvent[];
};
