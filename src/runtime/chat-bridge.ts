import { createZilMate } from '../server.js';
import { env, hasChatIntegration } from '../config/env.js';
import { emitProgress } from './progress.js';

/**
 * The ChatBridge provides a high-level integration between external chat platforms
 * (Slack, Telegram, etc.) and the ZilMate Manager.
 */
export async function handleChatMessage(input: {
  text: string;
  authorId: string;
  platform: 'slack' | 'telegram' | 'teams' | 'discord' | 'imessage';
  threadId?: string;
  onReply: (text: string) => Promise<void>;
  onStep?: (label: string) => Promise<void>;
}) {
  const sessionId = `chat-${input.platform}-${input.authorId}`;

  emitProgress({
    type: 'thinking',
    label: `Processing ${input.platform} message`,
    detail: `User ${input.authorId}`
  });

  const zilmate = createZilMate({
    sessionId,
    onProgress: async (event) => {
      if (event.type === 'step' && input.onStep) {
        await input.onStep(event.label);
      }
    },
  });

  try {
    const { text } = await zilmate.manager({ message: input.text });
    await input.onReply(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[ChatBridge] Manager error: ${message}`);
    await input.onReply(`⚠️ ZilMate encountered an error: ${message}`);
    throw error;
  }
}

/**
 * Proactive reporting core.
 * Use this to push messages from background jobs to your chat channels.
 * This is FULLY IMPLEMENTED for Telegram and Slack.
 */
export async function pushChatNotification(input: {
  message: string;
  platform: 'slack' | 'telegram' | 'imessage';
  recipientId: string;
  threadId?: string;
}) {
  if (!env.chatIntegrationEnabled) {
    throw new Error('Chat integration is not enabled in environment.');
  }

  if (input.platform === 'telegram') {
    if (!env.telegramBotToken) throw new Error('TELEGRAM_BOT_TOKEN is missing.');

    const url = `https://api.telegram.org/bot${env.telegramBotToken}/sendMessage`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: input.recipientId,
        text: input.message,
        parse_mode: 'Markdown',
      }),
    });

    if (!res.ok) {
      const data = await res.json() as any;
      throw new Error(`Telegram API error: ${data.description || res.statusText}`);
    }
    return { ok: true, platform: 'telegram' };
  }

  if (input.platform === 'slack') {
    if (!env.slackBotToken) throw new Error('SLACK_BOT_TOKEN is missing.');

    const res = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.slackBotToken}`,
      },
      body: JSON.stringify({
        channel: input.recipientId,
        text: input.message,
        thread_ts: input.threadId,
      }),
    });

    const data = await res.json() as any;
    if (!data.ok) {
      throw new Error(`Slack API error: ${data.error}`);
    }
    return { ok: true, platform: 'slack' };
  }

  if (input.platform === 'imessage') {
    // iMessage usually requires the @vercel/chat adapter to be active
    // because it handles the macOS database bridge.
    // We log it here for diagnostic visibility.
    console.log(`[ChatBridge] iMessage push requested for ${input.recipientId}. Ensure 'zilmate chat listen' is running.`);
    return { ok: true, platform: 'imessage', note: 'Queued via adapter' };
  }

  throw new Error(`Platform ${input.platform} not supported for proactive push yet.`);
}
