export type ConfirmationRequest = {
  toolkitSlug: string;
  toolSlug: string;
  summary: string;
  action?: string;
  access?: 'Read-only' | 'Write';
  targetTools?: string[];
  details?: string[];
};

export type ConfirmationHandler = (request: ConfirmationRequest) => Promise<boolean | 'session'>;

let currentHandler: ConfirmationHandler | undefined;
const sessionApprovals = new Set<string>();
let confirmationActive = false;
let confirmationTail: Promise<unknown> = Promise.resolve();

function approvalKey(request: ConfirmationRequest): string {
  const action = request.action || request.summary;
  return `${request.toolkitSlug}/${request.toolSlug}/${action}`;
}

function enqueueConfirmation<T>(run: () => Promise<T>): Promise<T> {
  const next = confirmationTail.then(run);
  confirmationTail = next.catch(() => undefined);
  return next;
}

export function isConfirmationActive() {
  return confirmationActive;
}

export function hasSessionApproval(request: ConfirmationRequest) {
  return sessionApprovals.has(approvalKey(request));
}

export function clearSessionApprovals() {
  sessionApprovals.clear();
}

export async function withConfirmationHandler<T>(handler: ConfirmationHandler | undefined, run: () => Promise<T>) {
  const previous = currentHandler;
  currentHandler = handler;
  try {
    return await run();
  } finally {
    currentHandler = previous;
  }
}

export async function requestConfirmation(request: ConfirmationRequest) {
  const key = approvalKey(request);

  if (sessionApprovals.has(key)) {
    return true;
  }

  return enqueueConfirmation(async () => {
    if (sessionApprovals.has(key)) {
      return true;
    }

    if (!currentHandler) {
      return false;
    }

    confirmationActive = true;
    try {
      const result = await currentHandler(request);

      if (result === 'session') {
        sessionApprovals.add(key);
        return true;
      }

      return result === true;
    } finally {
      confirmationActive = false;
    }
  });
}
