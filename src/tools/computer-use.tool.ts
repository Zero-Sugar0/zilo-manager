import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { tool } from 'ai';
import { z } from 'zod';
import { requestConfirmation } from '../runtime/confirm.js';
import { emitProgress } from '../runtime/progress.js';

const execFileAsync = promisify(execFile);
const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';
const outputDir = path.resolve('outputs', 'computer-use');

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function confirmAction(action: string, details: string[], access: 'Read-only' | 'Write' = 'Write') {
  return requestConfirmation({
    toolkitSlug: 'ZILMATE',
    toolSlug: 'COMPUTER_USE',
    action,
    access,
    targetTools: ['ZILMATE_COMPUTER_USE'],
    details,
    summary: details.join('; '),
  });
}

async function ensureDir(sub?: string) {
  const dir = sub ? path.join(outputDir, sub) : outputDir;
  await mkdir(dir, { recursive: true });
  return dir;
}

function ts() { return new Date().toISOString().replace(/[:.]/g, '-'); }

async function commandExists(cmd: string) {
  try {
    await execFileAsync(IS_WIN ? 'where' : 'which', [cmd], { timeout: 5000, windowsHide: true });
    return true;
  } catch { return false; }
}

function run(command: string, args: string[], timeoutMs = 30_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], shell: IS_WIN, windowsHide: true });
    let out = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (c) => { out += c; });
    child.stderr.on('data', (c) => { out += c; });
    child.on('error', reject);
    const t = setTimeout(() => { child.kill(); reject(new Error(`Timed out after ${timeoutMs / 1000}s`)); }, timeoutMs);
    child.on('close', () => { clearTimeout(t); resolve(out); });
  });
}

// ─── PyAutoGUI bootstrap ──────────────────────────────────────────────────────
// All mouse/keyboard/window tools use PyAutoGUI + pygetwindow (cross-platform).
// On Linux also needs python3-tk and python3-xlib.

async function runPython(script: string, timeoutMs = 15_000): Promise<string> {
  const py = IS_WIN ? 'python' : 'python3';
  const dir = await ensureDir('scripts');
  const file = path.join(dir, `cu-${ts()}.py`);
  await writeFile(file, script, 'utf8');
  return run(py, [file], timeoutMs);
}

// ─── 1. Mouse control ─────────────────────────────────────────────────────────

export const mouseTool = {
  mouseAction: tool({
    description:
      'Move the mouse, click, double-click, right-click, or scroll at specific screen coordinates. Use after takeScreenshot + analyzeScreenshot to find coordinates of UI elements.',
    inputSchema: z.object({
      action: z.enum(['move', 'click', 'doubleClick', 'rightClick', 'scroll']),
      x: z.number().int().describe('X coordinate in pixels from top-left of screen.'),
      y: z.number().int().describe('Y coordinate in pixels from top-left of screen.'),
      scrollDirection: z.enum(['up', 'down', 'left', 'right']).optional().describe('Required when action is scroll.'),
      scrollAmount: z.number().int().min(1).max(20).optional().default(3).describe('Number of scroll clicks.'),
      duration: z.number().min(0).max(3).optional().default(0.2).describe('Movement duration in seconds (0 = instant).'),
    }),
    execute: async ({ action, x, y, scrollDirection, scrollAmount, duration }) => {
      const approved = await confirmAction('Mouse action', [
        `Action: ${action} at (${x}, ${y})`,
        action === 'scroll' ? `Scroll ${scrollDirection} × ${scrollAmount}` : '',
      ].filter(Boolean));
      if (!approved) throw new Error('Blocked mouse action.');

      emitProgress({ type: 'tool:start', label: `Mouse ${action}`, detail: `(${x}, ${y})` });

      const script = `
import pyautogui
import time
pyautogui.FAILSAFE = True
pyautogui.PAUSE = 0.05

${action === 'move' ? `pyautogui.moveTo(${x}, ${y}, duration=${duration})` : ''}
${action === 'click' ? `pyautogui.click(${x}, ${y}, duration=${duration})` : ''}
${action === 'doubleClick' ? `pyautogui.doubleClick(${x}, ${y}, duration=${duration})` : ''}
${action === 'rightClick' ? `pyautogui.rightClick(${x}, ${y}, duration=${duration})` : ''}
${action === 'scroll' ? `pyautogui.moveTo(${x}, ${y})\npyautogui.scroll(${scrollDirection === 'down' ? -(scrollAmount ?? 3) : (scrollAmount ?? 3)})` : ''}
print("done")
`.trim();

      const out = await runPython(script);
      emitProgress({ type: 'tool:end', label: `Mouse ${action} complete` });
      return { action, x, y, result: out.trim() };
    },
  }),
};

