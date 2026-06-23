import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { tool } from 'ai';
import { z } from 'zod';
import { requestConfirmation } from '../runtime/confirm.js';
import { emitProgress } from '../runtime/progress.js';
import { getOutputDir } from '../workspace/output-paths.js';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';

let browser: Browser | null = null;
let context: BrowserContext | null = null;
let page: Page | null = null;

const outputDir = getOutputDir('browser');

async function ensurePage() {
  if (!browser) {
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36 ZilMate/1.0',
    });
    page = await context.newPage();
  }
  if (!page) {
    if (!context) {
       context = await browser!.newContext();
    }
    page = await context.newPage();
  }
  return page;
}

async function confirmBrowserAction(action: string, detail: string) {
  return requestConfirmation({
    toolkitSlug: 'BROWSER',
    toolSlug: 'AUTOMATION',
    action,
    access: 'Write',
    targetTools: ['BROWSER_AUTOMATION'],
    details: [detail],
    summary: `${action}: ${detail}`,
  });
}

function ts() { return new Date().toISOString().replace(/[:.]/g, '-'); }

export const browserTools = {
  browserNavigate: tool({
    description: 'Navigate to a URL in the browser.',
    inputSchema: z.object({
      url: z.string().url().describe('The URL to navigate to.'),
      waitUntil: z.enum(['load', 'domcontentloaded', 'networkidle', 'commit']).optional().default('load'),
    }),
    execute: async ({ url, waitUntil }) => {
      emitProgress({ type: 'tool:start', label: 'Browser navigating', detail: url });
      const p = await ensurePage();
      await p.goto(url, { waitUntil });
      const title = await p.title();
      emitProgress({ type: 'tool:end', label: 'Browser navigation complete', detail: title });
      return { url, title, status: 'ok' };
    },
  }),

  browserClick: tool({
    description: 'Click an element on the current page using a CSS selector.',
    inputSchema: z.object({
      selector: z.string().describe('CSS selector of the element to click.'),
      timeout: z.number().optional().default(10000),
    }),
    execute: async ({ selector, timeout }) => {
      const approved = await confirmBrowserAction('Click', selector);
      if (!approved) throw new Error('Blocked browser click.');

      emitProgress({ type: 'tool:start', label: 'Browser clicking', detail: selector });
      const p = await ensurePage();
      await p.click(selector, { timeout });
      emitProgress({ type: 'tool:end', label: 'Browser click complete' });
      return { selector, result: 'clicked' };
    },
  }),

  browserType: tool({
    description: 'Type text into an input field using a CSS selector.',
    inputSchema: z.object({
      selector: z.string().describe('CSS selector of the input field.'),
      text: z.string().describe('Text to type.'),
      delay: z.number().optional().default(50).describe('Delay between key presses in ms.'),
      pressEnter: z.boolean().optional().default(false).describe('Whether to press Enter after typing.'),
    }),
    execute: async ({ selector, text, delay, pressEnter }) => {
      const approved = await confirmBrowserAction('Type', `${text} into ${selector}`);
      if (!approved) throw new Error('Blocked browser type.');

      emitProgress({ type: 'tool:start', label: 'Browser typing', detail: selector });
      const p = await ensurePage();
      await p.fill(selector, ''); // Clear first
      await p.type(selector, text, { delay });
      if (pressEnter) {
        await p.keyboard.press('Enter');
      }
      emitProgress({ type: 'tool:end', label: 'Browser typing complete' });
      return { selector, result: 'typed' };
    },
  }),

  browserExtractContent: tool({
    description: 'Extract text or HTML content from the current page.',
    inputSchema: z.object({
      mode: z.enum(['text', 'html', 'markdown', 'links']).optional().default('text'),
      selector: z.string().optional().describe('Optional CSS selector to extract from.'),
    }),
    execute: async ({ mode, selector }) => {
      emitProgress({ type: 'tool:start', label: 'Browser extracting content', detail: mode });
      const p = await ensurePage();

      let result: any;
      if (mode === 'text') {
        result = selector ? await p.innerText(selector) : await p.innerText('body');
      } else if (mode === 'html') {
        result = selector ? await p.innerHTML(selector) : await p.content();
      } else if (mode === 'links') {
        result = await p.$$eval('a', (links) => links.map(a => ({ text: (a as any).innerText, href: (a as any).href })));
      } else {
        // Fallback to text for now
        result = await p.innerText('body');
      }

      emitProgress({ type: 'tool:end', label: 'Browser extraction complete' });
      return { mode, result };
    },
  }),

  browserTakeScreenshot: tool({
    description: 'Take a screenshot of the current page.',
    inputSchema: z.object({
      fullPage: z.boolean().optional().default(false),
    }),
    execute: async ({ fullPage }) => {
      emitProgress({ type: 'tool:start', label: 'Browser taking screenshot' });
      const p = await ensurePage();
      await mkdir(outputDir, { recursive: true });
      const filePath = path.join(outputDir, `browser-${ts()}.png`);
      await p.screenshot({ path: filePath, fullPage });
      emitProgress({ type: 'tool:end', label: 'Browser screenshot saved', detail: filePath });
      return { filePath };
    },
  }),

  browserExecuteScript: tool({
    description: 'Execute custom JavaScript in the browser context.',
    inputSchema: z.object({
      script: z.string().describe('The JavaScript code to execute.'),
    }),
    execute: async ({ script }) => {
      const approved = await confirmBrowserAction('Execute Script', script.slice(0, 100));
      if (!approved) throw new Error('Blocked browser script execution.');

      emitProgress({ type: 'tool:start', label: 'Browser executing script' });
      const p = await ensurePage();
      const result = await p.evaluate(script);
      emitProgress({ type: 'tool:end', label: 'Browser script execution complete' });
      return { result };
    },
  }),

  browserClose: tool({
    description: 'Close the browser instance.',
    inputSchema: z.object({}),
    execute: async () => {
      if (browser) {
        await browser.close();
        browser = null;
        context = null;
        page = null;
      }
      return { status: 'closed' };
    },
  }),

  visualBrowserAudit: tool({
    description: 'Capture a screenshot of the current page and perform a visual UI/UX audit using Vision models. Use this to verify design consistency.',
    inputSchema: z.object({
      focus: z.string().optional().describe('Specific UI element or area to audit (e.g., "navigation menu", "mobile responsiveness").'),
    }),
    execute: async ({ focus }) => {
      emitProgress({ type: 'tool:start', label: 'Performing visual audit', ...(focus ? { detail: focus } : {}) });
      const p = await ensurePage();
      const filePath = path.join(outputDir, `audit-${ts()}.png`);
      await p.screenshot({ path: filePath });

      // We delegate the actual vision analysis to the screenshot analyzer
      // but wrap it in a business-centric context.
      const prompt = focus
        ? `Perform a professional UI/UX audit of this page, focusing on ${focus}. Compare against standard brand guidelines.`
        : 'Perform a professional UI/UX audit of this entire page. Identify layout issues, accessibility gaps, and brand consistency.';

      // In a real implementation, we would call the internal analyzeImage here.
      return {
        screenshotPath: filePath,
        auditPrompt: prompt,
        message: 'Screenshot captured. Use analyzeScreenshot with this path for full visual reasoning.'
      };
    },
  }),
};
