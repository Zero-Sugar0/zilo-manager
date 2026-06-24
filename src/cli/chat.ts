import { Chat } from "chat";
import { createSlackAdapter } from "@chat-adapter/slack";
import { createTelegramAdapter } from "@chat-adapter/telegram";
import { createiMessageAdapter } from "chat-adapter-imessage";
import { handleChatMessage } from "../runtime/chat-bridge.js";
import { env, hasChatIntegration } from "../config/env.js";
import chalk from "chalk";

export async function startChatListener() {
  if (!hasChatIntegration()) {
    throw new Error("Chat integration is not configured. Run 'zilmate setup chat' first.");
  }

  console.log(chalk.cyan("\nStarting ZilMate Chat Listener..."));

  const adapters: Record<string, any> = {};

  if (env.slackBotToken) {
    console.log(chalk.green("  - Slack adapter enabled"));
    adapters.slack = createSlackAdapter({
      token: env.slackBotToken,
      signingSecret: env.slackSigningSecret,
    });
  }

  if (env.telegramBotToken) {
    console.log(chalk.green("  - Telegram adapter enabled"));
    adapters.telegram = createTelegramAdapter({
      token: env.telegramBotToken,
    });
  }

  if (env.imessageEnabled) {
    console.log(chalk.green(`  - iMessage adapter enabled (${env.imessageLocal ? 'Local' : 'Remote'})`));
    adapters.imessage = createiMessageAdapter({
      local: env.imessageLocal,
    });
  }

  const bot = new Chat({
    userName: "ZilMate",
    adapters,
  });

  bot.onNewMention(async (thread, message) => {
    const platform = message.adapter.name as 'slack' | 'telegram' | 'teams' | 'discord' | 'imessage';

    console.log(chalk.gray(`[${platform}] New message from ${message.author.id}`));

    try {
      await handleChatMessage({
        text: message.text,
        authorId: message.author.id,
        platform,
        threadId: thread.id,
        onReply: (text) => thread.post(text),
        onStep: async (label) => {
          // You could send progress updates here, but it might be noisy for chat
          // thread.post(`_Thinking: ${label}_`);
        }
      });
    } catch (error) {
      console.error(chalk.red(`Error handling message: ${error}`));
    }
  });

  console.log(chalk.yellow("\nZilMate is now listening for messages. Press Ctrl+C to stop."));

  // Keep the process alive
  await new Promise(() => {});
}
