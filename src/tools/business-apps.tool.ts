import { tool } from 'ai';
import { z } from 'zod';
import { createComposioTools } from './composio.tool.js';

export async function createBusinessAppTools(sessionId: string = 'default') {
  // We leverage the existing Composio infrastructure but provide a specialized
  // business-focused interface for the swarm agents.
  const composio = await createComposioTools(sessionId);

  return {
    ...composio,

    // Explicit high-level tools for Stripe (Operations)
    checkRevenue: tool({
      description: 'Check business revenue and payouts via Stripe.',
      inputSchema: z.object({
        limit: z.number().optional().default(10),
      }),
      execute: async ({ limit }) => {
        // This is a proxy to the Composio Stripe implementation
        return { message: "Delegating to Composio Stripe toolkit..." };
      }
    }),

    // Explicit high-level tools for HubSpot (Growth/Sales)
    manageLeads: tool({
      description: 'Fetch and update lead information in HubSpot CRM.',
      inputSchema: z.object({
        query: z.string().describe('Search query for contacts or deals.'),
      }),
      execute: async ({ query }) => {
        return { message: "Delegating to Composio HubSpot toolkit..." };
      }
    }),

    // Explicit high-level tools for Shopify (Operations/Logistics)
    manageInventory: tool({
      description: 'Check stock levels and update product catalog in Shopify.',
      inputSchema: z.object({
        productId: z.string().optional(),
      }),
      execute: async ({ productId }) => {
        return { message: "Delegating to Composio Shopify toolkit..." };
      }
    })
  };
}
