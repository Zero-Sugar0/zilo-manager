import 'dotenv/config';
import { config as loadDotenv } from 'dotenv';
import { existsSync } from 'node:fs';

if (existsSync('.env.local')) {
  loadDotenv({ path: '.env.local', override: false });
}

export type ImageProvider = 'openai' | 'gemini';

function normalizeImageProvider(value: string | undefined): ImageProvider {
  const provider = (value || 'openai').toLowerCase().trim();
  if (provider === 'chatgpt' || provider === 'gpt-image' || provider === 'gpt-image-2') return 'openai';
  if (provider === 'google' || provider === 'nano-banana' || provider === 'gemini') return 'gemini';
  return 'openai';
}

export type Env = {
  aiGatewayApiKey: string | undefined;
  vercelOidcToken: string | undefined;
  tavilyApiKey: string | undefined;
  composioApiKey: string | undefined;
  zilmateUserId: string | undefined;
  upstashRedisRestUrl: string | undefined;
  upstashRedisRestToken: string | undefined;
  zilmateJobsEnabled: boolean;
  upstashQstashToken: string | undefined;
  zilmatePublicJobWebhookUrl: string | undefined;
  zilmateJobWebhookSecret: string | undefined;
  zilmateTriggerWorkflowsEnabled: boolean;
  deepgramApiKey: string | undefined;
  zilmateVoiceEnabled: boolean;
  zilmateVoiceMode: string;
  zilmateVoiceListenModel: string;
  zilmateVoiceListenVersion: string;
  zilmateVoiceTtsModel: string;
  zilmateVoiceLanguage: string;
  zilmateVoiceLanguageHints: string[];
  zilmateVoiceBargeIn: boolean;
  zilmateVoicePlaybackMode: string;
  zilmateVoiceEotThreshold: number | undefined;
  zilmateVoiceEagerEotThreshold: number | undefined;
  zilmateVoiceSttFallbackModel: string;
  zilmateVoiceUseNovaFallback: boolean;
  managerModel: string;
  helpModel: string | undefined;
  postModel: string | undefined;
  imageDefaultProvider: ImageProvider;
  imageOpenaiModel: string;
  imageGeminiModel: string;
  imageModel: string;
  screenshotVisionModel: string;
  codingModel: string | undefined;
  slackBotToken: string | undefined;
  slackSigningSecret: string | undefined;
  telegramBotToken: string | undefined;
  imessageLocal: boolean;
  imessageEnabled: boolean;
  chatIntegrationEnabled: boolean;
};

