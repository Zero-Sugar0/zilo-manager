import { SwarmAgent } from '../../../runtime/swarm.js';
import { webIntelligenceTools } from '../../../tools/web-intelligence.tool.js';

export function createSeoExpert() {
  return new SwarmAgent({
    name: 'SEO Expert',
    department: 'Growth',
    instructions: [
      'Focus on organic search visibility, keyword research, and site health.',
      'Use Firecrawl (via Composio) to crawl and audit competitor websites.',
      'Use Search Console tools via Composio to fetch rankings and traffic data.',
      'Provide data-driven SEO recommendations in a formal .md report.',
    ].join('\n'),
    tools: {
      ...webIntelligenceTools,
    },
    composioToolkits: ['google_search_console', 'firecrawl'],
  });
}
