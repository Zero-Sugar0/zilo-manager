import { SwarmAgent, type SwarmAgentConfig, type SwarmDepartment } from '../../runtime/swarm.js';
import { browserTools } from '../../tools/browser.tool.js';
import { financeTools } from '../../tools/finance.tool.js';
import { webIntelligenceTools } from '../../tools/web-intelligence.tool.js';
import { fileSystemTools } from '../../tools/filesystem.tool.js';
import { shellTools } from '../../tools/shell.tool.js';
import { gitTools } from '../../tools/git.tool.js';
import { postGenerateTool } from '../../tools/post-generate.tool.js';

const specialistRegistry: Record<string, SwarmAgentConfig> = {
  // Strategy
  productManager: {
    name: 'Product Manager',
    department: 'Strategy',
    instructions: 'Manage roadmaps, break goals into tasks, and oversee feature specs using Linear/Jira via Composio.',
    tools: { ...webIntelligenceTools },
    composioToolkits: ['linear', 'github', 'notion'],
  },
  marketAnalyst: {
    name: 'Market Analyst',
    department: 'Strategy',
    instructions: 'Research competitors, analyze pricing, and monitor market sentiment using Firecrawl and Web Search.',
    tools: { ...webIntelligenceTools },
    composioToolkits: ['firecrawl', 'tavily', 'crunchbase'],
  },
  uxResearcher: {
    name: 'UX Researcher',
    department: 'Strategy',
    instructions: 'Analyze user feedback and UI screenshots to suggest experience improvements.',
    tools: { ...browserTools },
    composioToolkits: ['github', 'figma'],
  },

  // Engineering
  architect: {
    name: 'Architect',
    department: 'Engineering',
    instructions: 'Design technical schemas, system architecture, and implementation plans.',
    tools: { ...fileSystemTools },
    composioToolkits: ['github', 'notion'],
  },
  fullStackCoder: {
    name: 'Full-Stack Coder',
    department: 'Engineering',
    instructions: 'Implement code changes, fix bugs, and manage the repository using Git and Shell tools.',
    tools: { ...fileSystemTools, ...shellTools, ...gitTools },
    composioToolkits: ['github'],
  },
  qaEngineer: {
    name: 'QA Engineer',
    department: 'Engineering',
    instructions: 'Verify UI/UX integrity and API stability using Playwright and automated tests.',
    tools: { ...browserTools },
    composioToolkits: ['github'],
  },
  devopsSre: {
    name: 'DevOps SRE',
    department: 'Engineering',
    instructions: 'Manage CI/CD, monitor logs, and ensure system uptime using cloud toolkits.',
    tools: { ...shellTools },
    composioToolkits: ['github', 'sentry', 'datadog'],
  },

  // Growth
  growthHacker: {
    name: 'Growth Hacker',
    department: 'Growth',
    instructions: 'Run A/B tests and analyze conversion funnels using analytics data.',
    tools: { ...browserTools },
    composioToolkits: ['google_analytics', 'github', 'firecrawl'],
  },
  seoExpert: {
    name: 'SEO Expert',
    department: 'Growth',
    instructions: 'Audit site health, perform keyword research, and optimize search visibility.',
    tools: { ...webIntelligenceTools },
    composioToolkits: ['google_search_console', 'firecrawl'],
  },
  contentWriter: {
    name: 'Content Writer',
    department: 'Growth',
    instructions: 'Draft high-quality blog posts, newsletters, and social copy.',
    tools: { postGenerateTool },
    composioToolkits: ['wordpress', 'ghost', 'medium'],
  },
  socialMediaManager: {
    name: 'Social Media Manager',
    department: 'Growth',
    instructions: 'Manage community engagement and content distribution across social platforms.',
    tools: { postGenerateTool },
    composioToolkits: ['twitter', 'linkedin', 'discord', 'reddit'],
  },
  adsManager: {
    name: 'Ads Manager',
    department: 'Growth',
    instructions: 'Optimize paid campaign spend and performance across advertising platforms.',
    tools: { ...webIntelligenceTools },
    composioToolkits: ['google_ads', 'meta_ads'],
  },
  salesOps: {
    name: 'Sales Ops',
    department: 'Growth',
    instructions: 'Manage lead pipelines, scoring, and outbound sequences in CRM.',
    tools: { ...webIntelligenceTools },
    composioToolkits: ['hubspot', 'salesforce', 'apollo'],
  },

  // Operations
  financeAnalyst: {
    name: 'Finance Analyst',
    department: 'Operations',
    instructions: 'Monitor revenue, manage payouts, and generate P&L reports.',
    tools: { ...financeTools },
    composioToolkits: ['stripe', 'finance', 'quickbooks'],
  },
  customerSuccess: {
    name: 'Customer Success',
    department: 'Operations',
    instructions: 'Resolve user tickets and manage feedback loops using internal documentation.',
    tools: { ...webIntelligenceTools },
    composioToolkits: ['zendesk', 'intercom', 'slack'],
  },
  legalCounsel: {
    name: 'Legal Counsel',
    department: 'Operations',
    instructions: 'Review contracts and ensure compliance with GDPR, SOC2, and business policies.',
    tools: { ...webIntelligenceTools },
    composioToolkits: ['docusign', 'github'],
  },
  logisticsLead: {
    name: 'Logistics Lead',
    department: 'Operations',
    instructions: 'Coordinate supply chain, inventory, and fulfillment.',
    tools: { ...webIntelligenceTools },
    composioToolkits: ['shopify', 'ups', 'fedex'],
  },
  hrRecruiter: {
    name: 'HR Recruiter',
    department: 'Operations',
    instructions: 'Source talent and manage people operations.',
    tools: { ...webIntelligenceTools },
    composioToolkits: ['greenhouse', 'linkedin'],
  },

  // Data
  dataScientist: {
    name: 'Data Scientist',
    department: 'Data',
    instructions: 'Build SQL reports and predictive models for business forecasting.',
    tools: { ...shellTools },
    composioToolkits: ['snowflake', 'bigquery', 'postgresql'],
  },
  biReporter: {
    name: 'BI Reporter',
    department: 'Data',
    instructions: 'Synthesize data into professional summaries and slide decks.',
    tools: { ...webIntelligenceTools },
    composioToolkits: ['github', 'notion'],
  },
};

export function createSwarmSpecialist(key: string) {
  const config = specialistRegistry[key];
  if (!config) {
    // Return a default operator if key not found
    return new SwarmAgent({
      name: 'Business Operator',
      department: 'Operations',
      instructions: 'Handle general business operational tasks using available tools.',
      tools: { ...webIntelligenceTools, ...financeTools },
    });
  }
  return new SwarmAgent(config);
}

export function listSpecialists() {
  return Object.keys(specialistRegistry);
}
