import { stepCountIs, ToolLoopAgent, tool } from 'ai';
import { z } from 'zod';
import { models } from '../config/models.js';
import { createScratchpadTools } from '../tools/scratchpad.tool.js';
import { notebookTools } from '../tools/notebook.tool.js';
import { fileSystemTools } from '../tools/filesystem.tool.js';
import { codeIntelligenceTools } from '../tools/code-intelligence.tool.js';
import { gitTools } from '../tools/git.tool.js';
import { shellTools } from '../tools/shell.tool.js';
import { skillTools } from '../tools/skills.tool.js';
import { timeTools } from '../tools/time.tool.js';
import { limits } from '../safety/limits.js';
import { emitProgress } from '../runtime/progress.js';
import { createComposioTools } from '../tools/composio.tool.js';
import { createMCPTools } from '../tools/mcp.tool.js';

async function createAppBuilderAgent(runId = 'default') {
  const scratchpadTools = createScratchpadTools(`${runId}:app-builder`);
  const composioTools = await createComposioTools(runId);
  const mcpTools = await createMCPTools();

  return new ToolLoopAgent({
    model: models.coding,
    instructions: [
      'You are ZilMate App Builder, an internal coding subagent for building complete apps, games, tools, and software projects end to end.',
      'CORE CAPABILITIES:',
      '1. Full-stack scaffolding (Next.js, Vite, React Native).',
      '2. Legacy code refactoring & bug fixing.',
      '3. Database design & migrations (Supabase, Neon, PostgreSQL).',
      '4. Third-party API & Webhook integration.',
      '5. High-fidelity UI/UX (shadcn/ui, Tailwind).',
      '6. Auth & RBAC (Supabase Auth).',
      '7. Payments & Subscriptions (Stripe).',
      '8. State management (Zustand, Query).',
      '9. CI/CD & Deployment (Vercel, Render, Netlify).',
      '10. Automated testing (Playwright, Jest).',
      '11. Game development (Game loops, Canvas).',
      '12. Time-series data & analytics (Sleep tracking).',
      '13. Edge & Serverless functions.',
      '14. Real-time sync (WebSockets).',
      '15. Technical documentation.',
      '',
      'Use skills first when the task matches a framework or domain: searchSkills/readSkill before designing Vite, Next.js, React, shadcn, ai-elements, AI SDK, Composio, Supabase, games, or desktop workflows.',
      'Choose the existing stack when inside a repo. For new frontend apps, prefer Vite for lightweight apps/games and Next.js when routing, server APIs, auth, SDK routes, or deployment structure matter.',
      'Implement real working screens and workflows, not placeholder landing pages. For games, build actual gameplay. For apps, build the usable first screen and the expected controls/states.',
      'Use file tools for targeted edits, shell tools for installs/builds/tests, and notebook tools to save durable project decisions, commands, ports, and follow-up context.',
      'When external apps are needed, design around Composio search/link/execute workflows and keep user secrets server-side.',
      'Return a concise builder report: files changed, commands run, dev server or build status, and what remains.',
    ].join('\n'),
    tools: {
      ...timeTools,
      ...fileSystemTools,
      ...codeIntelligenceTools,
      ...shellTools,
      ...skillTools,
      ...notebookTools,
      ...scratchpadTools,
      ...composioTools,
      ...mcpTools,
    },
    stopWhen: stepCountIs(limits.subagentSteps),
  });
}

async function createQaIntegrationAgent(runId = 'default') {
  const scratchpadTools = createScratchpadTools(`${runId}:qa`);
  const composioTools = await createComposioTools(runId);
  const mcpTools = await createMCPTools();

  return new ToolLoopAgent({
    model: models.coding,
    instructions: [
      'You are ZilMate QA and Integration Builder, an internal coding subagent for verification, debugging, test coverage, dependency checks, and release readiness.',
      'Read the implementation and repo scripts before testing. Use skills when framework-specific testing or build rules exist.',
      'Run the narrowest useful checks first, then broaden when shared behavior or user-facing workflows are touched.',
      'Fix build/type/lint/runtime failures when the cause is clear. Do not hide failed checks; report command, exit state, and useful error lines.',
      'Use notebook tools to persist durable verification notes, recurring gotchas, release steps, and environment assumptions.',
      'For Composio or external-app features, verify connection/setup paths separately from write-like actions and keep destructive actions behind confirmation.',
      'Return a concise QA report: checks run, failures fixed, remaining risks, and exact next command for the main agent/user.',
    ].join('\n'),
    tools: {
      ...timeTools,
      ...gitTools,
      ...codeIntelligenceTools,
      ...fileSystemTools,
      ...shellTools,
      ...skillTools,
      ...notebookTools,
      ...scratchpadTools,
      ...composioTools,
      ...mcpTools,
    },
    stopWhen: stepCountIs(limits.subagentSteps),
  });
}

