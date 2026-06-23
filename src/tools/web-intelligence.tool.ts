import { tool } from 'ai';
import { z } from 'zod';
import { emitProgress } from '../runtime/progress.js';

export const webIntelligenceTools = {
  autonomousMarketResearch: tool({
    description: 'Perform an autonomous deep research dive on a competitor or market segment. Maps, scrapes, and synthesizes a competitive brief. NOTE: Use Composio Firecrawl tools for the actual execution.',
    inputSchema: z.object({
      url: z.string().url().describe('The competitor website URL.'),
      focus: z.string().optional().describe('Specific area of research (e.g., "pricing", "feature roadmap").'),
    }),
    execute: async ({ url, focus }) => {
      emitProgress({ type: 'tool:start', label: 'Initiating deep research', detail: url });

      return {
        url,
        focus: focus || 'general',
        recommendedSteps: [
          `1. Use FIRECRAWL_MAP to discover high-value pages on ${url}.`,
          `2. Use FIRECRAWL_SCRAPE to extract content from the pricing and features pages.`,
          `3. Use FIRECRAWL_CRAWL for a deeper site-wide analysis if needed.`,
          `4. Synthesize findings into a competitive brief and update your status report.`,
        ],
        message: 'Recursive research blueprint generated. Please execute the recommended steps using the Composio Firecrawl toolkit.'
      };
    },
  }),
};