// ─── 2. Keyboard control ─────────────────────────────────────────────────────

export const keyboardTool = {
  keyboardAction: tool({
    description:
      'Type text, press individual keys, or fire hotkey combos. Use for form filling, triggering shortcuts, confirming dialogs, navigating UIs, and sending Enter/Escape/Tab.',
    inputSchema: z.object({
      action: z.enum(['type', 'press', 'hotkey']),
      text: z.string().optional().describe('Text to type (for action=type).'),
      key: z.string().optional().describe('Key name for press: enter, escape, tab, space, backspace, delete, up, down, left, right, f1-f12, etc.'),
      hotkey: z.array(z.string()).optional().describe('Key combo for hotkey, e.g. ["ctrl","c"] or ["cmd","shift","4"].'),
      interval: z.number().min(0).max(1).optional().default(0.02).describe('Seconds between keystrokes when typing (default 0.02).'),
    }),
    execute: async ({ action, text, key, hotkey, interval }) => {
      if (action === 'type' && !text) throw new Error('text is required for action=type');
      if (action === 'press' && !key) throw new Error('key is required for action=press');
      if (action === 'hotkey' && !hotkey?.length) throw new Error('hotkey array is required for action=hotkey');

      const approved = await confirmAction('Keyboard action', [
        action === 'type' ? `Type: "${text!.slice(0, 80)}${text!.length > 80 ? '…' : ''}"` : '',
        action === 'press' ? `Press key: ${key}` : '',
        action === 'hotkey' ? `Hotkey: ${hotkey!.join('+')}` : '',
      ].filter(Boolean));
      if (!approved) throw new Error('Blocked keyboard action.');

      emitProgress({ type: 'tool:start', label: `Keyboard ${action}` });

      // Escape backslashes and quotes for safe embedding in Python string
      const escapedText = (text ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");

      const script = `
import pyautogui
pyautogui.FAILSAFE = True
pyautogui.PAUSE = 0.05

${action === 'type' ? `pyautogui.typewrite('${escapedText}', interval=${interval})` : ''}
${action === 'press' ? `pyautogui.press('${key}')` : ''}
${action === 'hotkey' ? `pyautogui.hotkey(${hotkey!.map((k) => `'${k}'`).join(', ')})` : ''}
print("done")
`.trim();

      const out = await runPython(script);
      emitProgress({ type: 'tool:end', label: `Keyboard ${action} complete` });
      return { action, result: out.trim() };
    },
  }),
};

// ─── 3. Screen reading (single shot, no polling) ──────────────────────────────

export const screenReadTool = {
  readScreen: tool({
    description:
      'Capture the current screen and return its pixel dimensions and file path. Pair with analyzeScreenshot (in desktop tools) to understand what is on screen before acting. Single shot — does not poll or watch continuously.',
    inputSchema: z.object({
      region: z
        .object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() })
        .optional()
        .describe('Capture only this region instead of the full screen.'),
    }),
    execute: async ({ region }) => {
      const approved = await confirmAction('Read screen', ['Capture current screen contents as image'], 'Read-only');
      if (!approved) throw new Error('Blocked screen read.');

      emitProgress({ type: 'tool:start', label: 'Reading screen' });

      const dir = await ensureDir('screenshots');
      const outFile = path.join(dir, `screen-${ts()}.png`);

      const regionArg = region
        ? `region=(${region.x}, ${region.y}, ${region.width}, ${region.height})`
        : '';

      const script = `
import pyautogui
img = pyautogui.screenshot(${regionArg})
img.save('${outFile.replace(/\\/g, '\\\\')}')
print(f"{img.width}x{img.height}")
`.trim();

      const out = await runPython(script);
      const [w, h] = out.trim().split('x').map(Number);

      emitProgress({ type: 'tool:end', label: 'Screen captured', detail: outFile });
      return { filePath: outFile, width: w, height: h };
    },
  }),
};

