/**
 * MemoBridge — Hermes Agent Importer
 * Writes to: ~/.hermes/memories/MEMORY.md (≤2,200 chars) + USER.md (≤1,375 chars)
 * Automatically trims content to fit Hermes' strict character limits
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { BaseImporter } from './base.js';
import { validateWritePath, isNotSymlink } from '../utils/security.js';
import type { MemoBridgeData, ImportOptions, ImportResult } from '../core/types.js';

const MEMORY_CHAR_LIMIT = 2200;
const USER_CHAR_LIMIT = 1375;

/** Return the UTF-8 byte length of a string (matches on-disk file size). */
function byteLength(s: string): number {
  return Buffer.byteLength(s, 'utf-8');
}

export default class HermesImporter extends BaseImporter {
  readonly toolId = 'hermes' as const;

  async import(data: MemoBridgeData, options: ImportOptions): Promise<ImportResult> {
    const hermesDir = validateWritePath(options.workspace || join(homedir(), '.hermes'));
    const memoriesDir = join(hermesDir, 'memories');
    const maxMemory = options.maxChars || MEMORY_CHAR_LIMIT;
    const warnings: string[] = [];

    const { content: memoryContent, truncated: memoryTruncated } =
      this.buildMemoryContent(data, maxMemory);
    const userContent = this.buildUserContent(data, USER_CHAR_LIMIT);

    if (options.dryRun) {
      return {
        success: true, method: 'file_write',
        items_imported: this.countImported(data), items_skipped: 0,
        output_path: memoriesDir,
        instructions: `[DRY RUN] 将写入:\n  MEMORY.md (${byteLength(memoryContent)}/${maxMemory} bytes)\n  USER.md (${byteLength(userContent)}/${USER_CHAR_LIMIT} bytes)`,
        warnings: memoryTruncated ? [`MEMORY.md 已达 ${maxMemory} 字节上限，部分记忆被裁剪`] : [],
      };
    }

    await mkdir(memoriesDir, { recursive: true });

    // Write MEMORY.md — Hermes uses § as separator
    const memoryPath = join(memoriesDir, 'MEMORY.md');
    if (!await isNotSymlink(memoryPath)) {
      throw new Error(`安全限制: ${memoryPath} 是符号链接，拒绝写入`);
    }
    await writeFile(memoryPath, memoryContent, 'utf-8');
    if (memoryTruncated) {
      warnings.push(`MEMORY.md 已达 ${maxMemory} 字节上限，部分记忆被裁剪`);
    }

    // Write USER.md
    const userPath = join(memoriesDir, 'USER.md');
    if (userContent.trim()) {
      if (!await isNotSymlink(userPath)) {
        throw new Error(`安全限制: ${userPath} 是符号链接，拒绝写入`);
      }
      await writeFile(userPath, userContent, 'utf-8');
    }

    return {
      success: true, method: 'file_write',
      items_imported: this.countImported(data), items_skipped: 0,
      output_path: memoriesDir, warnings,
    };
  }

  /**
   * Build MEMORY.md content within character limit.
   * Uses § as separator (Hermes convention).
   * Prioritizes: projects > knowledge summaries > high-confidence memories.
   *
   * Returns both the serialized content and a `truncated` flag indicating
   * whether any entries were dropped due to the char budget. The flag is
   * authoritative — don't infer truncation from `content.length >= maxChars`,
   * because the fitting loop always stops before the budget is exceeded.
   */
  private buildMemoryContent(data: MemoBridgeData, maxChars: number): { content: string; truncated: boolean } {
    const entries: Array<{ text: string; priority: number }> = [];

    // Projects (highest priority)
    for (const project of data.projects) {
      const text = `${project.name}: ${project.key_insights.slice(0, 2).join('; ')}`;
      entries.push({ text, priority: 3 });
    }

    // Knowledge summaries
    for (const section of data.knowledge) {
      const topics = section.items.map(i => i.topic).join(', ');
      entries.push({ text: `${section.title}: ${topics}`, priority: 2 });
    }

    // Feeds
    for (const feed of data.feeds) {
      entries.push({ text: `${feed.name} (${feed.schedule || '定期'})`, priority: 1 });
    }

    // Raw memories (sorted by confidence)
    const sorted = [...data.raw_memories].sort((a, b) => b.confidence - a.confidence);
    for (const m of sorted) {
      entries.push({ text: m.content, priority: m.confidence > 0.9 ? 2 : 1 });
    }

    // Sort by priority and fit within limit
    entries.sort((a, b) => b.priority - a.priority);

    const result: string[] = [];
    let currentBytes = 0;
    let truncated = false;

    for (const entry of entries) {
      // Measure bytes (UTF-8) rather than string.length (UTF-16 code units)
      // so the on-disk file never exceeds Hermes' byte-oriented limit.
      const additionBytes = byteLength(entry.text) + 1; // +1 for the § separator
      if (currentBytes + additionBytes > maxChars) {
        truncated = true;
        break;
      }
      result.push(entry.text);
      currentBytes += additionBytes;
    }

    return { content: result.join('§'), truncated };
  }

  private buildUserContent(data: MemoBridgeData, maxChars: number): string {
    const entries: string[] = [];

    for (const [k, v] of Object.entries(data.profile.identity)) {
      entries.push(`${k}: ${v}`);
    }
    for (const [k, v] of Object.entries(data.profile.preferences)) {
      entries.push(`${k}: ${v}`);
    }
    for (const [k, v] of Object.entries(data.profile.work_patterns)) {
      entries.push(`${k}: ${v}`);
    }

    let result = entries.join('§');
    // Byte-aware truncation: slice until the UTF-8 encoded length fits.
    // Using .slice() on a code-point boundary avoids splitting multi-byte chars.
    if (byteLength(result) > maxChars) {
      while (byteLength(result) > maxChars - 3 && result.length > 0) {
        result = result.slice(0, -1);
      }
      result += '...';
    }
    return result;
  }
}
