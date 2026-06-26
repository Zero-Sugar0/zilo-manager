import { gateway } from 'ai';
import { env, type ImageProvider } from './env.js';

export type ModelRegistry = {
  manager: string;
  help: string;
  post: string;
  chat: string;
  research: string;
  coding: string;
  imageDefaultProvider: ImageProvider;
  imageOpenai: string;
  imageGemini: string;
  image: string;
  screenshotVision: string;

  // Department specific models
  deptStrategy: string;
  deptEngineering: string;
  deptGrowth: string;
  deptOperations: string;
  deptData: string;
  deptSecurity: string;
  deptRevenue: string;
  deptDevelopment: string;
};

const cheapModelCandidates = [
  'openai/gpt-4o-mini',
  'google/gemini-2.0-flash-lite-preview-02-05',
  'xai/grok-2-1212',
  'mistral/mistral-small-latest',
];

function pick(defaultValue: string, envKey: string, fallback?: string) {
  return process.env[envKey] || defaultValue || fallback || cheapModelCandidates[0]!;
}

export const models: ModelRegistry = {
  get manager() { return pick(env.managerModel, 'ZILO_MANAGER_MODEL'); },
  get help() { return pick(env.helpModel || cheapModelCandidates[0]!, 'ZILO_HELP_MODEL'); },
  get post() { return pick(env.postModel || cheapModelCandidates[0]!, 'ZILO_POST_MODEL'); },
  get chat() { return pick(env.helpModel || env.managerModel, 'ZILO_HELP_MODEL', env.managerModel); },
  get research() { return pick(env.managerModel, 'ZILO_MANAGER_MODEL'); },
  get coding() { return pick(env.codingModel || env.managerModel, 'ZILO_CODING_MODEL', env.managerModel); },
  get imageDefaultProvider() { return env.imageDefaultProvider; },
  get imageOpenai() { return pick(env.imageOpenaiModel, 'ZILO_IMAGE_OPENAI_MODEL'); },
  get imageGemini() { return pick(env.imageGeminiModel, 'ZILO_IMAGE_GEMINI_MODEL'); },
  get image() { return env.imageDefaultProvider === 'gemini' ? models.imageGemini : models.imageOpenai; },
  get screenshotVision() { return pick(env.screenshotVisionModel, 'ZILMATE_SCREENSHOT_MODEL'); },

  // Getters for department models with fallbacks
  get deptStrategy() { return pick(process.env.ZILMATE_DEPT_STRATEGY_MODEL || '', 'ZILMATE_DEPT_STRATEGY_MODEL', env.managerModel); },
  get deptEngineering() { return pick(process.env.ZILMATE_DEPT_ENGINEERING_MODEL || '', 'ZILMATE_DEPT_ENGINEERING_MODEL', env.managerModel); },
  get deptGrowth() { return pick(process.env.ZILMATE_DEPT_GROWTH_MODEL || '', 'ZILMATE_DEPT_GROWTH_MODEL', env.managerModel); },
  get deptOperations() { return pick(process.env.ZILMATE_DEPT_OPERATIONS_MODEL || '', 'ZILMATE_DEPT_OPERATIONS_MODEL', env.managerModel); },
  get deptData() { return pick(process.env.ZILMATE_DEPT_DATA_MODEL || '', 'ZILMATE_DEPT_DATA_MODEL', env.managerModel); },
  get deptSecurity() { return pick(process.env.ZILMATE_DEPT_SECURITY_MODEL || '', 'ZILMATE_DEPT_SECURITY_MODEL', env.managerModel); },
  get deptRevenue() { return pick(process.env.ZILMATE_DEPT_REVENUE_MODEL || '', 'ZILMATE_DEPT_REVENUE_MODEL', env.managerModel); },
  get deptDevelopment() { return pick(process.env.ZILMATE_DEPT_DEVELOPMENT_MODEL || '', 'ZILMATE_DEPT_DEVELOPMENT_MODEL', env.codingModel || env.managerModel); },
};

export type ModelAvailability = {
  selected: ModelRegistry;
  availableIds: string[];
  missing: string[];
  warnings: string[];
};

export async function getModelAvailability(): Promise<ModelAvailability> {
  const result = await gateway.getAvailableModels();
  const rawModels = Array.isArray(result) ? result : ((result as { models?: unknown[] }).models || []);
  const availableIds = rawModels
    .map((model) => typeof model === 'string' ? model : (model as { id?: string }).id)
    .filter((id): id is string => Boolean(id));

  // Get current values from the registry
  const selected = [
    models.manager,
    models.help,
    models.post,
    models.chat,
    models.research,
    models.coding,
    models.imageOpenai,
    models.imageGemini,
    models.screenshotVision,
    models.deptStrategy,
    models.deptEngineering,
    models.deptGrowth,
    models.deptOperations,
    models.deptData,
    models.deptSecurity,
    models.deptRevenue,
    models.deptDevelopment,
  ];

  const missing = selected.filter((id, index) => selected.indexOf(id) === index && !availableIds.includes(id));
  const warnings = missing.map((id) => `Configured model not reported by Gateway: ${id}`);

  return { selected: models, availableIds, missing, warnings };
}

export function pickAvailableTextModel(availableIds: string[], preferred?: string) {
  if (preferred && availableIds.includes(preferred)) return preferred;
  return cheapModelCandidates.find((id) => availableIds.includes(id)) || preferred || models.help;
}