type CodingDelegate = {
  generate(input: { prompt: string; abortSignal?: AbortSignal }): Promise<{ text: string }>;
};

function codingDelegateTool(name: 'appBuilder' | 'qaIntegration', description: string, agent: CodingDelegate) {
  return tool({
    description,
    inputSchema: z.object({
      task: z.string().min(10),
      context: z.string().optional(),
    }),
    execute: async ({ task, context }, { abortSignal }) => {
      emitProgress({ type: 'subagent:start', agent: name, label: 'Delegated coding work', detail: task.slice(0, 160) });
      emitProgress({ type: 'subagent:step', agent: name, label: 'Running focused build loop' });
      const prompt = context ? `${context}\n\nTask:\n${task}` : task;
      const result = await agent.generate({
        prompt,
        ...(abortSignal ? { abortSignal } : {}),
      });
      emitProgress({ type: 'subagent:end', agent: name, label: 'Delegate finished' });
      return result.text;
    },
  });
}

export async function createCodingAgent(runId = 'default') {
  const scratchpadTools = createScratchpadTools(runId);
  const appBuilder = await createAppBuilderAgent(runId);
  const qaBuilder = await createQaIntegrationAgent(runId);
  const composioTools = await createComposioTools(runId);
  const mcpTools = await createMCPTools();

  return new ToolLoopAgent({
    model: models.coding,
    instructions: [
      'You are ZilMate Coding Agent, the main coding orchestrator reporting back to the Manager.',
      'You manage two internal coding delegates: appBuilder for full app/game/software implementation, and qaIntegration for testing, debugging, integration, and release checks.',
      'Delegate substantial end-to-end build work to appBuilder. Delegate verification, failing builds, test strategy, and integration cleanup to qaIntegration. Keep ownership of the final user-facing report.',
      'Prefer small, reviewable changes: read files, use gitDiff, applyUnifiedPatch for surgical edits instead of rewriting entire files.',
      'Workflow: gitStatus -> search/read skills -> read affected files -> plan/delegate if useful -> patch or targeted writeFile -> run tests via executeCommand or qaIntegration -> gitDiff -> gitStage/gitCommit only when user asked to commit.',
      'Use git tools for branch awareness, diffs, staging, and commits. Never force-push unless the user explicitly requests it.',
      'Use searchSkills/readSkill when a repo skill documents conventions. For AI SDK work, verify against local ai docs/source. For Composio integrations, follow search -> link -> execute patterns and keep secrets server-side.',
      'Use scratchpad for temporary run planning. Use notebook tools for durable project memory: architecture decisions, setup steps, known failures, ports, commands, and handoff notes.',
      'Report what you changed, which files, subagents used, and test/build output. Keep the final concise but include failures honestly.',
      'Do not claim tests passed unless executeCommand output shows success.',
    ].join(' '),
    tools: {
      appBuilder: codingDelegateTool('appBuilder', 'Delegate full app, game, software, Vite, Next.js, UI, or end-to-end implementation work to the internal app builder.', appBuilder),
      qaIntegration: codingDelegateTool('qaIntegration', 'Delegate testing, debugging, build fixes, integration checks, and release-readiness verification to the internal QA/integration builder.', qaBuilder),
      ...timeTools,
      ...gitTools,
      ...codeIntelligenceTools,
      ...fileSystemTools,
      ...shellTools,
      ...skillTools,
      ...notebookTools,
      ...scratchpadTools,
      ...composioTools,
      ...mcpTools,
    },
    stopWhen: stepCountIs(limits.subagentSteps),
  });
}
