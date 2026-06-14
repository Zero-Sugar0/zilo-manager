import { randomUUID } from 'node:crypto';
import { readJson, writeJson } from '../memory/local-store.js';
import { getRedis } from '../memory/redis.js';
import type { TriggerRoute } from './trigger-orchestrator.js';

const policyKey = 'zilo-manager:trigger-policies:v1';
const policyFile = 'trigger-policies.json';

export type RoutePolicy = {
  route: TriggerRoute;
  autoApprovePrimary: boolean;
  autoApproveFollowUps: boolean;
  notifyOnly: boolean;
};

export type TriggerRoutingPolicy = {
  id: string;
  name: string;
  enabled: boolean;
  vipSenders: string[];
  urgentKeywords: string[];
  lowPriorityKeywords: string[];
  customInstructions: string;
  routes: Partial<Record<TriggerRoute, RoutePolicy>>;
  createdAt: string;
  updatedAt: string;
};

function defaultRoutePolicy(route: TriggerRoute): RoutePolicy {
  return {
    route,
    autoApprovePrimary: true,
    autoApproveFollowUps: false,
    notifyOnly: route === 'batch_summary' || route === 'monitor_only',
  };
}

export function defaultTriggerPolicy(): TriggerRoutingPolicy {
  const now = new Date().toISOString();
  return {
    id: randomUUID().slice(0, 8),
    name: 'Default routing',
    enabled: true,
    vipSenders: [],
    urgentKeywords: ['urgent', 'asap', 'deadline', 'blocked', 'outage'],
    lowPriorityKeywords: ['newsletter', 'unsubscribe', 'promotion', 'digest'],
    customInstructions: '',
    routes: {
      immediate: defaultRoutePolicy('immediate'),
      draft_reply: defaultRoutePolicy('draft_reply'),
      batch_summary: { ...defaultRoutePolicy('batch_summary'), autoApprovePrimary: true, autoApproveFollowUps: true },
      holding: defaultRoutePolicy('holding'),
      monitor_only: { ...defaultRoutePolicy('monitor_only'), autoApproveFollowUps: true },
    },
    createdAt: now,
    updatedAt: now,
  };
}

export async function listTriggerPolicies(): Promise<TriggerRoutingPolicy[]> {
  const redis = getRedis();
  if (redis) return (await redis.get<TriggerRoutingPolicy[]>(policyKey)) ?? [];
  return readJson<TriggerRoutingPolicy[]>(policyFile, []);
}

async function savePolicies(policies: TriggerRoutingPolicy[]) {
  const redis = getRedis();
  if (redis) {
    await redis.set(policyKey, policies);
    return;
  }
  await writeJson(policyFile, policies);
}

export async function getActiveTriggerPolicy(): Promise<TriggerRoutingPolicy> {
  const policies = await listTriggerPolicies();
  return policies.find((p) => p.enabled) ?? defaultTriggerPolicy();
}

export async function saveTriggerPolicy(policy: TriggerRoutingPolicy) {
  const policies = await listTriggerPolicies();
  const now = new Date().toISOString();
  const next = { ...policy, updatedAt: now };
  const index = policies.findIndex((p) => p.id === policy.id);
  if (index >= 0) policies[index] = next;
  else policies.push({ ...next, createdAt: now });
  await savePolicies(policies);
  return next;
}

export function routePolicyFor(policy: TriggerRoutingPolicy, route: TriggerRoute): RoutePolicy {
  return policy.routes[route] ?? defaultRoutePolicy(route);
}
