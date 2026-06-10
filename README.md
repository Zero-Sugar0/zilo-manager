# ZilMate

ZilMate is a CLI-first general assistant with deep built-in ZiloShift expertise. It can chat, answer support questions, draft posts, research docs/web sources, generate image assets, and use Composio for external app tools such as GitHub, Gmail, Slack, Notion, Stripe, and Supabase.

The GitHub project can remain `zilo-manager`, but the installable npm package and command are both `zilmate`.

## Install ZilMate

### Published npm package

After the package is published to npm:

```powershell
npm install -g zilmate
zilmate setup
zilmate --help
```

### GitHub/private install

Before npm publishing, install directly from the GitHub repo:

```powershell
npm install -g github:zester4/zilo-manager
zilmate setup
zilmate --help
```

### Windows installer helper

From PowerShell, the helper can install from GitHub by default:

```powershell
iwr https://raw.githubusercontent.com/zester4/zilo-manager/main/install.ps1 | iex
```

The installer runs the full first-use flow:

1. Installs ZilMate globally.
2. Runs `zilmate setup` to collect `AI_GATEWAY_API_KEY`, optional `COMPOSIO_API_KEY`, optional `TAVILY_API_KEY`, and optional Redis keys.
3. Lets users skip Composio, Tavily, and Redis keys.
4. Runs `zilmate ping` to verify the key.
5. Starts `zilmate talk`.

To install without setup:

```powershell
iex "& { $((iwr -UseBasicParsing https://raw.githubusercontent.com/zester4/zilo-manager/main/install.ps1).Content) } -NoSetup"
```

To skip ping or chat startup:

```powershell
iex "& { $((iwr -UseBasicParsing https://raw.githubusercontent.com/zester4/zilo-manager/main/install.ps1).Content) } -NoPing -NoTalk"
```

To install from npm after publishing:

```powershell
iex "& { $((iwr -UseBasicParsing https://raw.githubusercontent.com/zester4/zilo-manager/main/install.ps1).Content) } -Source npm"
```

The helper checks for Node/npm, runs `npm install -g`, prints `zilmate --help`, starts setup unless `-NoSetup` is passed, verifies auth unless `-NoPing` is passed, and starts chat unless `-NoTalk` is passed.

## Setup

1. Install dependencies:

```powershell
npm install
```

2. Create `.env` from `.env.example`:

The easiest path is:

```powershell
zilmate setup
```

It asks for `AI_GATEWAY_API_KEY`, optionally asks for `COMPOSIO_API_KEY`, `TAVILY_API_KEY`, and Upstash Redis keys, then writes a local `.env`. Composio, Tavily, and Redis can be skipped.

You can also create `.env` manually:

```env
AI_GATEWAY_API_KEY=your_vercel_ai_gateway_key
COMPOSIO_API_KEY=your_composio_key
ZILMATE_USER_ID=zilmate-generated-local-user-id
TAVILY_API_KEY=your_tavily_key
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
ZILO_MANAGER_MODEL=minimax/minimax-m3
ZILO_HELP_MODEL=alibaba/qwen3.7-plus
ZILO_POST_MODEL=alibaba/qwen3.7-plus
ZILO_IMAGE_DEFAULT_PROVIDER=openai
ZILO_IMAGE_OPENAI_MODEL=openai/gpt-image-2
ZILO_IMAGE_GEMINI_MODEL=google/gemini-3-pro-image
ZILO_IMAGE_MODEL=
```

Composio is optional. If `COMPOSIO_API_KEY` is set, ZilMate creates a stable local `ZILMATE_USER_ID`, reuses Composio sessions per chat session, and lets Composio manage app auth links and connected accounts.

