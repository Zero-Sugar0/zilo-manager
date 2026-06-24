# ZilMate Chat Integration Guide

<<<<<<< HEAD
This document outlines how to integrate ZilMate into third-party chat platforms like Slack, Telegram, Microsoft Teams, and iMessage, enabling both reactive (responding to mentions) and proactive (reporting events) capabilities.

## 1. Unified Integration with @vercel/chat (Chat SDK)

ZilMate's server SDK is designed to plug directly into the [Chat SDK](https://github.com/vercel/chat) ecosystem. This provides a single interface for multiple adapters.

### Installation
```bash
npm install chat @chat-adapter/slack @chat-adapter/telegram
```

### Implementation Example
Create a bridge file (e.g., `src/chat-bridge.ts`) that connects ZilMate's Manager to the chat adapters.

```typescript
import { Chat } from "chat";
import { createSlackAdapter } from "@chat-adapter/slack";
import { createTelegramAdapter } from "@chat-adapter/telegram";
import { createZilMate } from "zilmate/server";

const bot = new Chat({
  adapters: {
    slack: createSlackAdapter(),
    telegram: createTelegramAdapter({ token: process.env.TELEGRAM_TOKEN }),
  },
});

// Reactive: Respond to mentions
bot.onNewMention(async (thread, message) => {
  const zilmate = createZilMate({
    sessionId: `chat-${message.adapter.name}-${message.author.id}`,
    onProgress: (e) => {
      // Stream thinking progress to the chat
      if (e.type === 'step') thread.post(`_Thinking: ${e.label}_`);
    }
  });

  const { text } = await zilmate.manager({ message: message.text });
  await thread.post(text);
});
```

## 2. Proactive Reporting (The "Powerful" Part)

ZilMate can act autonomously by reporting business events back to your chat channels.

### A. Event Triggers (via Composio)
ZilMate's `orchestrateComposioTrigger` (`src/jobs/trigger-orchestrator.ts`) allows the agent to wake up when external apps (Stripe, HubSpot, GitHub) fire events.

**Workflow:**
1.  **Configure Trigger:** Use `zilmate triggers create` for an app event.
2.  **Define Action:** In the orchestrator, add a step to post the result to your chat bridge instead of just a desktop notification.

### B. Scheduled Briefings (via QStash)
Use ZilMate's background jobs to schedule tasks that report to you.
```typescript
const job = await zilmate.createJob({
  task: "Research the top 3 trending AI tools today and send a summary to my Telegram.",
  schedule: "0 9 * * *" // Daily at 9 AM
});
```

## 3. Supported Platforms & Adapters

| Platform | Adapter Package | Notes |
|----------|-----------------|-------|
| **Slack** | `@chat-adapter/slack` | Supports Socket Mode and Webhooks. |
| **Telegram**| `@chat-adapter/telegram`| Uses the Telegram Bot API. |
| **MS Teams**| `@chat-adapter/teams` | Requires Azure Bot Service. |
| **iMessage**| `chat-adapter-imessage`| Can run locally on macOS or via bridge. |
| **Discord** | `@chat-adapter/discord`| Ideal for community management. |

## 4. Key Benefits of this Architecture
*   **State Persistence:** ZilMate's `sessionId` ensures memory carries over across different platforms for the same user.
*   **Proactive Awareness:** By leveraging `situationalAwarenessTools`, the agent can warn you in chat if a build fails or revenue drops.
*   **Unified Brain:** You only need to update the ZilMate Manager logic in one place to improve all your chat bots simultaneously.

## 5. CLI Usage (The "Terminal" Way)

If you prefer using ZilMate directly in the terminal, it offers parity with the SDK features.

### Interactive Mode
To start a long-running, conversational session where the agent remembers the context:
```bash
# Uses the 'default' session
zilmate talk

# Uses a specific named session
zilmate talk --session my-project-research
```

### One-Shot Commands
For quick questions or tasks without entering an interactive shell:
```bash
# Conversational guide
zilmate chat "How do I process a refund in ZiloShift?"

# Full manager orchestration (for complex tasks)
zilmate manager "Research the current repo and suggest a refactor for the auth logic."
```

### Shared State
ZilMate CLI and SDK share the same workspace. If you run a task in the SDK with `sessionId: "alpha"`, you can resume it in the terminal using:
```bash
zilmate talk --session alpha
```
=======
ZilMate is now a fully multi-channel agent. You can communicate with it via **Slack**, **Telegram**, **iMessage**, and the **Terminal** simultaneously, with a unified brain and persistent memory.

## 1. Professional Setup & Diagnostics

As the project owner, I've integrated Chat as a first-class citizen. Use the built-in wizard to configure your bots.

### Interactive Setup
```bash
# Configure everything
zilmate setup

# OR configure chat specifically
zilmate setup chat
```

You will be prompted for:
*   **Slack:** Bot Token and Signing Secret.
*   **Telegram:** Bot Token.
*   **iMessage:** Local macOS mode or Remote Photon mode.

### Health Checks
```bash
zilmate doctor
```
The doctor verifies your channel configurations and ensures adapters are ready.

## 2. Running the Chat Bot (Production Grade)

Once configured, start the production listener. This connects to all enabled platforms and starts processing messages.

```bash
zilmate chat listen
```

*   **Persistent Sessions:** ZilMate automatically maps users to unique session IDs (e.g., `chat-slack-U12345`). This ensures that if you start a task on Slack, the agent remembers it when you follow up later.
*   **Shared Brain:** The same Manager used in the CLI handles your chat messages, giving you full orchestration and tool access (Stripe, GitHub, etc.) from your phone.

## 3. Trigger-Based Proactive Reporting

ZilMate doesn't just wait for you to speak; it can report to you.

### Automatic Event Responses
Using the `TriggerOrchestrator`, ZilMate can detect events (like a Stripe payout or a GitHub push) and proactively send a summary to your Telegram or Slack.

### Scheduled Briefings
```bash
# Create a scheduled report
zilmate jobs create "At 9 AM, research my competitor's latest news and send a summary to Slack." --schedule "0 9 * * *"
```

## 4. Architecture Reference

The integration is built on the [Chat SDK](https://github.com/vercel/chat), providing a stable normalization layer for:
*   `@chat-adapter/slack`
*   `@chat-adapter/telegram`
*   `chat-adapter-imessage` (Supports local macOS DB and remote bridge)

## 5. Terminal vs Chat Parity

You have 100% feature parity.
*   **Terminal:** Use `zilmate talk` for deep work.
*   **Chat:** Use Telegram/Slack for mobile access and alerts.
*   **SDK:** Use `createZilMate()` to build custom UI integrations.

All interfaces share the same **Workspace Memory**, ensuring ZilMate stays smart regardless of where you talk to it.
>>>>>>> main