// ─── 4. Window management ────────────────────────────────────────────────────

export const windowTool = {
  manageWindow: tool({
    description:
      'List open windows, focus a specific window by title, move/resize it, or close it. Use to bring an app to focus before sending mouse/keyboard actions.',
    inputSchema: z.object({
      action: z.enum(['list', 'focus', 'resize', 'close', 'minimize', 'maximize']),
      title: z.string().optional().describe('Window title (partial match). Required for all actions except list.'),
      x: z.number().int().optional().describe('New X position (for resize).'),
      y: z.number().int().optional().describe('New Y position (for resize).'),
      width: z.number().int().optional().describe('New width (for resize).'),
      height: z.number().int().optional().describe('New height (for resize).'),
    }),
    execute: async ({ action, title, x, y, width, height }) => {
      if (action !== 'list' && !title) throw new Error('title is required for all actions except list.');

      const approved = await confirmAction('Window management', [
        `Action: ${action}`,
        title ? `Window: "${title}"` : 'Listing all windows',
      ]);
      if (!approved) throw new Error('Blocked window action.');

      emitProgress({ type: 'tool:start', label: `Window ${action}`, detail: title ?? '' });

      const script = `
import pygetwindow as gw
import json

${action === 'list' ? `
wins = gw.getAllWindows()
print(json.dumps([{"title": w.title, "width": w.width, "height": w.height, "x": w.left, "y": w.top, "visible": w.visible} for w in wins if w.title.strip()]))
` : ''}
${action !== 'list' ? `
wins = gw.getWindowsWithTitle('${title}')
if not wins:
    print(json.dumps({"error": "Window not found: ${title}"}))
else:
    w = wins[0]
    ${action === 'focus' ? 'w.activate()' : ''}
    ${action === 'minimize' ? 'w.minimize()' : ''}
    ${action === 'maximize' ? 'w.maximize()' : ''}
    ${action === 'close' ? 'w.close()' : ''}
    ${action === 'resize' && width && height ? `w.resizeTo(${width}, ${height})` : ''}
    ${action === 'resize' && x !== undefined && y !== undefined ? `w.moveTo(${x}, ${y})` : ''}
    print(json.dumps({"title": w.title, "action": "${action}", "done": True}))
` : ''}
`.trim();

      const out = await runPython(script);
      try {
        const parsed = JSON.parse(out.trim());
        emitProgress({ type: 'tool:end', label: `Window ${action} complete` });
        return parsed;
      } catch {
        return { raw: out.trim() };
      }
    },
  }),
};

// ─── 5. Find UI element by image (template matching) ─────────────────────────

export const findElementTool = {
  findOnScreen: tool({
    description:
      'Locate a UI element on screen by matching a reference image (button, icon, input field). Returns the center coordinates to click. Use when you have a known image of the element but not its coordinates.',
    inputSchema: z.object({
      referenceImagePath: z.string().describe('Absolute path to a PNG of the UI element to find.'),
      confidence: z.number().min(0.5).max(1).optional().default(0.85).describe('Match confidence threshold 0.5–1.0 (default 0.85).'),
      region: z
        .object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() })
        .optional()
        .describe('Narrow the search to this screen region for speed.'),
    }),
    execute: async ({ referenceImagePath, confidence, region }) => {
      if (!existsSync(referenceImagePath)) throw new Error(`Reference image not found: ${referenceImagePath}`);

      const approved = await confirmAction('Find UI element on screen', [
        `Reference image: ${referenceImagePath}`,
        `Confidence: ${confidence}`,
      ], 'Read-only');
      if (!approved) throw new Error('Blocked findOnScreen.');

      emitProgress({ type: 'tool:start', label: 'Locating element on screen' });

      const regionArg = region ? `region=(${region.x}, ${region.y}, ${region.width}, ${region.height})` : '';

      const script = `
import pyautogui
import json

try:
    loc = pyautogui.locateOnScreen('${referenceImagePath.replace(/\\/g, '\\\\')}', confidence=${confidence}${regionArg ? ', ' + regionArg : ''})
    if loc:
        center = pyautogui.center(loc)
        print(json.dumps({"found": True, "x": center.x, "y": center.y, "box": {"left": loc.left, "top": loc.top, "width": loc.width, "height": loc.height}}))
    else:
        print(json.dumps({"found": False}))
except Exception as e:
    print(json.dumps({"found": False, "error": str(e)}))
`.trim();

      const out = await runPython(script);
      const result = JSON.parse(out.trim());
      emitProgress({ type: 'tool:end', label: result.found ? `Element found at (${result.x}, ${result.y})` : 'Element not found' });
      return result;
    },
  }),
};

