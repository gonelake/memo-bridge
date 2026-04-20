/**
 * MemoBridge — Tool detector
 * Auto-detect installed AI tools and scan for all workspaces
 */

import { access, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { DetectResult, ToolId, WorkspaceInfo } from './types.js';
import { TOOL_NAMES } from './types.js';

interface ToolDetectionConfig {
  tool: ToolId;
  globalPaths: string[];         // 全局路径（用户主目录下）
  workspaceMarkers: string[];    // 工作区内的标记文件/目录
  description: string;
}

function expandHome(p: string): string {
  return p.replace(/^~/, homedir());
}

const DETECTION_CONFIGS: ToolDetectionConfig[] = [
  {
    tool: 'codebuddy',
    globalPaths: ['~/.codebuddy'],
    workspaceMarkers: ['.codebuddy', '.memory'],
    description: 'CodeBuddy automations and memory files',
  },
  {
    tool: 'openclaw',
    globalPaths: ['~/.openclaw'],
    workspaceMarkers: ['MEMORY.md', 'SOUL.md'],
    description: 'OpenClaw workspace with MEMORY.md, SOUL.md, daily logs',
  },
  {
    tool: 'hermes',
    globalPaths: ['~/.hermes'],
    workspaceMarkers: [],
    description: 'Hermes Agent with MEMORY.md and USER.md',
  },
  {
    tool: 'claude-code',
    globalPaths: ['~/.claude'],
    workspaceMarkers: ['CLAUDE.md'],
    description: 'Claude Code with CLAUDE.md project memory',
  },
  {
    tool: 'cursor',
    globalPaths: ['~/.cursor'],
    workspaceMarkers: ['.cursorrules', '.cursor'],
    description: 'Cursor IDE with .cursorrules',
  },
  {
    tool: 'chatgpt',
    globalPaths: [],
    workspaceMarkers: [],
    description: 'ChatGPT Memory (cloud-based, requires prompt export)',
  },
  {
    tool: 'doubao',
    globalPaths: [],
    workspaceMarkers: [],
    description: '豆包 Memory (cloud-based, requires prompt export)',
  },
  {
    tool: 'kimi',
    globalPaths: [],
    workspaceMarkers: [],
    description: 'Kimi (cloud-based, requires prompt export)',
  },
];

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

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
 * Detect a single tool (global presence)
 */
export async function detectTool(toolId: ToolId, workspacePath?: string): Promise<DetectResult> {
  const config = DETECTION_CONFIGS.find(c => c.tool === toolId);
  if (!config) {
    return { tool: toolId, name: TOOL_NAMES[toolId], detected: false };
  }

  // Cloud-based tools
  if (config.globalPaths.length === 0 && config.workspaceMarkers.length === 0) {
    return {
      tool: toolId,
      name: TOOL_NAMES[toolId],
      detected: true,
      details: `${config.description} — use 'memo-bridge prompt' to export`,
    };
  }

  const detectedPaths: string[] = [];

  // Check global paths
  for (const p of config.globalPaths) {
    const expanded = expandHome(p);
    if (await pathExists(expanded)) {
      detectedPaths.push(expanded);
    }
  }

  // Check workspace markers
  if (workspacePath) {
    for (const marker of config.workspaceMarkers) {
      const markerPath = join(workspacePath, marker);
      if (await pathExists(markerPath)) {
        detectedPaths.push(markerPath);
      }
    }
  }

  return {
    tool: toolId,
    name: TOOL_NAMES[toolId],
    detected: detectedPaths.length > 0,
    paths: detectedPaths.length > 0 ? detectedPaths : undefined,
    details: detectedPaths.length > 0 ? config.description : undefined,
  };
}

/**
 * Detect all supported tools
 */
export async function detectAllTools(workspacePath?: string): Promise<DetectResult[]> {
  return Promise.all(
    DETECTION_CONFIGS.map(config => detectTool(config.tool, workspacePath))
  );
}

// ============================================================
// Multi-workspace scanning
// ============================================================

const SCAN_IGNORE = new Set([
  'node_modules', '.git', '.Trash', 'Library', '.npm', '.cache',
  '.local', '.config', '.vscode', '.idea', 'dist', 'build',
  '__pycache__', '.tox', '.venv', 'venv', 'env',
]);

/**
 * Scan a directory tree for all CodeBuddy workspaces
 * Returns paths that contain .codebuddy/ or .memory/ directories
 */
export async function scanCodeBuddyWorkspaces(
  rootDir: string,
  maxDepth: number = 4,
): Promise<WorkspaceInfo[]> {
  const workspaces: WorkspaceInfo[] = [];
  await scanDir(rootDir, 0, maxDepth, workspaces);
  return workspaces;
}

async function scanDir(
  dir: string,
  depth: number,
  maxDepth: number,
  results: WorkspaceInfo[],
): Promise<void> {
  if (depth > maxDepth) return;

  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return; // Permission denied or other error
  }

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
          await scanDir(fullPath, depth + 1, maxDepth, results);
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
