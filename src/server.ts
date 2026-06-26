import { requireGatewayAuth } from './config/env.js';
import { applyStoredModelSelections } from './config/model-store.js';
import { createChatAgent } from './agents/chat.agent.js';
import { createCodingAgent } from './agents/coding.agent.js';
import { createImageAgent } from './agents/image.agent.js';
import { createGoalManagerAgent } from './agents/goal-manager.agent.js';
import { createDocsResearchAgent } from './agents/docs-research.agent.js';
import { createPostAgent } from './agents/post.agent.js';
import { createQuickHelpAgent } from './agents/quick-help.agent.js';
import { runManager } from './agents/manager.js';
import { generateImageAsset, type ImageGenerationOptions, type ImageGenerationResult } from './tools/image-generate.tool.js';
import { buildSituationBrief } from './tools/situational-awareness.tool.js';
import { loadSessionHandoff } from './tools/session-continuity.tool.js';
import { clearMemories, forget, listMemories, recall, remember, type LongTermMemory } from './memory/long-term.js';
import type { ConfirmationHandler, ConfirmationRequest } from './runtime/confirm.js';
import { clearSessionApprovals } from './runtime/confirm.js';
import type { ProgressEvent } from './runtime/progress.js';
import { createJob, getJob, getJobLogs, listJobs } from './jobs/store.js';
import { cancelJob, handleJobWebhook, runDueJobs, runJob } from './jobs/runner.js';
import { registerQStashSchedule } from './jobs/qstash.js';
import type { CreateJobInput, JobLog, JobStatus, ListJobsOptions, ZilMateJob } from './jobs/types.js';
import { getVoiceConfig, startDeepgramVoiceAgentSession } from './voice/deepgram.js';
import type { ZilMateVoiceConfig, ZilMateVoiceSessionOptions, ZilMateVoiceSessionResult } from './voice/types.js';

export type { ConfirmationHandler, ConfirmationRequest, ProgressEvent };
export { clearSessionApprovals, applyStoredModelSelections, buildSituationBrief, loadSessionHandoff };
export type { ZilMateVoiceConfig, ZilMateVoiceSessionOptions, ZilMateVoiceSessionResult };
export type { ImageGenerationOptions, ImageGenerationResult, LongTermMemory };
export type { CreateJobInput, JobLog, JobStatus, ListJobsOptions, ZilMateJob };

export type ZilMateOptions = {
  sessionId?: string;
  onProgress?: (event: ProgressEvent) => void;
  confirm?: ConfirmationHandler;
};

export type ZilMateTextInput = {
  message: string;
};

export type ZilMatePromptInput = {
  prompt: string;
};

export type ZilMateQuestionInput = {
  question: string;
};

export type ZilMateResearchInput = {
  query: string;
};

export type ZilMateMemoryInput = {
  text: string;
  tags?: string[];
};

export type ZilMateRecallInput = {
  query?: string;
  limit?: number;
};

export type ZilMateTextResult = {
  text: string;
};

type TextAgentFactory = () => { generate: (input: { prompt: string; abortSignal?: AbortSignal }) => Promise<{ text: string }> } | Promise<{ generate: (input: { prompt: string; abortSignal?: AbortSignal }) => Promise<{ text: string }> }>;

async function runTextAgent(agentFactory: TextAgentFactory, prompt: string): Promise<ZilMateTextResult> {
  requireGatewayAuth();
  await applyStoredModelSelections();
  const result = await (await (agentFactory() as any)).generate({ prompt });
  return { text: result.text };
}

function managerOptions(sessionId: string, options: ZilMateOptions) {
  return {
    sessionId,
    ...(options.onProgress ? { progress: options.onProgress } : {}),
    ...(options.confirm ? { confirm: options.confirm } : {}),
  };
}

function getPrompt(input: ZilMateTextInput | ZilMatePromptInput | ZilMateQuestionInput | ZilMateResearchInput) {
  if ('message' in input) return input.message;
  if ('prompt' in input) return input.prompt;
  if ('question' in input) return input.question;
  return input.query;
}

