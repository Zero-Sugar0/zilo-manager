import { isConfirmationActive } from './confirm.js';

export type ProgressEvent = {
  type: 'thinking' | 'step' | 'tool:start' | 'tool:end' | 'tool:error' | 'search:start' | 'search:end' | 'fetch:start' | 'fetch:end' | 'done' | 'subagent:start' | 'subagent:step' | 'subagent:end';
  label: string;
  detail?: string;
  agent?: string;
};

let listener: ((event: ProgressEvent) => void) | undefined;

export function emitProgress(event: ProgressEvent) {
  // We allow 'tool:error' and 'step' events even during confirmation
  // to ensure background failures or state updates are visible.
  if (isConfirmationActive() && !['tool:error', 'step'].includes(event.type)) return;
  listener?.(event);
}

export async function withProgressListener<T>(progress: ((event: ProgressEvent) => void) | undefined, run: () => Promise<T>) {
  const previous = listener;
  listener = progress;
  try {
    return await run();
  } finally {
    listener = previous;
  }
}
