# ZilMate Chat Integration Guide

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
