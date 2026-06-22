import { tool } from 'ai';
import { z } from 'zod';
import FirecrawlApp from '@mendable/firecrawl-js';
import { emitProgress } from '../runtime/progress.js';

const app = new FirecrawlApp({ apiKey: process.env.FIRECRAWL_API_KEY || '' });

export const webIntelligenceTools = {
  scrapeUrl: tool({
    description: 'Scrape a single URL and return clean Markdown content. Optimized for LLM consumption.',
    inputSchema: z.object({
      url: z.string().url().describe('The URL to scrape.'),
    }),
    execute: async ({ url }) => {
      emitProgress({ type: 'tool:start', label: 'Scraping URL', detail: url });
      try {
        const scrapeResult = await app.scrapeUrl(url, {
          formats: ['markdown'],
        }) as any;

        if (scrapeResult.success === false) {
          throw new Error(`Firecrawl scrape failed: ${scrapeResult.error}`);
        }

        emitProgress({ type: 'tool:end', label: 'URL scraped successfully' });
        return {
          url,
          markdown: scrapeResult.markdown,
          metadata: scrapeResult.metadata,
        };
      } catch (error) {
        emitProgress({ type: 'tool:error', label: 'Scrape failed', detail: String(error) });
        throw error;
      }
    },
  }),

  crawlWebsite: tool({
    description: 'Crawl a website and extract content from multiple pages. Useful for deep site research.',
    inputSchema: z.object({
      url: z.string().url().describe('The base URL to start crawling.'),
      limit: z.number().int().min(1).max(50).optional().default(5),
    }),
    execute: async ({ url, limit }) => {
      emitProgress({ type: 'tool:start', label: 'Crawling website', detail: `${url} (limit: ${limit})` });
      try {
        const crawlResponse = await app.crawlUrl(url, {
          limit,
          scrapeOptions: {
            formats: ['markdown'],
          },
        }) as any;

        if (crawlResponse.success === false) {
          throw new Error(`Firecrawl crawl failed: ${crawlResponse.error}`);
        }

        emitProgress({ type: 'tool:end', label: 'Website crawl complete' });
        return {
          baseUrl: url,
          pageCount: crawlResponse.data.length,
          pages: crawlResponse.data.map((page: any) => ({
            url: page.url,
            markdown: page.markdown,
          })),
        };
      } catch (error) {
        emitProgress({ type: 'tool:error', label: 'Crawl failed', detail: String(error) });
        throw error;
      }
    },
  }),

  mapWebsite: tool({
    description: 'Map the sitemap of a website to identify all available URLs.',
    inputSchema: z.object({
      url: z.string().url().describe('The website URL.'),
    }),
    execute: async ({ url }) => {
      emitProgress({ type: 'tool:start', label: 'Mapping website', detail: url });
      try {
        const mapResult = await app.mapUrl(url) as any;

        if (mapResult.success === false) {
          throw new Error(`Firecrawl map failed: ${mapResult.error}`);
        }

        emitProgress({ type: 'tool:end', label: 'Website mapping complete' });
        return {
          url,
          links: mapResult.links,
        };
      } catch (error) {
        emitProgress({ type: 'tool:error', label: 'Map failed', detail: String(error) });
        throw error;
      }
    },
  }),
};
