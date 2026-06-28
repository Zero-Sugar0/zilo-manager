import { AsyncLocalStorage } from 'node:async_hooks';
import { appendFile, readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { exec } from 'node:child_process';
import { workspaceLayout } from '../workspace/paths.js';
import { theme, getDeptTheme, termWidth } from '../cli/theme.js';
import chalk from 'chalk';

export interface SwarmEvent {
  id: string;
  type: 'wiki_query' | 'wiki_publish' | 'tool_call' | 'collaboration';
  label: string;
  detail: string;
  timestamp: number;
}

export interface SwarmSpan {
  id: string;
  parentId?: string | undefined;
  sessionId: string;
  agentKey: string;
  agentName: string;
  department: string;
  task: string;
  status: 'running' | 'completed' | 'failed';
  startedAt: number;
  endedAt?: number;
  durationMs?: number;
  events: SwarmEvent[];
  error?: string;
}

export class SwarmTraceTracker {
  private static instance: SwarmTraceTracker;
  private storage = new AsyncLocalStorage<string>();
  private activeSpans = new Map<string, SwarmSpan>();

  private constructor() {}

  static getInstance(): SwarmTraceTracker {
    if (!SwarmTraceTracker.instance) {
      SwarmTraceTracker.instance = new SwarmTraceTracker();
    }
    return SwarmTraceTracker.instance;
  }

  getActiveSpanId(): string | undefined {
    return this.storage.getStore();
  }

  async startSpan(config: {
    sessionId: string;
    agentKey: string;
    agentName: string;
    department: string;
    task: string;
  }): Promise<SwarmSpan> {
    const spanId = crypto.randomUUID();
    const parentId = this.storage.getStore();
    const span: SwarmSpan = {
      id: spanId,
      ...(parentId !== undefined ? { parentId } : {}),
      sessionId: config.sessionId,
      agentKey: config.agentKey,
      agentName: config.agentName,
      department: config.department,
      task: config.task,
      status: 'running',
      startedAt: Date.now(),
      events: [],
    };

    this.activeSpans.set(spanId, span);
    await this.writeLogLine(span);
    return span;
  }

  async runWithSpan<T>(span: SwarmSpan, callback: () => Promise<T>): Promise<T> {
    return this.storage.run(span.id, async () => {
      try {
        const result = await callback();
        await this.endSpan(span.id, 'completed');
        return result;
      } catch (error: any) {
        await this.endSpan(span.id, 'failed', error?.message || String(error));
        throw error;
      }
    });
  }

  async endSpan(id: string, status: 'completed' | 'failed', error?: string) {
    const span = this.activeSpans.get(id);
    if (span) {
      span.status = status;
      span.endedAt = Date.now();
      span.durationMs = span.endedAt - span.startedAt;
      if (error) {
        span.error = error;
      }
      await this.writeLogLine(span);
      this.activeSpans.delete(id);
    }
  }

  async recordEvent(type: SwarmEvent['type'], label: string, detail: string) {
    const activeId = this.storage.getStore();
    if (activeId) {
      const span = this.activeSpans.get(activeId);
      if (span) {
        const event: SwarmEvent = {
          id: crypto.randomUUID(),
          type,
          label,
          detail,
          timestamp: Date.now(),
        };
        span.events.push(event);
        await this.writeLogLine(span);
      }
    }
  }

  private async writeLogLine(span: SwarmSpan) {
    try {
      const logsDir = workspaceLayout().logs;
      await mkdir(logsDir, { recursive: true });
      const file = path.join(logsDir, 'swarm-traces.jsonl');
      // Clone span to avoid any race conditions during async serialization
      const clone = { ...span, events: [...span.events] };
      await appendFile(file, JSON.stringify(clone) + '\n', 'utf8');
    } catch (err) {
      // Don't crash the run if trace logging fails
    }
  }
}

export async function loadSessionSpans(sessionId: string): Promise<SwarmSpan[]> {
  const file = path.join(workspaceLayout().logs, 'swarm-traces.jsonl');
  const spansMap = new Map<string, SwarmSpan>();
  try {
    const content = await readFile(file, 'utf8');
    const lines = content.split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const span = JSON.parse(line) as SwarmSpan;
        if (span.sessionId === sessionId) {
          spansMap.set(span.id, span);
        }
      } catch {
        // Skip corrupted lines
      }
    }
  } catch {
    // Return empty if file doesn't exist
  }
  return Array.from(spansMap.values());
}

