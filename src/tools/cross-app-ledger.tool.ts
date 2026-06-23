import { tool } from 'ai';
import { z } from 'zod';
import { emitProgress } from '../runtime/progress.js';
import { Composio } from '@composio/core';
import { VercelProvider } from '@composio/vercel';
import { env } from '../config/env.js';
import { loadComposioSession } from '../memory/composio-session.js';

async function getComposioSession(chatSessionId: string) {
  const composio = new Composio({
    provider: new VercelProvider(),
    apiKey: env.composioApiKey ?? null,
  });
  const saved = await loadComposioSession(chatSessionId);
  if (!saved?.sessionId) return null;
  return composio.use(saved.sessionId);
}

export const crossAppLedgerTools = {
  correlateBusinessData: tool({
    description: 'Correlate data across Stripe (Revenue), HubSpot (Deals), and GitHub (PRs) to provide a single source of truth for business ROI.',
    inputSchema: z.object({
      query: z.string().describe('The search query to match (e.g., customer email, name, or project keyword).'),
      sessionId: z.string().optional().default('default').describe('The chat session ID to reuse Composio credentials.'),
    }),
    execute: async ({ query, sessionId }) => {
      emitProgress({ type: 'tool:start', label: 'Correlating business data', detail: query });

      const session = await getComposioSession(sessionId);
      if (!session) {
        return { error: 'Composio session not found. Please ensure Composio is setup and a session is active.' };
      }

      const results: any = {
        query,
        hubspot: null,
        stripe: null,
        github: null,
        summary: '',
      };

      try {
        // 1. Search HubSpot Contacts
        emitProgress({ type: 'step', label: 'Searching HubSpot CRM', detail: query });
        const hubspotResult = await session.execute('HUBSPOT_SEARCH_CONTACTS', { query }).catch(() => null) as any;
        results.hubspot = hubspotResult;

        // 2. Search Stripe Customers
        emitProgress({ type: 'step', label: 'Searching Stripe Payments', detail: query });
        // Stripe query usually needs a field, if it's an email we use email~
        const stripeQuery = query.includes('@') ? `email~'${query}'` : `name~'${query}'`;
        const stripeResult = await session.execute('STRIPE_SEARCH_CUSTOMERS', { query: stripeQuery }).catch(() => null) as any;
        results.stripe = stripeResult;

        // 3. Search GitHub Issues/PRs
        emitProgress({ type: 'step', label: 'Searching GitHub Engineering', detail: query });
        const githubResult = await session.execute('GITHUB_SEARCH_ISSUES_AND_PULL_REQUESTS', { q: query }).catch(() => null) as any;
        results.github = githubResult;

        // Aggregate Summary
        const contact = hubspotResult?.data?.[0] || {};
        const customer = stripeResult?.data?.[0] || {};
        const prs = githubResult?.data?.total_count || 0;

        const name = (contact as any).firstname || 'unknown';
        const customerId = (customer as any).id || 'none';

        results.summary = `Found ${name} in HubSpot, linked to Stripe customer ${customerId}. Engineering activity: ${prs} related issues/PRs found.`;

        emitProgress({ type: 'tool:end', label: 'Correlation complete' });
        return results;
      } catch (error) {
        emitProgress({ type: 'tool:error', label: 'Correlation failed', detail: String(error) });
        return { ...results, error: String(error) };
      }
    },
  }),
};
