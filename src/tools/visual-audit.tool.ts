import { tool } from 'ai';
import { z } from 'zod';
import { emitProgress } from '../runtime/progress.js';
import { browserTools } from './browser.tool.js';

export const visualAuditTools = {
  visualBrowserAudit: tool({
    description: 'Perform a high-fidelity visual UI/UX audit of a web page using Playwright and Vision. Use this to verify design consistency, check for UI glitches, or audit mobile responsiveness.',
    inputSchema: z.object({
      url: z.string().url().describe('The URL to audit.'),
      focus: z.string().optional().describe('Specific focus (e.g., "header alignment", "mobile layout", "color contrast").'),
      viewport: z.enum(['mobile', 'tablet', 'desktop']).optional().default('desktop'),
    }),
    execute: async ({ url, focus, viewport }) => {
      emitProgress({ type: 'tool:start', label: 'Initiating visual audit', detail: url });

      const widths = { mobile: 390, tablet: 768, desktop: 1280 };
      const heights = { mobile: 844, tablet: 1024, desktop: 800 };

      try {
        // 1. Take screenshots using existing browser tools
        emitProgress({ type: 'step', label: `Capturing ${viewport} screenshot` });
        const screenshotResult = await (browserTools.browserTakeScreenshot.execute as any)({
          url,
          fullPage: true,
        });

        if (!screenshotResult.success) {
          throw new Error(screenshotResult.error || 'Failed to capture screenshot');
        }

        emitProgress({ type: 'tool:end', label: 'Visual audit capture complete' });

        return {
          url,
          viewport,
          focus: focus || 'General UX/UI consistency',
          screenshotPath: screenshotResult.path,
          nextSteps: [
            '1. Analyze the attached screenshot using your internal Vision capabilities.',
            '2. Check for alignment, spacing, and brand consistency (colors/fonts).',
            '3. Report any "Visual Debt" or UI regressions back to the Product Manager.',
          ],
          visionHint: 'The image has been saved to the local workspace. Please reference the screenshot and provide a detailed UX critique.'
        };
      } catch (error) {
        emitProgress({ type: 'tool:error', label: 'Visual audit failed', detail: String(error) });
        return { error: String(error) };
      }
    },
  }),
};
