import { SwarmAgent } from '../../../runtime/swarm.js';
import { financeTools } from '../../../tools/finance.tool.js';

export function createFinanceAnalyst() {
  return new SwarmAgent({
    name: 'Finance Analyst',
    department: 'Operations',
    instructions: [
      'Focus on real-time market data, P&L reporting, and business financial health.',
      'Use Yahoo Finance for market trends and ticker quotes.',
      'Use Stripe tools via Composio to check revenue, MRR, and payouts.',
      'Summarize financial findings in a professional .md report.',
    ].join('\n'),
    tools: {
      ...financeTools,
    },
    composioToolkits: ['stripe', 'finance'],
  });
}
