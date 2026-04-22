/**
 * MemoBridge — Importer base class
 */

import { readFile } from 'node:fs/promises';
import type { Importer, ToolId, MemoBridgeData, ImportOptions, ImportResult } from '../core/types.js';
import { TOOL_NAMES } from '../core/types.js';

export abstract class BaseImporter implements Importer {
  abstract readonly toolId: ToolId;

  get toolName(): string {
    return TOOL_NAMES[this.toolId];
  }

  abstract import(data: MemoBridgeData, options: ImportOptions): Promise<ImportResult>;

  /**
   * Declare every file this importer may overwrite or create for the given
   * options. Used by the CLI to snapshot files into .memobridge/backups/
   * before calling import(), enabling rollback on bad imports.
   *
   * Default implementation returns [] — subclasses SHOULD override to
   * return a concrete list. Unknown/dynamic targets should err on the side
   * of listing (over-backing-up is cheap; missing a target means no rollback).
   *
   * Returning [] means "no file-based side effects" — appropriate for
   * instruction-only importers (ChatGPT/Doubao/Kimi) that only return
   * text for the user to paste elsewhere.
   */
  listTargets(_data: MemoBridgeData, _options: ImportOptions): string[] {
    return [];
  }

  /**
   * Flatten MemoBridgeData into a readable Markdown summary for instruction-based import
   */
  protected flattenToText(data: MemoBridgeData, maxChars?: number): string {
    const parts: string[] = [];

    // Profile
    const profileParts: string[] = [];
    for (const [k, v] of Object.entries(data.profile.identity)) {
      profileParts.push(`${k}: ${v}`);
    }
    for (const [k, v] of Object.entries(data.profile.preferences)) {
      profileParts.push(`${k}: ${v}`);
    }
    for (const [k, v] of Object.entries(data.profile.work_patterns)) {
      profileParts.push(`${k}: ${v}`);
    }
    if (profileParts.length > 0) {
      parts.push('## 用户画像\n' + profileParts.map(p => `- ${p}`).join('\n'));
    }

    // Knowledge
    for (const section of data.knowledge) {
      const items = section.items.map(i => i.topic).join(', ');
      if (items) {
        parts.push(`## ${section.title}\n- 已学主题: ${items}`);
      }
    }

    // Projects
    if (data.projects.length > 0) {
      const projLines = data.projects.map(p =>
        `- ${p.name}(${p.status}): ${p.key_insights.slice(0, 2).join('; ')}`
      );
      parts.push('## 项目上下文\n' + projLines.join('\n'));
    }

    // Feeds
    if (data.feeds.length > 0) {
      const feedLines = data.feeds.map(f => {
        const details = [f.name, f.schedule ? `每日${f.schedule}` : '', f.total_issues ? `${f.total_issues}期` : ''].filter(Boolean);
        return `- ${details.join(' | ')}`;
      });
      parts.push('## 信息流\n' + feedLines.join('\n'));
    }

    // Raw memories (top N by confidence)
    const topMemories = data.raw_memories
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 20);
    if (topMemories.length > 0) {
      parts.push('## 关键记忆\n' + topMemories.map(m => `- ${m.content}`).join('\n'));
    }

    let result = parts.join('\n\n');
    if (maxChars && result.length > maxChars) {
      result = result.slice(0, maxChars - 3) + '...';
    }
    return result;
  }

  protected countImported(data: MemoBridgeData): number {
    return data.raw_memories.length + data.projects.length + data.feeds.length +
      data.knowledge.reduce((n, s) => n + s.items.length, 0) +
      Object.keys(data.profile.identity).length +
      Object.keys(data.profile.preferences).length +
      Object.keys(data.profile.work_patterns).length;
  }
}

/**
 * Read an existing file's contents for append-mode operations.
 * Returns '' if the file does not exist (ENOENT is expected for first write).
 * Propagates other errors (EACCES, EISDIR, etc.) so callers don't silently
 * corrupt the output when permissions are wrong.
 */
export async function readExistingFile(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw err;
  }
}
