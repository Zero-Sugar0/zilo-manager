import { isConfirmationActive } from './confirm.js';

export type ProgressEvent = {
  type: 'thinking' | 'step' | 'tool:start' | 'tool:end' | 'tool:error' | 'search:start' | 'search:end' | 'fetch:start' | 'fetch:end' | 'done';
  label: string;
  detail?: string;
};

let listener: ((event: ProgressEvent) => void) | undefined;

export function emitProgress(event: ProgressEvent) {
  if (isConfirmationActive()) return;
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