export function createZilMate(options: ZilMateOptions = {}) {
  const sessionId = options.sessionId || 'default';

  return {
    chat: async (input: ZilMateTextInput): Promise<ZilMateTextResult> => ({
      text: await runManager(input.message, managerOptions(sessionId, options)),
    }),

    manager: async (input: ZilMateTextInput | ZilMatePromptInput): Promise<ZilMateTextResult> => ({
      text: await runManager(getPrompt(input), managerOptions(sessionId, options)),
    }),

    help: async (input: ZilMateQuestionInput | ZilMateTextInput): Promise<ZilMateTextResult> => (
      runTextAgent(createQuickHelpAgent, getPrompt(input))
    ),

    guide: async (input: ZilMateTextInput): Promise<ZilMateTextResult> => (
      runTextAgent(createChatAgent, input.message)
    ),

    post: async (input: ZilMatePromptInput): Promise<ZilMateTextResult> => (
      runTextAgent(createPostAgent, input.prompt)
    ),

    research: async (input: ZilMateResearchInput | ZilMateTextInput): Promise<ZilMateTextResult> => (
      runTextAgent(createDocsResearchAgent, getPrompt(input))
    ),

    coding: async (input: ZilMatePromptInput): Promise<ZilMateTextResult> => (
      runTextAgent(() => createCodingAgent(sessionId), input.prompt)
    ),

    imageAgent: async (input: ZilMatePromptInput): Promise<ZilMateTextResult> => (
      runTextAgent(createImageAgent, input.prompt)
    ),

    goalManager: async (input: ZilMatePromptInput): Promise<ZilMateTextResult> => (
      runTextAgent(createGoalManagerAgent, input.prompt)
    ),

    situation: async (input: { sessionId?: string } = {}) => buildSituationBrief(input.sessionId || sessionId),

    handoff: async (input: { sessionId?: string } = {}) => loadSessionHandoff(input.sessionId || sessionId),

    image: async (input: ZilMatePromptInput & ImageGenerationOptions): Promise<ImageGenerationResult> => {
      const { prompt, provider, size, outputDir } = input;
      return generateImageAsset(prompt, { provider, size, outputDir });
    },

    remember: async (input: ZilMateMemoryInput): Promise<LongTermMemory> => (
      remember(input.text, input.tags ?? [])
    ),

    recall: async (input: ZilMateRecallInput = {}): Promise<LongTermMemory[]> => (
      recall(input.query ?? '', input.limit ?? 8)
    ),

    listMemories,
    forget,
    clearMemories,

    createJob: async (input: CreateJobInput): Promise<ZilMateJob> => (
      registerQStashSchedule(await createJob(input))
    ),

    listJobs: async (input: ListJobsOptions = {}): Promise<ZilMateJob[]> => (
      listJobs(input)
    ),

    getJob: async (id: string): Promise<ZilMateJob | null> => (
      getJob(id)
    ),

    getJobLogs: async (id: string): Promise<JobLog[]> => (
      getJobLogs(id)
    ),

    runJob: async (id: string): Promise<ZilMateJob> => (
      runJob(id)
    ),

    runDueJobs: async (): Promise<number> => (
      runDueJobs()
    ),

    handleJobWebhook: async (input: { jobId: string; secret?: string }, expectedSecret?: string): Promise<ZilMateJob> => (
      handleJobWebhook(input, expectedSecret)
    ),

    cancelJob: async (id: string): Promise<ZilMateJob | null> => (
      cancelJob(id)
    ),

    getVoiceConfig: (): ZilMateVoiceConfig => (
      getVoiceConfig()
    ),

    startVoiceSession: async (input: ZilMateVoiceSessionOptions = {}): Promise<ZilMateVoiceSessionResult> => {
      const voiceOptions: ZilMateVoiceSessionOptions = {
        ...input,
        sessionId: input.sessionId || sessionId,
      };
      const onProgress = input.onProgress || options.onProgress;
      if (onProgress) voiceOptions.onProgress = onProgress;
      return startDeepgramVoiceAgentSession(voiceOptions);
    },
  };
}

export async function chat(input: ZilMateTextInput, options: ZilMateOptions = {}) {
  return createZilMate(options).chat(input);
}

export async function help(input: ZilMateQuestionInput | ZilMateTextInput, options: ZilMateOptions = {}) {
  return createZilMate(options).help(input);
}

export async function post(input: ZilMatePromptInput, options: ZilMateOptions = {}) {
  return createZilMate(options).post(input);
}

export async function research(input: ZilMateResearchInput | ZilMateTextInput, options: ZilMateOptions = {}) {
  return createZilMate(options).research(input);
}

export async function image(input: ZilMatePromptInput & ImageGenerationOptions) {
  return createZilMate().image(input);
}