export function renderTraceTree(spans: SwarmSpan[]): string {
  const idToSpan = new Map<string, SwarmSpan>();
  for (const span of spans) {
    idToSpan.set(span.id, span);
  }

  const parentToChildren = new Map<string, SwarmSpan[]>();
  const roots: SwarmSpan[] = [];

  for (const span of spans) {
    if (span.parentId && idToSpan.has(span.parentId)) {
      if (!parentToChildren.has(span.parentId)) {
        parentToChildren.set(span.parentId, []);
      }
      parentToChildren.get(span.parentId)!.push(span);
    } else {
      roots.push(span);
    }
  }

  // Sort children and roots by start time to maintain chronological order
  roots.sort((a, b) => a.startedAt - b.startedAt);
  for (const children of parentToChildren.values()) {
    children.sort((a, b) => a.startedAt - b.startedAt);
  }

  const lines: string[] = [];
  const width = termWidth(120);

  function renderSpanNode(span: SwarmSpan, prefix: string, isLast: boolean) {
    const deptTheme = getDeptTheme(span.department);
    const color = deptTheme.color;
    const icon = deptTheme.icon;

    const branch = isLast ? '└── ' : '├── ';
    const duration = span.durationMs !== undefined ? ` (${span.durationMs}ms)` : '';
    const statusStr = span.status === 'failed' ? ' [FAILED]' : span.status === 'running' ? ' [RUNNING]' : '';
    const errStr = span.error ? ` - Error: ${span.error}` : '';

    // Calculate maximum available width for text content before ANSI colors
    const visualPrefix = prefix.length + branch.length;
    const rightPart = `${statusStr}${duration}${errStr}`;
    const availableForLabel = width - visualPrefix - rightPart.length - 2; // safety padding

    let labelText = `${icon} ${span.agentName} (${span.department})`;
    if (labelText.length > availableForLabel) {
      labelText = labelText.substring(0, Math.max(10, availableForLabel - 3)) + '...';
    }

    const coloredLabel = color(labelText);
    const coloredStatus = span.status === 'failed' 
      ? chalk.red(statusStr) 
      : span.status === 'running' 
        ? theme.thinking(statusStr) 
        : '';
    const coloredError = span.error ? chalk.red(errStr) : '';

    const headerLine = `${prefix}${branch}${coloredLabel}${coloredStatus}${duration}${coloredError}`;
    lines.push(headerLine);

    // Render task text
    const padding = prefix + (isLast ? '    ' : '│   ');
    const availableForTask = width - padding.length - 6; // "Task: ".length is 5
    let taskText = span.task;
    if (taskText.length > availableForTask) {
      taskText = taskText.substring(0, Math.max(10, availableForTask - 3)) + '...';
    }
    const taskLine = `${padding}${chalk.gray('Task:')} ${taskText}`;
    lines.push(taskLine);

    // Render events
    const nextPrefix = prefix + (isLast ? '    ' : '│   ');
    const totalEvents = span.events.length;
    span.events.forEach((event) => {
      let eventIcon = '⚙️';
      if (event.type === 'wiki_query') eventIcon = '🔍';
      if (event.type === 'wiki_publish') eventIcon = '📤';
      if (event.type === 'tool_call') eventIcon = '⚙️';
      if (event.type === 'collaboration') eventIcon = '🤝';

      const labelPart = `✦ [${event.label}] `;
      const availableForDetail = width - nextPrefix.length - labelPart.length - 4; // eventIcon + spaces
      let detailText = event.detail;
      if (detailText.length > availableForDetail) {
        detailText = detailText.substring(0, Math.max(10, availableForDetail - 3)) + '...';
      }

      const eventLine = `${nextPrefix}${chalk.dim(`✦ [${event.label}]`)} ${eventIcon} ${chalk.gray(detailText)}`;
      lines.push(eventLine);
    });

    // Render children
    const children = parentToChildren.get(span.id) || [];
    const totalChildren = children.length;
    children.forEach((child, idx) => {
      const isLastChild = idx === totalChildren - 1;
      renderSpanNode(child, nextPrefix, isLastChild);
    });
  }

  // Draw roots
  roots.forEach((root, idx) => {
    const isLast = idx === roots.length - 1;
    renderSpanNode(root, '', isLast);
  });

  return lines.join('\n');
}

export function filterSpans(
  spans: SwarmSpan[],
  filters: { dept?: string; agent?: string; status?: string }
): SwarmSpan[] {
  if (!filters.dept && !filters.agent && !filters.status) {
    return spans;
  }

  const matchedIds = new Set<string>();

  for (const span of spans) {
    let matches = true;
    if (filters.dept && span.department.toLowerCase() !== filters.dept.toLowerCase()) {
      matches = false;
    }
    if (filters.agent && span.agentKey.toLowerCase() !== filters.agent.toLowerCase()) {
      matches = false;
    }
    if (filters.status && span.status.toLowerCase() !== filters.status.toLowerCase()) {
      matches = false;
    }

    if (matches) {
      matchedIds.add(span.id);
      // Retain ancestors to keep tree connectivity
      let curr = span;
      while (curr.parentId) {
        const parent = spans.find((s) => s.id === curr.parentId);
        if (parent) {
          matchedIds.add(parent.id);
          curr = parent;
        } else {
          break;
        }
      }
    }
  }

  return spans.filter((s) => matchedIds.has(s.id));
}

export interface DeptStats {
  dept: string;
  spans: number;
  durationMs: number;
  tools: number;
  collabs: number;
  wikiQueries: number;
  wikiPublishes: number;
}

export interface SessionStats {
  sessionId: string;
  totalSpans: number;
  totalDurationMs: number;
  totalTools: number;
  totalCollabs: number;
  totalWikiQueries: number;
  totalWikiPublishes: number;
  depts: DeptStats[];
}

export function computeSessionStats(spans: SwarmSpan[], sessionId: string): SessionStats {
  let minStart = Infinity;
  let maxEnd = -Infinity;

  let totalTools = 0;
  let totalCollabs = 0;
  let totalWikiQueries = 0;
  let totalWikiPublishes = 0;

  const deptMap = new Map<string, DeptStats>();

  for (const span of spans) {
    if (span.startedAt < minStart) minStart = span.startedAt;
    const end = span.endedAt || span.startedAt;
    if (end > maxEnd) maxEnd = end;

    let tools = 0;
    let collabs = 0;
    let queries = 0;
    let publishes = 0;

    for (const ev of span.events) {
      if (ev.type === 'tool_call') {
        tools++;
        totalTools++;
      } else if (ev.type === 'collaboration') {
        collabs++;
        totalCollabs++;
      } else if (ev.type === 'wiki_query') {
        queries++;
        totalWikiQueries++;
      } else if (ev.type === 'wiki_publish') {
        publishes++;
        totalWikiPublishes++;
      }
    }

    const dept = span.department;
    const dur = span.durationMs || (span.endedAt ? span.endedAt - span.startedAt : 0);

    if (!deptMap.has(dept)) {
      deptMap.set(dept, {
        dept,
        spans: 0,
        durationMs: 0,
        tools: 0,
        collabs: 0,
        wikiQueries: 0,
        wikiPublishes: 0,
      });
    }

    const d = deptMap.get(dept)!;
    d.spans++;
    d.durationMs += dur;
    d.tools += tools;
    d.collabs += collabs;
    d.wikiQueries += queries;
    d.wikiPublishes += publishes;
  }

  const depts = Array.from(deptMap.values()).sort((a, b) => b.durationMs - a.durationMs);
  const totalDurationMs = minStart !== Infinity && maxEnd !== -Infinity ? (maxEnd - minStart) : 0;

  return {
    sessionId,
    totalSpans: spans.length,
    totalDurationMs,
    totalTools,
    totalCollabs,
    totalWikiQueries,
    totalWikiPublishes,
    depts,
  };
}