// ─── 6. Drag and drop ────────────────────────────────────────────────────────

export const dragTool = {
  dragAndDrop: tool({
    description: 'Click and drag from one screen position to another. Use for moving files in GUI file managers, reordering items, resizing elements, or canvas interactions.',
    inputSchema: z.object({
      fromX: z.number().int(),
      fromY: z.number().int(),
      toX: z.number().int(),
      toY: z.number().int(),
      duration: z.number().min(0.1).max(5).optional().default(0.5).describe('Drag duration in seconds.'),
      button: z.enum(['left', 'right', 'middle']).optional().default('left'),
    }),
    execute: async ({ fromX, fromY, toX, toY, duration, button }) => {
      const approved = await confirmAction('Drag and drop', [`From (${fromX}, ${fromY}) → (${toX}, ${toY})`]);
      if (!approved) throw new Error('Blocked drag action.');

      emitProgress({ type: 'tool:start', label: 'Dragging', detail: `(${fromX},${fromY}) → (${toX},${toY})` });

      const script = `
import pyautogui
pyautogui.FAILSAFE = True
pyautogui.dragTo(${toX}, ${toY}, duration=${duration}, startX=${fromX}, startY=${fromY}, button='${button}')
print("done")
`.trim();

      const out = await runPython(script);
      emitProgress({ type: 'tool:end', label: 'Drag complete' });
      return { fromX, fromY, toX, toY, result: out.trim() };
    },
  }),
};

// ─── 7. Install computer-use dependencies ────────────────────────────────────

export const computerUseInstallTool = {
  installComputerUseDeps: tool({
    description:
      'Install PyAutoGUI, pygetwindow, and platform dependencies needed for all computer-use tools. Run once before using any other computer-use tool.',
    inputSchema: z.object({}),
    execute: async () => {
      const approved = await confirmAction('Install computer-use dependencies', [
        'pip install pyautogui pygetwindow pillow',
        IS_WIN ? 'No extra system deps needed on Windows' : '',
        IS_MAC ? 'May prompt for Accessibility permissions in System Preferences' : '',
        !IS_WIN && !IS_MAC ? 'apt-get install python3-tk python3-xlib scrot (for Linux)' : '',
      ].filter(Boolean));
      if (!approved) throw new Error('Blocked dependency install.');

      emitProgress({ type: 'tool:start', label: 'Installing computer-use dependencies' });
      const pip = IS_WIN ? 'pip' : 'pip3';
      const results: Record<string, string> = {};

      try {
        results['pyautogui+pygetwindow'] = await run(pip, ['install', '--upgrade', 'pyautogui', 'pygetwindow', 'pillow'], 120_000);
      } catch (e) { results['pyautogui'] = String(e); }

      if (!IS_WIN && !IS_MAC) {
        try {
          results['system'] = await run('sudo', ['apt-get', 'install', '-y', 'python3-tk', 'python3-xlib', 'scrot'], 120_000);
        } catch (e) { results['system'] = String(e); }
      }

      emitProgress({ type: 'tool:end', label: 'Dependencies installed' });
      return { platform: process.platform, results };
    },
  }),
};

// ─── Barrel export ────────────────────────────────────────────────────────────

export const computerUseTools = {
  ...computerUseInstallTool,
  ...mouseTool,
  ...keyboardTool,
  ...screenReadTool,
  ...windowTool,
  ...findElementTool,
  ...dragTool,
};