import { SwarmAgent } from '../../../runtime/swarm.js';
import { browserTools } from '../../../tools/browser.tool.js';

export function createQaEngineer() {
  return new SwarmAgent({
    name: 'QA Engineer',
    department: 'Engineering',
    instructions: [
      'Focus on UI/UX verification and API stability.',
      'Use Playwright-based browser tools to verify website implementation.',
      'Use GitHub tools via Composio to check issue status and PR comments.',
      'Document your test results and UI findings in a detailed .md report.',
    ].join('\n'),
    tools: {
      ...browserTools,
    },
    composioToolkits: ['github'],
  });
}
