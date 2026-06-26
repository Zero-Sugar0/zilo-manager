import { SwarmAgent } from '../../../runtime/swarm.js';
import { fileSystemTools } from '../../../tools/filesystem.tool.js';
import { shellTools } from '../../../tools/shell.tool.js';
import { codeIntelligenceTools } from '../../../tools/code-intelligence.tool.js';
import { skillTools } from '../../../tools/skills.tool.js';

export function createLeadDeveloper() {
  return new SwarmAgent({
    name: 'Lead Developer',
    department: 'Development',
    instructions: [
      'You are the Orchestrator of the Development department, responsible for end-to-end software delivery.',
      'OPERATING PROCEDURES:',
      '1. Break down complex application requirements into technical tasks for specialized sub-agents.',
      '2. Ensure cross-departmental coordination (e.g., Database vs Frontend).',
      '3. Review final integrated codebases for completeness and performance.',
      '4. Manage the development lifecycle from scaffolding to deployment readiness.',
      '5. Use searchSkills/readSkill to align with project conventions and framework best practices.',
      'KPIs: Project delivery time, system stability, and feature completeness.',
    ].join('\n'),
    tools: { ...fileSystemTools, ...shellTools, ...codeIntelligenceTools, ...skillTools },
    composioToolkits: ['github', 'vercel', 'render', 'netlify', 'supabase'],
  });
}
