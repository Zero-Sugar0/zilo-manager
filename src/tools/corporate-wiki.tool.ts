import { tool } from 'ai';
import { z } from 'zod';
import { queryWiki, addWikiFact } from '../memory/corporate-wiki.js';

export const corporateWikiTools = {
  queryCorporateWiki: tool({
    description: 'Query the shared corporate knowledge wiki database to gain situational awareness on competitor insights, market conditions, schema payloads, or previous strategic reports.',
    inputSchema: z.object({
      query: z.string().min(3).describe('Semantic or keyword query (e.g. "competitor pricing analysis", "auth API contract").'),
      limit: z.number().optional().default(5).describe('Maximum number of items to return.'),
    }),
    execute: async ({ query, limit }) => {
      const { SwarmTraceTracker } = await import('../observability/traces.js');
      await SwarmTraceTracker.getInstance().recordEvent('wiki_query', 'Query Wiki', query);

      const results = await queryWiki(query, limit);
      return {
        query,
        count: results.length,
        results,
      };
    },
  }),

  publishToCorporateWiki: tool({
    description: 'Publish a final deliverable, market/price analysis, schema contract, or crucial intelligence to the shared corporate wiki so that other specialist agents instantly have access to it.',
    inputSchema: z.object({
      content: z.string().min(10).describe('Key facts, api schemas, or research data to index.'),
      metadata: z.object({
        category: z.string().optional().describe('The document or fact category, e.g. "market-research", "api-schema", "financial-report".'),
        topic: z.string().optional().describe('Detailed topic name.'),
      }).optional().default({}),
    }),
    execute: async ({ content, metadata }) => {
      const { SwarmTraceTracker } = await import('../observability/traces.js');
      await SwarmTraceTracker.getInstance().recordEvent('wiki_publish', 'Publish Wiki', metadata?.topic || metadata?.category || 'fact');

      await addWikiFact(content, metadata);
      return {
        status: 'SUCCESS',
        message: 'Intelligence published to corporate wiki',
        bytes: content.length,
      };
    },
  }),
};

