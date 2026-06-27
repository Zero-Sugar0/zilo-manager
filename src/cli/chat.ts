import { Chat } from "chat";
import { createSlackAdapter } from "@chat-adapter/slack";
import { createTelegramAdapter } from "@chat-adapter/telegram";
import { createiMessageAdapter } from "chat-adapter-imessage";
import { createMemoryState } from "@chat-adapter/state-memory";
import { handleChatMessage } from "../runtime/chat-bridge.js";
import { env, hasChatIntegration } from "../config/env.js";
import chalk from "chalk";

export async function startChatListener(enabledAdapters?: string[]) {
  if (!hasChatIntegration()) {
    throw new Error("Chat integration is not configured. Run 'zilmate setup chat' first.");
  }

  console.log(chalk.cyan("\nStarting ZilMate Chat Listener..."));
  
  const adapters: Record<string, any> = {};

  const startSlack = !enabledAdapters || enabledAdapters.includes('slack');
  const startTelegram = !enabledAdapters || enabledAdapters.includes('telegram');
  const startiMessage = !enabledAdapters || enabledAdapters.includes('imessage');

  if (env.slackBotToken && startSlack) {
    console.log(chalk.green("  - Slack adapter enabled"));
    adapters.slack = createSlackAdapter({
      botToken: env.slackBotToken,
      ...(env.slackSigningSecret ? { signingSecret: env.slackSigningSecret } : {}),
    });
  }

  if (env.telegramBotToken && startTelegram) {
    console.log(chalk.green("  - Telegram adapter enabled (forced polling mode)"));
    adapters.telegram = createTelegramAdapter({
      botToken: env.telegramBotToken,
      mode: "polling",
    });
  }

  if (env.imessageEnabled && startiMessage) {
    console.log(chalk.green(`  - iMessage adapter enabled (${env.imessageLocal ? 'Local' : 'Remote'})`));
    adapters.imessage = createiMessageAdapter({
      local: env.imessageLocal,
    });
  }

  const bot = new Chat({
    userName: "ZilMate",
    adapters,
    state: createMemoryState(),
    concurrency: "queue",
  });

  async function processMessage(thread: any, message: any) {
    const platform = thread.adapter.name as 'slack' | 'telegram' | 'teams' | 'discord' | 'imessage';
    console.log(chalk.gray(`[${platform}] Message from ${message.author.userId}: ${message.text}`));

    try {
      if (thread.startTyping) {
        await thread.startTyping().catch(() => {});
      }
      await handleChatMessage({
        text: message.text,
        authorId: message.author.userId,
        platform,
        threadId: thread.id,
        onReply: async (text) => {
          await thread.post(text);
        },
        onStep: async (label) => {
          // Progress feedback can be enabled if desired
        }
      });
    } catch (error) {
      console.error(chalk.red(`Error handling message: ${error}`));
    }
  }

  bot.onNewMention(async (thread, message) => {
    console.log(chalk.gray(`[${thread.adapter.name}] New mention in thread ${thread.id}`));
    await thread.subscribe();
    await processMessage(thread, message);
  });

  bot.onSubscribedMessage(async (thread, message) => {
    await processMessage(thread, message);
  });

  bot.onDirectMessage(async (thread, message) => {
    await processMessage(thread, message);
  });

  console.log(chalk.cyan("\nInitializing bot adapters..."));
  await bot.initialize();

  console.log(chalk.yellow("\nZilMate is now listening for messages. Press Ctrl+C to stop."));
  
  // Keep the process alive
  await new Promise(() => {});
}