Redis is optional. If `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are set, chat turns, scratchpads, and Composio session ids use Redis. If they are missing, ZilMate falls back to local files under `.zilo-manager/`.

## Development Commands

Use these while working inside the project folder:

```powershell
npm run build
npm run zilmate -- --help
npm run zilmate -- setup
npm run zilmate -- doctor
npm run zilmate -- config
npm run zilmate -- models
npm run zilmate -- apps status
npm run zilmate -- triggers listen
npm run zilmate -- triggers types github
npm run zilmate -- triggers list
npm run zilmate -- remember "Prefers concise support replies"
npm run zilmate -- recall support
npm run zilmate -- memory list
npm run zilmate -- talk
npm run zilmate -- talk --session launch
npm run zilmate -- help "why can't a worker apply?"
npm run zilmate -- post "WhatsApp status for workers in Accra"
npm run zilmate -- research "Vercel AI SDK ToolLoopAgent"
npm run zilmate -- image --model openai --size 1024x1024 "ZiloShift launch poster for Ghana workers"
npm run zilmate -- image --model gemini "ZiloShift launch poster for Ghana workers"
npm run zilmate -- manager "Create a plan for helping venues post shifts"
```

Shortcut:

```powershell
npm run talk
npm run doctor
```

## Global CLI

For local development, link the command from this folder:

```powershell
npm run build
npm link
```

Then use ZilMate directly:

```powershell
zilmate --help
zilmate setup
zilmate doctor
zilmate env check
zilmate config
zilmate talk
zilmate ping
zilmate models
zilmate apps status
zilmate triggers listen
zilmate triggers types github
zilmate triggers create GITHUB_BRANCH_CREATED_TRIGGER --dry-run --owner zester4 --repo zilo-manager
zilmate triggers create GITHUB_COMMIT_EVENT --owner zester4 --repo zilo-manager
zilmate triggers list
zilmate remember "Use a warm but concise support tone"
zilmate recall support
zilmate memory list
zilmate help "worker cannot see shifts"
zilmate image --model openai --size 1024x1024 "ZiloShift launch poster"
```

## Command Shape

- `talk`: persistent interactive chat with the main manager agent. This is the best mode for normal use and renders rich terminal Markdown.
- `manager`: one-shot manager orchestration. It can delegate to subagents and use scratchpad tools.
- `doctor`: check local setup, required/optional keys, Node version, memory folder, Redis completeness, and optional live Gateway/Composio status with `--live`.
- `env check`: environment-readiness alias for `doctor`.
- `config`: sanitized config summary without secrets.
- `remember`: save durable long-term memory.
- `recall`: search durable long-term memory.
- `forget`: delete one memory by id, or use `--all`.
- `memory list`: list saved durable memories.
- `apps status`: show whether Composio is configured, the local `ZILMATE_USER_ID`, the current Composio session id, and connected/available toolkit status when the SDK can fetch it.
- `triggers listen`: stream Composio trigger events into the terminal until Ctrl+C.
- `triggers types [toolkit]`: list available trigger types, optionally for one toolkit.
- `triggers info <trigger>`: show trigger config and payload schemas.
- `triggers create <trigger> --flag value`: create a trigger instance; unknown flags become trigger config.
- `triggers list`: list trigger instances.
- `help`: fast troubleshooting and app guidance.
- `chat`: one-shot natural dialogue about ZiloShift workflows.
- `post`: WhatsApp/status/social copy generation.
- `research`: local docs, allowlisted docs, Tavily search/extract/map/crawl/deep research, and sourced summaries.
- `image`: Gateway image generation that saves files under `outputs/images/`. Use `--model openai|chatgpt|gemini` and optionally `--size 1024x1024` for OpenAI.
- `models`: selected models, Gateway availability warnings, and active memory backend.
- `ping`: tiny Gateway text call to verify auth.
- `setup`: interactive `.env` setup for the required AI Gateway key, optional Composio external app tools, optional Tavily search, optional Redis memory, and model defaults.

## Agent Architecture

ZilMate uses a manager agent that delegates to focused subagents and external tools:

- Quick Help: short troubleshooting and app usage guidance.
- Chat: broader ZiloShift workflow conversation.
- Post: launch messages, WhatsApp statuses, captions, and outreach copy.
- Research: local Zilo docs first, then external docs/web research when needed.
- Image: image generation through Gateway image models.
- Composio: external app discovery, auth links, schemas, and execution, attached only to the manager.
- Memory: durable ZilMate facts and preferences saved locally or in Redis, available through CLI commands and manager tools.

Local ZiloShift docs live under `src/doc/`. ZilMate reads them on demand through dedicated tools instead of dumping all docs into every prompt. The manager prefers these local docs for ZiloShift support, worker, venue, payment, verification, SMS, and dispute questions.

## External Apps With Composio

Run setup and add a Composio key:

```powershell
zilmate setup
zilmate apps status
```

In `zilmate talk`, ask for the external task naturally. If an account is not connected yet, ZilMate uses Composio connection tools and prints the connect link returned by Composio. ZilMate does not implement custom OAuth flows.

Read/search/schema/auth-link tools can run without confirmation. Write-like external app actions such as create, update, delete, send, post, publish, invite, transfer, charge, refund, cancel, approve, revoke, workbench, or bash require `Proceed? (y/N)` in the terminal. In noninteractive mode, write-like actions are blocked.

## Trigger Events

For live terminal events, use Composio trigger listening:

```powershell
zilmate triggers types github
zilmate triggers create GITHUB_COMMIT_EVENT --owner zester4 --repo zilo-manager
zilmate triggers listen
```

`listen` streams matching trigger events until Ctrl+C. Use filters when needed:

```powershell
zilmate triggers listen --toolkit gmail
zilmate triggers listen --trigger ti_abc123
zilmate triggers listen --trigger-slug GMAIL_NEW_EMAIL_EVENT --once
```

This is terminal-local. For persistent public callbacks, use webhook/tunnel support later.

The manager agent also has trigger tools. In `zilmate talk`, you can ask:

```text
show me GitHub trigger types
prepare a branch-created trigger for zester4/zilo-manager
create that trigger
```

ZilMate should discover current trigger slugs first, inspect the trigger schema, prefer a dry-run payload, and ask for confirmation before creating a real trigger.

## Model Notes

- Manager/orchestration default: `minimax/minimax-m3`.
- Recommended help/post override: `alibaba/qwen3.7-plus` in `.env`.
- If help/post env vars are blank, ZilMate falls back to the internal cheap-model list in `src/config/models.ts`.
- Default image provider: OpenAI GPT Image 2 via `openai/gpt-image-2` and AI SDK `generateImage`.
- Alternate image provider: Gemini 3 Pro Image via `google/gemini-3-pro-image` and `generateText` file outputs.
- GPT-2 is not used for images.

## Research And Memory

- Zilo docs are searched/read locally first for product behavior.
- Tavily powers web search, URL extraction, site mapping, small capped crawls, and deep research.
- Web crawling and deep research are intentionally heavier tools and should be used only when local docs/search are not enough.
- Scratchpads keep intermediate notes outside the main prompt context.
- Long-term memory stores stable preferences and durable project facts. Use `zilmate remember`, `zilmate recall`, `zilmate forget`, and `zilmate memory list`.
- `zilmate talk` automatically recalls relevant long-term memories for each message.
- Redis is optional; local file memory is the fallback.
- `zilmate setup` creates or updates the local `.env` used by the CLI.

## Safety Notes

ZilMate can guide, research, draft, generate assets, and run approved external app actions through Composio. It should not claim that live external or ZiloShift data changed unless a tool result confirms it.

Before adding real actions around payments, identity, SMS, users, or admin operations, add stronger permission levels, confirmation gates, audit logs, and behavioral evals.
