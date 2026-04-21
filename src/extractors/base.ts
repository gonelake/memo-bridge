/**
 * MemoBridge — Extractor base class
 */

import { access, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Extractor, ToolId, DetectResult, ExtractOptions, MemoBridgeData, MemoBridgeMeta } from '../core/types.js';
import { TOOL_NAMES } from '../core/types.js';
import { MAX_READ_SIZE } from '../utils/security.js';
import { log } from '../utils/logger.js';

/**
 * Declarative detection config used by the default detect() implementation.
 * Extractors that need richer detection can override detect() directly.
 */
export interface DetectConfig {
  /** Paths under the user's home dir that indicate a global install (supports `~` prefix). */
  globalPaths: string[];
  /** Files or directories within a workspace that indicate tool usage. */
  workspaceMarkers: string[];
  /** Short human-readable description of what gets detected. */
  description: string;
}

function expandHome(p: string): string {
  return p.replace(/^~/, homedir());
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export abstract class BaseExtractor implements Extractor {
  abstract readonly toolId: ToolId;

  /**
   * Optional declarative detection config. When provided, the default
   * detect() implementation checks the configured paths and returns a
   * DetectResult. Subclasses may override detect() for custom logic.
   */
  readonly detectConfig?: DetectConfig;

  get toolName(): string {
    return TOOL_NAMES[this.toolId];
  }

  async detect(workspacePath?: string): Promise<DetectResult> {
    const config = this.detectConfig;
    if (!config) {
      return { tool: this.toolId, name: this.toolName, detected: false };
    }

    const detectedPaths: string[] = [];

    for (const p of config.globalPaths) {
      const expanded = expandHome(p);
      if (await pathExists(expanded)) {
        detectedPaths.push(expanded);
      }
    }

    if (workspacePath) {
      for (const marker of config.workspaceMarkers) {
        const markerPath = join(workspacePath, marker);
        if (await pathExists(markerPath)) {
          detectedPaths.push(markerPath);
        }
      }
    }

    return {
      tool: this.toolId,
      name: this.toolName,
      detected: detectedPaths.length > 0,
      paths: detectedPaths.length > 0 ? detectedPaths : undefined,
      details: detectedPaths.length > 0 ? config.description : undefined,
    };
  }

  abstract extract(options: ExtractOptions): Promise<MemoBridgeData>;

  protected createMeta(
    method: MemoBridgeMeta['source']['extraction_method'],
    workspace?: string,
    totalMemories: number = 0,
    categories: number = 0,
    earliest?: string,
    latest?: string,
  ): MemoBridgeMeta {
    return {
      version: '0.1',
      exported_at: new Date().toISOString(),
      source: {
        tool: this.toolId,
        workspace,
        extraction_method: method,
      },
      stats: {
        total_memories: totalMemories,
        categories,
        earliest,
        latest,
      },
    };
  }

  protected createEmptyData(workspace?: string): MemoBridgeData {
    return {
      meta: this.createMeta('file', workspace),
      profile: { identity: {}, preferences: {}, work_patterns: {} },
      knowledge: [],
      projects: [],
      feeds: [],
      raw_memories: [],
    };
  }

  /**
   * Safely read a text file with a size guard (MAX_READ_SIZE, 10MB by default).
   * Returns null when the file is absent, too large, or inaccessible.
   * Emits a warning when an oversized file is skipped so the user knows
   * data was dropped (rather than silently disappearing).
   */
  protected async readFileSafe(filePath: string): Promise<string | null> {
    try {
      const stats = await stat(filePath);
      if (!stats.isFile()) return null;
      if (stats.size > MAX_READ_SIZE) {
        log.warn(`跳过超大文件 ${filePath} (${(stats.size / 1024 / 1024).toFixed(1)}MB > ${MAX_READ_SIZE / 1024 / 1024}MB)`);
        return null;
      }
      return await readFile(filePath, 'utf-8');
    } catch {
      return null;
    }
  }

  /**
   * Check whether the given path is a directory. Returns false on any error.
   */
  protected async dirExists(dirPath: string): Promise<boolean> {
    try {
      const s = await stat(dirPath);
      return s.isDirectory();
    } catch {
      return false;
    }
  }
}