export const env: Env = {
  aiGatewayApiKey: process.env.AI_GATEWAY_API_KEY,
  vercelOidcToken: process.env.VERCEL_OIDC_TOKEN,
  tavilyApiKey: process.env.TAVILY_API_KEY,
  composioApiKey: process.env.COMPOSIO_API_KEY,
  zilmateUserId: process.env.ZILMATE_USER_ID,
  upstashRedisRestUrl: process.env.UPSTASH_REDIS_REST_URL,
  upstashRedisRestToken: process.env.UPSTASH_REDIS_REST_TOKEN,
  zilmateJobsEnabled: process.env.ZILMATE_JOBS_ENABLED === 'true',
  upstashQstashToken: process.env.UPSTASH_QSTASH_TOKEN,
  zilmatePublicJobWebhookUrl: process.env.ZILMATE_PUBLIC_JOB_WEBHOOK_URL,
  zilmateJobWebhookSecret: process.env.ZILMATE_JOB_WEBHOOK_SECRET,
  zilmateTriggerWorkflowsEnabled: process.env.ZILMATE_TRIGGER_WORKFLOWS_ENABLED === 'true',
  deepgramApiKey: process.env.DEEPGRAM_API_KEY,
  zilmateVoiceEnabled: process.env.ZILMATE_VOICE_ENABLED === 'true',
  zilmateVoiceMode: process.env.ZILMATE_VOICE_MODE || 'agent',
  zilmateVoiceListenModel: process.env.ZILMATE_VOICE_LISTEN_MODEL || 'flux-general-en',
  zilmateVoiceListenVersion: process.env.ZILMATE_VOICE_LISTEN_VERSION || 'v2',
  zilmateVoiceTtsModel: process.env.ZILMATE_VOICE_TTS_MODEL || 'aura-2-thalia-en',
  zilmateVoiceLanguage: process.env.ZILMATE_VOICE_LANGUAGE || 'en',
  zilmateVoiceLanguageHints: (process.env.ZILMATE_VOICE_LANGUAGE_HINTS || '').split(',').map((item) => item.trim()).filter(Boolean),
  zilmateVoiceBargeIn: process.env.ZILMATE_VOICE_BARGE_IN !== 'false',
  zilmateVoicePlaybackMode: process.env.ZILMATE_VOICE_PLAYBACK_MODE || 'stream',
  zilmateVoiceEotThreshold: process.env.ZILMATE_VOICE_EOT_THRESHOLD ? Number(process.env.ZILMATE_VOICE_EOT_THRESHOLD) : undefined,
  zilmateVoiceEagerEotThreshold: process.env.ZILMATE_VOICE_EAGER_EOT_THRESHOLD ? Number(process.env.ZILMATE_VOICE_EAGER_EOT_THRESHOLD) : undefined,
  zilmateVoiceSttFallbackModel: process.env.ZILMATE_VOICE_STT_FALLBACK_MODEL || 'nova-3',
  zilmateVoiceUseNovaFallback: process.env.ZILMATE_VOICE_USE_NOVA_FALLBACK === 'true',
  managerModel: process.env.ZILO_MANAGER_MODEL || 'minimax/minimax-m3',
  helpModel: process.env.ZILO_HELP_MODEL || undefined,
  postModel: process.env.ZILO_POST_MODEL || undefined,
  imageDefaultProvider: normalizeImageProvider(process.env.ZILO_IMAGE_DEFAULT_PROVIDER),
  imageOpenaiModel: process.env.ZILO_IMAGE_OPENAI_MODEL || 'openai/gpt-image-2',
  imageGeminiModel: process.env.ZILO_IMAGE_GEMINI_MODEL || process.env.ZILO_IMAGE_MODEL || 'google/gemini-3.1-flash-image',
  imageModel: process.env.ZILO_IMAGE_MODEL || 'google/gemini-3.1-flash-image',
  screenshotVisionModel: process.env.ZILMATE_SCREENSHOT_MODEL || 'google/gemini-3.1-flash-lite',
  codingModel: process.env.ZILO_CODING_MODEL || undefined,
  slackBotToken: process.env.SLACK_BOT_TOKEN,
  slackSigningSecret: process.env.SLACK_SIGNING_SECRET,
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
  imessageLocal: process.env.IMESSAGE_LOCAL === 'true',
  imessageEnabled: process.env.CHAT_IMESSAGE_ENABLED === 'true',
  chatIntegrationEnabled: process.env.CHAT_INTEGRATION_ENABLED === 'true',
};

export function hasGatewayAuth() {
  return Boolean(env.aiGatewayApiKey || env.vercelOidcToken);
}

export function requireGatewayAuth() {
  if (!hasGatewayAuth()) {
    throw new Error('Missing AI Gateway auth. Run `zilmate setup`, add AI_GATEWAY_API_KEY to .env, or run with VERCEL_OIDC_TOKEN.');
  }
}

export function requireTavily() {
  if (!env.tavilyApiKey) {
    throw new Error('Missing TAVILY_API_KEY. Run `zilmate setup` or add it to .env to enable web research.');
  }
  return env.tavilyApiKey;
}

export function hasComposio() {
  return Boolean(env.composioApiKey && env.zilmateUserId);
}

export function requireComposio() {
  if (!env.composioApiKey) {
    throw new Error('Missing COMPOSIO_API_KEY. Run `zilmate setup` to enable external app tools.');
  }
  if (!env.zilmateUserId) {
    throw new Error('Missing ZILMATE_USER_ID. Run `zilmate setup` to generate a stable local user id.');
  }
}

export function hasRedis() {
  return Boolean(env.upstashRedisRestUrl && env.upstashRedisRestToken);
}

export function hasQStash() {
  return Boolean(env.upstashQstashToken && env.zilmatePublicJobWebhookUrl);
}

export function hasDeepgram() {
  return Boolean(env.deepgramApiKey);
}

export function requireDeepgram() {
  if (!env.deepgramApiKey) {
    throw new Error('Missing DEEPGRAM_API_KEY. Run `zilmate setup` to enable realtime voice mode.');
  }
  return env.deepgramApiKey;
}

export function hasChatIntegration() {
  return env.chatIntegrationEnabled && (Boolean(env.slackBotToken) || Boolean(env.telegramBotToken) || Boolean(env.imessageEnabled));
}
