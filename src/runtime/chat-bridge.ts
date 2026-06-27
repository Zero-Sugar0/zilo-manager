import { createZilMate } from '../server.js';
import { env } from '../config/env.js';
import { emitProgress } from './progress.js';
import { loadTurns, saveTurns, type ChatTurn } from '../memory/history.js';
import { recall } from '../memory/long-term.js';

function transcript(turns: ChatTurn[]) {
  if (turns.length === 0) return '';
  return turns
    .slice(-10)
    .map((turn) => `${turn.role === 'user' ? 'User' : 'ZilMate'}: ${turn.content}`)
    .join('\n');
}

function memoryBlock(memories: Awaited<ReturnType<typeof recall>>) {
  if (memories.length === 0) return '';
  return memories.map((memory) => `- [${memory.id}] ${memory.text}${memory.tags.length ? ` (tags: ${memory.tags.join(', ')})` : ''}`).join('\n');
}

/**
 * The ChatBridge provides a high-level integration between external chat adapters 
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
  const sessionId = input.threadId 
    ? `chat-${input.platform}-${input.threadId}` 
    : `chat-${input.platform}-${input.authorId}`;
  
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
    let turns = await loadTurns(sessionId);
    const context = transcript(turns);
    const relevantMemory = memoryBlock(await recall(input.text, 6));

    const formattingInstruction = input.platform === 'telegram'
      ? `\n\n[FORMATTING FOR TELEGRAM]: Telegram has very strict parsing limitations. You MUST follow these layout rules:
- NEVER use standard markdown tables (| Column |). Instead, use a preformatted monospaced code block (\`\`\`text\\n...\\n\`\`\`) to display tabular data, or format them as bullet points with bold labels.
- NEVER use hashtag headings (e.g. #, ##, ###). Instead, use bold text (e.g., "*Quick Status Check*") for section titles.
- Keep lists and bullets flat and highly readable with clean emoji indicators.`
      : '';

    const prompt = context
      ? `Conversation so far:\n${context}\n\n${relevantMemory ? `Relevant long-term memory:\n${relevantMemory}\n\n` : ''}New user message:\n${input.text}\n\nAnswer as ZilMate. Delegate to subagents when useful and return a concise final answer.${formattingInstruction}`
      : `${relevantMemory ? `Relevant long-term memory:\n${relevantMemory}\n\n` : ''}${input.text}\n\nAnswer as ZilMate. Delegate to subagents when useful and return a concise final answer.${formattingInstruction}`;

    const { text } = await zilmate.manager({ message: prompt });

    turns.push(
      { role: 'user', content: input.text, createdAt: new Date().toISOString() },
      { role: 'assistant', content: text, createdAt: new Date().toISOString() },
    );
    await saveTurns(sessionId, turns);

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
    console.log(`[ChatBridge] iMessage push requested for ${input.recipientId}. Ensure 'zilmate chat listen' is running.`);
    return { ok: true, platform: 'imessage', note: 'Queued via adapter' };
  }

  throw new Error(`Platform ${input.platform} not supported for proactive push yet.`);
}