export function printStatsTable(stats: SessionStats) {
  console.log('\n' + chalk.cyan.bold(' 🌌 ZILMATE SWARM SESSION PERFORMANCE PROFILER ') + chalk.gray(`[Session: ${stats.sessionId}]`));
  console.log(chalk.gray('─'.repeat(90)));
  
  // Header row
  console.log(
    chalk.bold('Department').padEnd(20) + ' │ ' +
    chalk.bold('Spans').padEnd(8) + ' │ ' +
    chalk.bold('Duration').padEnd(12) + ' │ ' +
    chalk.bold('Tools').padEnd(8) + ' │ ' +
    chalk.bold('Collabs').padEnd(10) + ' │ ' +
    chalk.bold('Wiki Q/P').padEnd(10)
  );
  console.log(chalk.gray('─'.repeat(90)));
  
  for (const dept of stats.depts) {
    const deptTheme = getDeptTheme(dept.dept);
    const deptColor = deptTheme.color;
    const deptIcon = deptTheme.icon;
    const deptLabel = `${deptIcon} ${dept.dept}`;
    
    console.log(
      deptColor(deptLabel.padEnd(20)) + ' │ ' +
      chalk.white(String(dept.spans).padEnd(8)) + ' │ ' +
      chalk.yellow(`${dept.durationMs}ms`.padEnd(12)) + ' │ ' +
      chalk.white(String(dept.tools).padEnd(8)) + ' │ ' +
      chalk.white(String(dept.collabs).padEnd(10)) + ' │ ' +
      chalk.white(`${dept.wikiQueries}/${dept.wikiPublishes}`.padEnd(10))
    );
  }
  
  console.log(chalk.gray('─'.repeat(90)));
  
  // Totals row
  console.log(
    chalk.bold('TOTAL').padEnd(20) + ' │ ' +
    chalk.bold(String(stats.totalSpans).padEnd(8)) + ' │ ' +
    chalk.bold.yellow(`${stats.totalDurationMs}ms`.padEnd(12)) + ' │ ' +
    chalk.bold(String(stats.totalTools).padEnd(8)) + ' │ ' +
    chalk.bold(String(stats.totalCollabs).padEnd(10)) + ' │ ' +
    chalk.bold(`${stats.totalWikiQueries}/${stats.totalWikiPublishes}`.padEnd(10))
  );
  console.log(chalk.gray('─'.repeat(90)) + '\n');
}


export function openBrowser(urlOrPath: string) {
  try {
    const cmd = process.platform === 'win32'
      ? 'start'
      : process.platform === 'darwin'
        ? 'open'
        : 'xdg-open';
    exec(`${cmd} "${urlOrPath}"`);
  } catch (err) {
    // Fail silently
  }
}

