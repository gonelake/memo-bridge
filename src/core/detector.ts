/**
 * MemoBridge — Tool detector
 *
 * Detection is delegated to the Extractor adapters registered in
 * `extractorRegistry`. This module provides:
 *  - `detectTool(toolId, workspace?)` — detect a single tool via registry
 *  - `detectAllTools(workspace?)` — detect every registered tool
 *  - `scanCodeBuddyWorkspaces` / `autoDiscoverCodeBuddyWorkspaces` —
 *    CodeBuddy-specific multi-workspace scanning helpers
 */

import { readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { extractorRegistry } from './registry.js';
import type { DetectResult, ToolId, WorkspaceInfo } from './types.js';
import { TOOL_NAMES } from './types.js';

async function isDirectory(filePath: string): Promise<boolean> {
  try {
    const s = await stat(filePath);
    return s.isDirectory();
  } catch {
    return false;
  }
}

async function countFiles(dir: string, pattern?: RegExp): Promise<number> {
  try {
    const entries = await readdir(dir);
    if (!pattern) return entries.length;
    return entries.filter(e => pattern.test(e)).length;
  } catch {
    return 0;
  }
}

/**
 * Detect a single tool via its registered Extractor.
 * Returns a default "not detected" result if the tool is not registered.
 */
export async function detectTool(toolId: ToolId, workspacePath?: string): Promise<DetectResult> {
  if (!extractorRegistry.has(toolId)) {
    return { tool: toolId, name: TOOL_NAMES[toolId], detected: false };
  }
  const extractor = extractorRegistry.get(toolId);
  return extractor.detect(workspacePath);
}

/**
 * Detect all registered tools. Order follows the registry's registration order.
 */
export async function detectAllTools(workspacePath?: string): Promise<DetectResult[]> {
  return Promise.all(
    extractorRegistry.list().map(toolId => detectTool(toolId, workspacePath)),
  );
}

// ============================================================
// Multi-workspace scanning (CodeBuddy specific)
// ============================================================

const SCAN_IGNORE = new Set([
  'node_modules', '.git', '.Trash', 'Library', '.npm', '.cache',
  '.local', '.config', '.vscode', '.idea', 'dist', 'build',
  '__pycache__', '.tox', '.venv', 'venv', 'env',
]);

// Hard ceiling on how many directory entries we'll examine during a scan.
// Prevents pathological directory trees from hanging the CLI.
const SCAN_MAX_ENTRIES = 5000;

/**
 * Scan a directory tree for all CodeBuddy workspaces
 * Returns paths that contain .codebuddy/ or .memory/ directories
 */
export async function scanCodeBuddyWorkspaces(
  rootDir: string,
  maxDepth: number = 4,
): Promise<WorkspaceInfo[]> {
  const workspaces: WorkspaceInfo[] = [];
  const budget = { remaining: SCAN_MAX_ENTRIES };
  await scanDir(rootDir, 0, maxDepth, workspaces, budget);
  return workspaces;
}

async function scanDir(
  dir: string,
  depth: number,
  maxDepth: number,
  results: WorkspaceInfo[],
  budget: { remaining: number },
): Promise<void> {
  if (depth > maxDepth) return;
  if (budget.remaining <= 0) return;

  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return; // Permission denied or other error
  }
  budget.remaining -= entries.length;

  const hasCodebuddy = entries.includes('.codebuddy');
  const hasMemory = entries.includes('.memory');

  if (hasCodebuddy || hasMemory) {
    // Found a workspace
    let automationCount = 0;
    let memoryFileCount = 0;

    if (hasCodebuddy) {
      const automationsDir = join(dir, '.codebuddy', 'automations');
      if (await isDirectory(automationsDir)) {
        const automationDirs = await readdir(automationsDir).catch(() => [] as string[]);
        automationCount = automationDirs.length;
      }
    }

    if (hasMemory) {
      memoryFileCount = await countFiles(join(dir, '.memory'), /\.md$/);
    }

    results.push({
      path: dir,
      tool: 'codebuddy',
      hasAutomations: hasCodebuddy,
      hasMemory: hasMemory,
      automationCount,
      memoryFileCount,
    });
  }

  // Continue scanning subdirectories (but not too deep)
  if (depth < maxDepth) {
    const subdirs = entries.filter(e => !e.startsWith('.') || e === '.codebuddy' || e === '.memory')
      .filter(e => !SCAN_IGNORE.has(e));

    for (const subdir of subdirs) {
      const fullPath = join(dir, subdir);
      if (await isDirectory(fullPath)) {
        // Don't recurse into found workspaces' subdirectories beyond markers
        if (subdir !== '.codebuddy' && subdir !== '.memory') {
          await scanDir(fullPath, depth + 1, maxDepth, results, budget);
        }
      }
    }
  }
}

/**
 * Auto-discover CodeBuddy workspaces from common locations
 */
export async function autoDiscoverCodeBuddyWorkspaces(): Promise<WorkspaceInfo[]> {
  const home = homedir();
  const scanRoots = [
    join(home, 'CodeBuddy'),         // ~/CodeBuddy/ (common convention)
    join(home, 'Documents'),          // ~/Documents/
    join(home, 'Projects'),           // ~/Projects/
    join(home, 'Code'),               // ~/Code/
    join(home, 'Developer'),          // ~/Developer/
    join(home, 'Workspace'),          // ~/Workspace/
    join(home, 'Desktop'),            // ~/Desktop/
  ];

  const allWorkspaces: WorkspaceInfo[] = [];

  for (const root of scanRoots) {
    if (await isDirectory(root)) {
      const found = await scanCodeBuddyWorkspaces(root, 3);
      for (const ws of found) {
        // Deduplicate by path
        if (!allWorkspaces.some(existing => existing.path === ws.path)) {
          allWorkspaces.push(ws);
        }
      }
    }
  }

  return allWorkspaces;
}