export function generateHtmlDashboard(spans: SwarmSpan[], sessionId: string): string {
  const stats = computeSessionStats(spans, sessionId);
  const nowStr = new Date().toLocaleString();
  
  const totalFailures = spans.filter(s => s.status === 'failed').length;
  const integrityScore = spans.length > 0 ? Math.round(((spans.length - totalFailures) / spans.length) * 100) : 100;
  const integrityColor = integrityScore < 100 ? 'text-rose-400' : 'text-pink-400';
  
  // Custom HSL glows and SVG icons for each department (lowercase keys for case-insensitive lookup)
  const deptConfigs: Record<string, { color: string, border: string, glow: string, bg: string, text: string, icon: string }> = {
    strategy:    { color: '#0ea5e9', border: 'border-sky-500/20', glow: 'shadow-[0_0_15px_rgba(14,165,233,0.15)]', bg: 'bg-sky-500/10', text: 'text-sky-400', icon: '🎯' },
    engineering: { color: '#f43f5e', border: 'border-rose-500/20', glow: 'shadow-[0_0_15px_rgba(244,63,94,0.15)]', bg: 'bg-rose-500/10', text: 'text-rose-400', icon: '🛠️' },
    development: { color: '#06b6d4', border: 'border-cyan-500/20', glow: 'shadow-[0_0_15px_rgba(6,182,212,0.15)]', bg: 'bg-cyan-500/10', text: 'text-cyan-400', icon: '💻' },
    growth:      { color: '#10b981', border: 'border-emerald-500/20', glow: 'shadow-[0_0_15px_rgba(16,185,129,0.15)]', bg: 'bg-emerald-500/10', text: 'text-emerald-400', icon: '📈' },
    operations:  { color: '#f59e0b', border: 'border-amber-500/20', glow: 'shadow-[0_0_15px_rgba(245,158,11,0.15)]', bg: 'bg-amber-500/10', text: 'text-amber-400', icon: '⚙️' },
    data:        { color: '#8b5cf6', border: 'border-violet-500/20', glow: 'shadow-[0_0_15px_rgba(139,92,246,0.15)]', bg: 'bg-violet-500/10', text: 'text-violet-400', icon: '📊' },
    security:    { color: '#14b8a6', border: 'border-teal-500/20', glow: 'shadow-[0_0_15px_rgba(20,184,166,0.15)]', bg: 'bg-teal-500/10', text: 'text-teal-400', icon: '🛡️' },
    revenue:     { color: '#ec4899', border: 'border-pink-500/20', glow: 'shadow-[0_0_15px_rgba(236,72,153,0.15)]', bg: 'bg-pink-500/10', text: 'text-pink-400', icon: '💰' },
    general:     { color: '#94a3b8', border: 'border-slate-500/20', glow: 'shadow-[0_0_15px_rgba(148,163,184,0.15)]', bg: 'bg-slate-500/10', text: 'text-slate-400', icon: '🌐' }
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>🌌 ZilMate Swarm Intelligence Dashboard [Session: ${sessionId}]</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <script>
    tailwind.config = {
      theme: {
        extend: {
          fontFamily: {
            sans: ['"Plus Jakarta Sans"', 'Inter', 'sans-serif'],
            mono: ['"JetBrains Mono"', 'monospace']
          }
        }
      }
    }
  </script>
  <style>
    body {
      background: radial-gradient(circle at 50% 0%, #0c0f24 0%, #030712 100%);
      color: #f1f5f9;
    }
    .glass {
      background: rgba(15, 23, 42, 0.45);
      backdrop-filter: blur(12px);
      border: 1px solid rgba(255, 255, 255, 0.05);
    }
    .glass-input {
      background: rgba(15, 23, 42, 0.6);
      border: 1px solid rgba(255, 255, 255, 0.08);
    }
    .glass-input:focus {
      outline: none;
      border-color: rgba(99, 102, 241, 0.4);
      box-shadow: 0 0 15px rgba(99, 102, 241, 0.15);
    }
    .glow-indigo {
      box-shadow: 0 0 25px rgba(99, 102, 241, 0.15);
    }
    /* Scrollbars */
    ::-webkit-scrollbar {
      width: 6px;
      height: 6px;
    }
    ::-webkit-scrollbar-track {
      background: rgba(2, 6, 23, 0.3);
    }
    ::-webkit-scrollbar-thumb {
      background: rgba(255, 255, 255, 0.1);
      border-radius: 4px;
    }
    ::-webkit-scrollbar-thumb:hover {
      background: rgba(255, 255, 255, 0.2);
    }
    .timeline-bar {
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    }
    .timeline-bar:hover {
      filter: brightness(1.2) contrast(1.1);
    }
  </style>
</head>
<body class="min-h-screen flex flex-col font-sans">
  <!-- Top Navigation -->
  <header class="glass border-b border-white/5 px-6 py-4 flex items-center justify-between z-10">
    <div class="flex items-center space-x-3">
      <span class="text-2xl">🌌</span>
      <div>
        <h1 class="text-lg font-bold bg-gradient-to-r from-cyan-400 via-indigo-400 to-pink-400 bg-clip-text text-transparent">
          ZilMate Swarm Intelligence Terminal
        </h1>
        <p class="text-xs text-slate-400 font-mono">Session Protocol: <span class="text-indigo-400">${sessionId}</span></p>
      </div>
    </div>
    <div class="flex items-center space-x-4">
      <div class="text-right">
        <p class="text-xs text-slate-400 font-mono">Rendered: ${nowStr}</p>
        <p class="text-xs text-emerald-400 flex items-center justify-end font-mono">
          <span class="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-pulse mr-1.5"></span>
          Decentralized Runtime OK
        </p>
      </div>
    </div>
  </header>

  <!-- Metrics Bar (Interactive KPI Filters) -->
  <div class="grid grid-cols-2 md:grid-cols-5 gap-4 px-6 pt-5 pb-1 z-10 shrink-0">
    <!-- Card 1 (Duration - Read-only) -->
    <div class="glass rounded-xl p-4 flex flex-col justify-between glow-indigo border-white/5 transition-all">
      <span class="text-xs text-slate-400 font-semibold tracking-wider uppercase">Session Duration</span>
      <span class="text-2xl font-bold font-mono text-amber-400 mt-2">${(stats.totalDurationMs / 1000).toFixed(2)}s</span>
    </div>
    <!-- Card 2 (Active Specialists - Reset Filter) -->
    <div id="metric-all" onclick="filterByMetric(null)" class="glass rounded-xl p-4 flex flex-col justify-between glow-indigo cursor-pointer border-indigo-500/80 bg-indigo-950/20 shadow-[0_0_20px_rgba(99,102,241,0.25)] transition-all hover:bg-white/5">
      <span class="text-xs text-slate-400 font-semibold tracking-wider uppercase flex justify-between items-center">
        <span>Active Specialists</span>
        <span class="text-[9px] text-slate-500 font-mono uppercase tracking-normal">All Spans</span>
      </span>
      <span class="text-2xl font-bold font-mono text-cyan-400 mt-2">${stats.totalSpans}</span>
    </div>
    <!-- Card 3 (Joint War Rooms - Collab Filter) -->
    <div id="metric-collab" onclick="filterByMetric('collab')" class="glass rounded-xl p-4 flex flex-col justify-between glow-indigo cursor-pointer border-white/5 transition-all hover:bg-white/5">
      <span class="text-xs text-slate-400 font-semibold tracking-wider uppercase flex justify-between items-center">
        <span>P2P Joint War Rooms</span>
        <span class="text-[9px] text-slate-500 font-mono uppercase tracking-normal">Filter Collab</span>
      </span>
      <span class="text-2xl font-bold font-mono text-violet-400 mt-2">${stats.totalCollabs}</span>
    </div>
    <!-- Card 4 (Wiki Actions - Wiki Filter) -->
    <div id="metric-wiki" onclick="filterByMetric('wiki')" class="glass rounded-xl p-4 flex flex-col justify-between glow-indigo cursor-pointer border-white/5 transition-all hover:bg-white/5">
      <span class="text-xs text-slate-400 font-semibold tracking-wider uppercase flex justify-between items-center">
        <span>Wiki Activities</span>
        <span class="text-[9px] text-slate-500 font-mono uppercase tracking-normal">Filter Wiki</span>
      </span>
      <span class="text-2xl font-bold font-mono text-emerald-400 mt-2">${stats.totalWikiQueries} <span class="text-xs text-slate-500">/</span> ${stats.totalWikiPublishes}</span>
    </div>
    <!-- Card 5 (Integrity Score - Failure Filter) -->
    <div id="metric-failed" onclick="filterByMetric('failed')" class="glass rounded-xl p-4 flex flex-col justify-between glow-indigo col-span-2 md:col-span-1 cursor-pointer border-white/5 transition-all hover:bg-white/5">
      <span class="text-xs text-slate-400 font-semibold tracking-wider uppercase flex justify-between items-center">
        <span>System Integrity</span>
        <span class="text-[9px] text-slate-500 font-mono uppercase tracking-normal">Filter Failures</span>
      </span>
      <span class="text-2xl font-bold font-mono ${integrityColor} mt-2">${integrityScore}% <span class="text-xs text-slate-500 font-semibold">(${totalFailures} fail)</span></span>
    </div>
  </div>

  <!-- Primary Tab Switcher -->
  <div class="px-6 mt-4 flex space-x-1 shrink-0">
    <button onclick="switchTab('traces')" id="tab-traces" class="px-4 py-2 text-sm font-semibold rounded-t-lg border-t border-x border-white/10 bg-slate-900/80 text-white transition-all">
      📊 Swarm Execution Traces & Timeline
    </button>
    <button onclick="switchTab('intelligence')" id="tab-intelligence" class="px-4 py-2 text-sm font-semibold rounded-t-lg border border-white/5 text-slate-400 hover:text-white transition-all">
      📚 Corporate Knowledge & Volatile Scratchpad
    </button>
  </div>

  <!-- Main View Area -->
  <main class="flex-grow px-6 pb-6 flex flex-col">
    <!-- TAB 1: TRACES & TIMELINE -->
    <div id="view-traces" class="flex flex-col space-y-4">
      <!-- Chronological Gantt Timeline -->
      <div class="glass rounded-xl p-4 flex flex-col">
        <h3 class="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2 flex items-center">
          🕒 Chronological Execution Waterfall & grid
        </h3>
        <div class="flex-1 pr-1 space-y-1.5" id="gantt-chart-container">
          <!-- Populated by JS -->
        </div>
      </div>

      <!-- Split Tree and Details panel -->
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <!-- Left: Trace Tree Node Directory -->
        <div class="lg:col-span-5 glass rounded-xl p-4 flex flex-col">
          <div class="mb-3 shrink-0 flex items-center space-x-2">
            <input type="text" id="tree-search" oninput="filterTree()" placeholder="Search specialists, tasks, or tools..." class="flex-1 glass-input px-3 py-1.5 rounded-lg text-sm text-slate-200">
            <button onclick="clearSearch()" class="text-xs text-slate-400 hover:text-white font-semibold">Reset</button>
          </div>
          <div class="text-sm" id="tree-container">
            <!-- Populated by JS -->
          </div>
        </div>

        <!-- Right: Telemetry Inspector Card -->
        <div class="lg:col-span-7 glass rounded-xl p-6 flex flex-col glow-indigo">
          <div id="inspector-placeholder" class="flex-grow flex flex-col items-center justify-center text-slate-500 py-12">
            <span class="text-4xl mb-4">🕵️‍♂️</span>
            <p class="font-medium">No specialist span selected</p>
            <p class="text-xs mt-1">Select an agent or execution span from the directory tree to inspect its core telemetry</p>
          </div>
          <div id="inspector-panel" class="hidden flex-col">
            <!-- Header -->
            <div class="border-b border-white/5 pb-4 shrink-0 flex justify-between items-start">
              <div>
                <div class="flex items-center space-x-2">
                  <span id="inspect-dept-badge" class="px-2 py-0.5 rounded text-xs font-mono font-bold bg-white/5"></span>
                  <span id="inspect-status-badge" class="px-2 py-0.5 rounded text-xs font-mono font-bold bg-white/5"></span>
                </div>
                <h2 id="inspect-agent-name" class="text-xl font-bold mt-1.5"></h2>
              </div>
              <div class="text-right font-mono text-sm">
                <p id="inspect-duration" class="text-amber-400 font-bold"></p>
                <p id="inspect-timings" class="text-xs text-slate-500 mt-1"></p>
              </div>
            </div>

            <!-- Scrollable Content -->
            <div class="py-4 space-y-5">
              <!-- Task Section -->
              <div>
                <h4 class="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">🎯 Objective / Task Description</h4>
                <div id="inspect-task" class="p-3 bg-slate-950/60 rounded-lg text-sm text-slate-300 font-mono border border-white/5 whitespace-pre-wrap"></div>
              </div>

              <!-- Events Section -->
              <div>
                <h4 class="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">📋 Intercepted Telemetry Feed</h4>
                <div id="inspect-events" class="space-y-3">
                  <!-- Populated by JS -->
                </div>
              </div>

              <!-- Raw Payload Drawer Section -->
              <div class="border-t border-white/5 pt-4">
                <div class="flex justify-between items-center mb-2">
                  <h4 class="text-xs font-bold uppercase tracking-wider text-slate-400">🕵️‍♂️ Raw Telemetry JSON Payload</h4>
                  <button onclick="copyRawTelemetry()" class="px-2.5 py-1 text-xs font-semibold bg-white/5 text-slate-300 hover:text-white hover:bg-white/10 border border-white/10 rounded transition-all flex items-center space-x-1.5">
                    <span id="copy-btn-text">📋 Copy JSON</span>
                  </button>
                </div>
                <pre id="inspect-raw-json" class="p-3 bg-slate-950/80 rounded-lg text-xs text-indigo-300 font-mono border border-white/5 overflow-x-auto"></pre>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- TAB 2: CORPORATE KNOWLEDGE & SCRATCHPAD -->
    <div id="view-intelligence" class="hidden grid grid-cols-1 md:grid-cols-2 gap-4">
      <!-- Blackboard (Corporate Wiki) facts -->
      <div class="glass rounded-xl p-5 flex flex-col">
        <h3 class="text-sm font-bold uppercase tracking-wider text-slate-400 mb-3 flex items-center">
          📚 Shared Corporate Blackboard (Wiki Activity Logs)
        </h3>
        <div class="space-y-3" id="wiki-logs-container">
          <!-- Populated by JS -->
        </div>
      </div>

      <!-- Shared Multi-Agent Scratchpad variables -->
      <div class="glass rounded-xl p-5 flex flex-col">
        <h3 class="text-sm font-bold uppercase tracking-wider text-slate-400 mb-3 flex items-center">
          💾 Shared Multi-Agent Scratchpad (Active Variable Registry)
        </h3>
        <div class="space-y-3" id="scratchpad-vars-container">
          <!-- Populated by JS -->
        </div>
      </div>
    </div>
  </main>

  <!-- Serialized Data Injected by Compiler -->
  <script>
    const spans = ${JSON.stringify(spans)};
    const deptConfigs = ${JSON.stringify(deptConfigs)};
    let activeSpanId = null;
    let activeMetricFilter = null; // null, 'collab', 'wiki', 'failed'
    const collapsedNodes = new Set();

    // Build hierarchical tree structures
    const idToSpan = new Map();
    for (const span of spans) {
      idToSpan.set(span.id, span);
    }

    const parentToChildren = new Map();
    const roots = [];

    for (const span of spans) {
      if (span.parentId && idToSpan.has(span.parentId)) {
        if (!parentToChildren.has(span.parentId)) {
          parentToChildren.set(span.parentId, []);
        }
        parentToChildren.get(span.parentId).push(span);
      } else {
        roots.push(span);
      }
    }

    roots.sort((a, b) => a.startedAt - b.startedAt);
    for (const children of parentToChildren.values()) {
      children.sort((a, b) => a.startedAt - b.startedAt);
    }

    // Tab switcher
    function switchTab(tab) {
      const isTraces = tab === 'traces';
      document.getElementById('view-traces').classList.toggle('hidden', !isTraces);
      document.getElementById('view-intelligence').classList.toggle('hidden', isTraces);
      
      const tabTraces = document.getElementById('tab-traces');
      const tabIntel = document.getElementById('tab-intelligence');
      
      if (isTraces) {
        tabTraces.className = "px-4 py-2 text-sm font-semibold rounded-t-lg border-t border-x border-white/10 bg-slate-900/80 text-white transition-all";
        tabIntel.className = "px-4 py-2 text-sm font-semibold rounded-t-lg border border-white/5 text-slate-400 hover:text-white transition-all";
      } else {
        tabIntel.className = "px-4 py-2 text-sm font-semibold rounded-t-lg border-t border-x border-white/10 bg-slate-900/80 text-white transition-all";
        tabTraces.className = "px-4 py-2 text-sm font-semibold rounded-t-lg border border-white/5 text-slate-400 hover:text-white transition-all";
        renderIntelLogs();
      }
    }

    // Build chronological timeline waterfall with Ruler and Guides
    function renderGanttTimeline() {
      const container = document.getElementById('gantt-chart-container');
      if (spans.length === 0) {
        container.innerHTML = '<p class="text-xs text-slate-500 py-4">No spans recorded.</p>';
        return;
      }

      let minStart = Infinity;
      let maxEnd = -Infinity;
      for (const s of spans) {
        if (s.startedAt < minStart) minStart = s.startedAt;
        const end = s.endedAt || s.startedAt;
        if (end > maxEnd) maxEnd = end;
      }

      const totalSpan = maxEnd - minStart || 1;
      let html = '';

      // Render the Ruler ticks (0.00s to totals)
      html += \`
        <div class="flex items-center space-x-3 text-xs mb-2 border-b border-white/5 pb-1 shrink-0 relative">
          <span class="w-40 shrink-0 text-slate-400 font-semibold uppercase tracking-wider text-[10px] font-mono">Specialist Timeline</span>
          <div class="flex-grow relative h-4 flex justify-between text-[10px] text-slate-500 font-mono">
            <span class="absolute left-0">0.00s</span>
            <span class="absolute" style="left: 25%; transform: translateX(-50%);">\${(totalSpan * 0.25 / 1000).toFixed(2)}s</span>
            <span class="absolute" style="left: 50%; transform: translateX(-50%);">\${(totalSpan * 0.50 / 1000).toFixed(2)}s</span>
            <span class="absolute" style="left: 75%; transform: translateX(-50%);">\${(totalSpan * 0.75 / 1000).toFixed(2)}s</span>
            <span class="absolute right-0">\${(totalSpan / 1000).toFixed(2)}s</span>
          </div>
        </div>
      \`;

      for (const s of spans) {
        const config = deptConfigs[s.department.toLowerCase()] || deptConfigs.general;
        const offsetPct = ((s.startedAt - minStart) / totalSpan * 100).toFixed(2);
        const dur = s.durationMs || ((s.endedAt || s.startedAt) - s.startedAt);
        const widthPct = Math.max(0.8, (dur / totalSpan * 100)).toFixed(2);
        
        const pulseAnim = s.status === 'running' ? 'animate-pulse' : '';

        html += \`
          <div class="flex items-center space-x-3 text-xs relative">
            <span class="w-40 truncate text-slate-300 font-mono flex items-center space-x-1 shrink-0">
              <span>\${config.icon}</span>
              <span class="font-bold cursor-pointer hover:text-white" onclick="selectSpan('\${s.id}')">\${s.agentName}</span>
            </span>
            <div class="flex-grow bg-white/5 h-4.5 rounded-lg overflow-hidden relative">
              <!-- Grid guides -->
              <div class="absolute inset-y-0 border-l border-dashed border-white/[0.04] pointer-events-none" style="left: 25%;"></div>
              <div class="absolute inset-y-0 border-l border-dashed border-white/[0.04] pointer-events-none" style="left: 50%;"></div>
              <div class="absolute inset-y-0 border-l border-dashed border-white/[0.04] pointer-events-none" style="left: 75%;"></div>

              <!-- Bar -->
              <div onclick="selectSpan('\${s.id}')" class="timeline-bar absolute h-full rounded \${config.bg} \${pulseAnim} flex items-center px-1.5 cursor-pointer z-10" 
                   style="left: \${offsetPct}%; width: \${widthPct}%; border-left: 2px solid \${config.color};">
                <span class="text-[9px] font-bold font-mono truncate text-white">\${dur}ms</span>
              </div>
            </div>
          </div>
        \`;
      }
      container.innerHTML = html;
    }

    // Toggle collapsible tree node
    function toggleNode(spanId, event) {
      if (event) {
        event.stopPropagation();
      }
      if (collapsedNodes.has(spanId)) {
        collapsedNodes.delete(spanId);
      } else {
        collapsedNodes.add(spanId);
      }
      renderTree(document.getElementById('tree-search').value);
    }

    // KPI Metric Filtering logic
    function filterByMetric(type) {
      activeMetricFilter = type;
      
      const cards = {
        all: document.getElementById('metric-all'),
        collab: document.getElementById('metric-collab'),
        wiki: document.getElementById('metric-wiki'),
        failed: document.getElementById('metric-failed')
      };
      
      Object.keys(cards).forEach(key => {
        const card = cards[key];
        if (!card) return;
        if ((type === null && key === 'all') || (type === key)) {
          card.classList.add('border-indigo-500/80', 'bg-indigo-950/20', 'shadow-[0_0_20px_rgba(99,102,241,0.25)]');
          card.classList.remove('border-white/5');
        } else {
          card.classList.remove('border-indigo-500/80', 'bg-indigo-950/20', 'shadow-[0_0_20px_rgba(99,102,241,0.25)]');
          card.classList.add('border-white/5');
        }
      });

      renderTree(document.getElementById('tree-search').value);
    }

    // Build hierarchical tree UI
    function renderTree(searchQuery = '') {
      const container = document.getElementById('tree-container');
      const query = searchQuery.trim().toLowerCase();

      function drawNode(span, depth = 0) {
        const config = deptConfigs[span.department.toLowerCase()] || deptConfigs.general;
        
        let queryMatches = !query || 
                           span.agentName.toLowerCase().includes(query) || 
                           span.task.toLowerCase().includes(query) || 
                           span.events.some(e => e.label.toLowerCase().includes(query) || e.detail.toLowerCase().includes(query));

        let metricMatches = true;
        if (activeMetricFilter === 'collab') {
          metricMatches = span.events.some(e => e.type === 'collaboration');
        } else if (activeMetricFilter === 'wiki') {
          metricMatches = span.events.some(e => e.type === 'wiki_query' || e.type === 'wiki_publish');
        } else if (activeMetricFilter === 'failed') {
          metricMatches = span.status === 'failed';
        }

        const isMatched = queryMatches && metricMatches;

        // Skip branch if none of the descendents or parents match
        if ((query || activeMetricFilter) && !isMatched) {
          const children = parentToChildren.get(span.id) || [];
          const childMatches = children.some(c => hasMatchingDescendent(c, query, activeMetricFilter));
          if (!childMatches) return '';
        }

        const indentPx = depth * 16;
        const isSelected = span.id === activeSpanId;
        const selectedClass = isSelected ? 'bg-indigo-600/20 border-indigo-500 shadow-[0_0_15px_rgba(99,102,241,0.15)]' : 'border-white/5 hover:bg-white/5';
        
        const statusIcon = span.status === 'completed' 
          ? '<span class="text-emerald-400">●</span>' 
          : span.status === 'failed' 
            ? '<span class="text-rose-500">●</span>' 
            : '<span class="text-amber-400 animate-ping">●</span>';

        const children = parentToChildren.get(span.id) || [];
        const hasChildren = children.length > 0;
        const isCollapsed = collapsedNodes.has(span.id);
        
        let chevron = '';
        if (hasChildren) {
          const rotationClass = isCollapsed ? 'rotate-[-90deg]' : '';
          chevron = \`
            <span onclick="toggleNode('\${span.id}', event)" class="mr-1.5 text-[10px] text-slate-500 hover:text-white transition-transform duration-200 cursor-pointer inline-block \${rotationClass}">
              ▼
            </span>
          \`;
        } else {
          chevron = '<span class="w-4 inline-block"></span>';
        }

        let html = \`
          <div onclick="selectSpan('\${span.id}')" class="flex items-center justify-between p-2.5 rounded-lg border \${selectedClass} mb-1.5 cursor-pointer transition-all shrink-0" style="margin-left: \${indentPx}px;">
            <div class="flex items-center space-x-2.5 truncate">
              \${chevron}
              <span>\${config.icon}</span>
              <div class="truncate">
                <p class="font-semibold text-white flex items-center">
                  \${span.agentName}
                  <span class="text-[10px] font-semibold text-slate-400 ml-1.5 font-mono opacity-80">\${span.department}</span>
                </p>
                <p class="text-xs text-slate-400 truncate mt-0.5 font-mono">\${span.task}</p>
              </div>
            </div>
            <div class="flex items-center space-x-2 shrink-0 font-mono text-xs">
              <span class="text-slate-400">\${span.durationMs !== undefined ? span.durationMs + 'ms' : 'active'}</span>
              \${statusIcon}
            </div>
          </div>
        \`;

        // Auto expand if there is search query or metric filter active
        const showChildren = !isCollapsed || !!query || !!activeMetricFilter;
        const childrenClass = showChildren ? '' : 'hidden';

        if (hasChildren) {
          html += \`<div class="\${childrenClass}">\`;
          for (const child of children) {
            html += drawNode(child, depth + 1);
          }
          html += \`</div>\`;
        }

        return html;
      }

      function hasMatchingDescendent(span, query, metricFilter) {
        let qMatches = !query || 
                       span.agentName.toLowerCase().includes(query) || 
                       span.task.toLowerCase().includes(query) || 
                       span.events.some(e => e.label.toLowerCase().includes(query) || e.detail.toLowerCase().includes(query));

        let mMatches = true;
        if (metricFilter === 'collab') {
          mMatches = span.events.some(e => e.type === 'collaboration');
        } else if (metricFilter === 'wiki') {
          mMatches = span.events.some(e => e.type === 'wiki_query' || e.type === 'wiki_publish');
        } else if (metricFilter === 'failed') {
          mMatches = span.status === 'failed';
        }

        if (qMatches && mMatches) {
          return true;
        }
        const children = parentToChildren.get(span.id) || [];
        return children.some(c => hasMatchingDescendent(c, query, metricFilter));
      }

      let treeHtml = '';
      for (const root of roots) {
        treeHtml += drawNode(root, 0);
      }
      
      if (!treeHtml) {
        treeHtml = '<div class="text-center text-slate-500 py-12">No matching specialists found.</div>';
      }
      container.innerHTML = treeHtml;
    }

    function selectSpan(id) {
      activeSpanId = id;
      renderTree(document.getElementById('tree-search').value);
      
      const span = idToSpan.get(id);
      if (!span) return;

      document.getElementById('inspector-placeholder').classList.add('hidden');
      const panel = document.getElementById('inspector-panel');
      panel.classList.remove('hidden');
      panel.classList.add('flex');

      // Department & Status badges
      const config = deptConfigs[span.department.toLowerCase()] || deptConfigs.general;
      
      const deptBadge = document.getElementById('inspect-dept-badge');
      deptBadge.className = \`px-2.5 py-0.5 rounded text-xs font-mono font-bold \${config.bg} \${config.text}\`;
      deptBadge.innerHTML = \`\${config.icon} \${span.department.toUpperCase()}\`;

      const statusBadge = document.getElementById('inspect-status-badge');
      if (span.status === 'completed') {
        statusBadge.className = "px-2.5 py-0.5 rounded text-xs font-mono font-bold bg-emerald-500/10 text-emerald-400";
        statusBadge.innerHTML = "COMPLETED";
      } else if (span.status === 'failed') {
        statusBadge.className = "px-2.5 py-0.5 rounded text-xs font-mono font-bold bg-rose-500/10 text-rose-400";
        statusBadge.innerHTML = "FAILED";
      } else {
        statusBadge.className = "px-2.5 py-0.5 rounded text-xs font-mono font-bold bg-amber-500/10 text-amber-400 animate-pulse";
        statusBadge.innerHTML = "RUNNING";
      }

      // Title & Timings
      document.getElementById('inspect-agent-name').innerHTML = span.agentName;
      document.getElementById('inspect-duration').innerHTML = span.durationMs !== undefined ? span.durationMs + 'ms' : 'Executing...';
      
      const startStr = new Date(span.startedAt).toLocaleTimeString();
      document.getElementById('inspect-timings').innerHTML = \`Started: \${startStr}\`;

      // Task
      document.getElementById('inspect-task').innerHTML = escapeHtml(span.task);

      // Raw JSON Payload Block
      const rawPre = document.getElementById('inspect-raw-json');
      if (rawPre) {
        rawPre.textContent = JSON.stringify(span, null, 2);
      }
      const copyBtnText = document.getElementById('copy-btn-text');
      if (copyBtnText) {
        copyBtnText.innerHTML = "📋 Copy JSON";
      }

      // Events feed
      const eventsContainer = document.getElementById('inspect-events');
      if (span.events.length === 0) {
        eventsContainer.innerHTML = '<p class="text-xs text-slate-500 font-mono py-2">No trace events recorded inside this execution span.</p>';
      } else {
        let eventsHtml = '';
        span.events.forEach(ev => {
          let eventIcon = '⚙️';
          let borderClass = 'border-white/5';
          if (ev.type === 'wiki_query') { eventIcon = '🔍'; borderClass = 'border-cyan-500/20'; }
          if (ev.type === 'wiki_publish') { eventIcon = '📤'; borderClass = 'border-emerald-500/20'; }
          if (ev.type === 'tool_call') { eventIcon = '⚙️'; borderClass = 'border-violet-500/20'; }
          if (ev.type === 'collaboration') { eventIcon = '🤝'; borderClass = 'border-pink-500/20'; }

          const timeStr = new Date(ev.timestamp).toLocaleTimeString();

          let detailsSection = '';
          if (ev.type === 'collaboration') {
            try {
              const data = JSON.parse(ev.detail);
              if (data && data.responseReport) {
                detailsSection = \`
                  <div class="mt-2.5 p-3 bg-slate-900 rounded border border-white/5 font-mono text-xs">
                    <p class="text-slate-400 font-bold mb-1">Collaboration Request Detail:</p>
                    <p class="text-white mb-3 bg-black/30 p-2 rounded whitespace-pre-wrap">\${escapeHtml(data.task)}</p>
                    <p class="text-slate-400 font-bold mb-1">Delivered Resolution Report:</p>
                    <p class="text-slate-300 bg-black/30 p-2 rounded whitespace-pre-wrap">\${escapeHtml(data.responseReport)}</p>
                  </div>
                \`;
              }
            } catch {
              detailsSection = \`<div class="mt-2 text-xs text-slate-400 font-mono bg-black/25 p-2 rounded whitespace-pre-wrap">\${escapeHtml(ev.detail)}</div>\`;
            }
          } else {
            detailsSection = \`<div class="mt-2 text-xs text-slate-400 font-mono bg-black/25 p-2 rounded whitespace-pre-wrap">\${escapeHtml(ev.detail)}</div>\`;
          }

          eventsHtml += \`
            <div class="p-3 bg-slate-900/40 rounded-lg border \${borderClass} flex flex-col transition-all">
              <div class="flex justify-between items-center text-xs">
                <span class="font-bold flex items-center space-x-1.5">
                  <span>\${eventIcon}</span>
                  <span class="text-slate-300 font-mono">\${ev.label}</span>
                </span>
                <span class="text-slate-500 font-mono">\${timeStr}</span>
              </div>
              \${detailsSection}
            </div>
          \`;
        });
        eventsContainer.innerHTML = eventsHtml;
      }
    }

    // Clipboard copy action
    function copyRawTelemetry() {
      if (!activeSpanId) return;
      const span = idToSpan.get(activeSpanId);
      if (!span) return;
      
      const jsonStr = JSON.stringify(span, null, 2);
      navigator.clipboard.writeText(jsonStr).then(() => {
        const copyBtnText = document.getElementById('copy-btn-text');
        if (copyBtnText) {
          copyBtnText.innerHTML = "✨ Copied!";
          setTimeout(() => {
            copyBtnText.innerHTML = "📋 Copy JSON";
          }, 2000);
        }
      }).catch(err => {
        alert("Copy failed: " + err);
      });
    }

    // Tab 2 content renderers
    function renderIntelLogs() {
      const wikiContainer = document.getElementById('wiki-logs-container');
      const scratchContainer = document.getElementById('scratchpad-vars-container');

      let wikiHtml = '';
      let scratchHtml = '';

      const allWikiPublishes = [];
      const scratchVariables = new Map();

      for (const s of spans) {
        for (const ev of s.events) {
          if (ev.type === 'wiki_publish') {
            allWikiPublishes.push({ agentName: s.agentName, fact: ev.detail, topic: ev.label, timestamp: ev.timestamp });
          } else if (ev.type === 'tool_call' && ev.label === 'setSharedValue') {
            try {
              const match = ev.detail.match(/Setting shared value:\\s+(\\S+)/i) || ev.detail.match(/key:\\s*['"]?(\\w+)/);
              if (match && match[1]) {
                scratchVariables.set(match[1], { agentName: s.agentName, value: ev.detail, timestamp: ev.timestamp });
              } else {
                scratchVariables.set('var_' + ev.id.slice(0,6), { agentName: s.agentName, value: ev.detail, timestamp: ev.timestamp });
              }
            } catch {
              scratchVariables.set('var_' + ev.id.slice(0,6), { agentName: s.agentName, value: ev.detail, timestamp: ev.timestamp });
            }
          }
        }
      }

      // Wiki facts
      if (allWikiPublishes.length === 0) {
        wikiHtml = '<p class="text-xs text-slate-500 py-6 text-center">No knowledge facts published to the Wiki blackboard during this session.</p>';
      } else {
        allWikiPublishes.forEach(wp => {
          wikiHtml += \`
            <div class="p-4 bg-slate-900/60 rounded-xl border border-emerald-500/10">
              <div class="flex justify-between items-center text-xs text-emerald-400 border-b border-white/5 pb-2 mb-2 font-mono">
                <span class="font-bold">Topic: \${wp.topic}</span>
                <span>By: \${wp.agentName}</span>
              </div>
              <p class="text-xs text-slate-300 font-mono whitespace-pre-wrap">\${escapeHtml(wp.fact)}</p>
            </div>
          \`;
        });
      }
      wikiContainer.innerHTML = wikiHtml;

      // Scratchpad Variables
      if (scratchVariables.size === 0) {
        scratchHtml = '<p class="text-xs text-slate-500 py-6 text-center">No shared scratchpad keys set during this session.</p>';
      } else {
        for (const [key, details] of scratchVariables.entries()) {
          scratchHtml += \`
            <div class="p-4 bg-slate-900/60 rounded-xl border border-indigo-500/10">
              <div class="flex justify-between items-center text-xs text-indigo-400 border-b border-white/5 pb-2 mb-2 font-mono">
                <span class="font-bold">Key: \${key}</span>
                <span>Source: \${details.agentName}</span>
              </div>
              <p class="text-xs text-slate-300 font-mono whitespace-pre-wrap">\${escapeHtml(details.value)}</p>
            </div>
          \`;
        }
      }
      scratchContainer.innerHTML = scratchHtml;
    }

    // Utilities
    function filterTree() {
      const q = document.getElementById('tree-search').value;
      renderTree(q);
    }

    function clearSearch() {
      document.getElementById('tree-search').value = '';
      renderTree('');
    }

    function escapeHtml(str) {
      if (!str) return '';
      return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    }

    // Initialize Page
    renderGanttTimeline();
    renderTree();
  </script>
</body>
</html>`;
}
