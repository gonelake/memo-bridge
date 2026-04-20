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

export default class HermesImporter extends BaseImporter {
  readonly toolId = 'hermes' as const;

  async import(data: MemoBridgeData, options: ImportOptions): Promise<ImportResult> {
    const hermesDir = validateWritePath(options.workspace || join(homedir(), '.hermes'));
    const memoriesDir = join(hermesDir, 'memories');
    const maxMemory = options.maxChars || MEMORY_CHAR_LIMIT;
    const warnings: string[] = [];

    const memoryContent = this.buildMemoryContent(data, maxMemory);
    const userContent = this.buildUserContent(data, USER_CHAR_LIMIT);

    if (options.dryRun) {
      return {
        success: true, method: 'file_write',
        items_imported: this.countImported(data), items_skipped: 0,
        output_path: memoriesDir,
        instructions: `[DRY RUN] 将写入:\n  MEMORY.md (${memoryContent.length}/${maxMemory} 字符)\n  USER.md (${userContent.length}/${USER_CHAR_LIMIT} 字符)`,
        warnings: memoryContent.length >= maxMemory ? ['MEMORY.md 已达字符上限，部分记忆被裁剪'] : [],
      };
    }

    await mkdir(memoriesDir, { recursive: true });

    // Write MEMORY.md — Hermes uses § as separator
    const memoryPath = join(memoriesDir, 'MEMORY.md');
    if (!await isNotSymlink(memoryPath)) {
      throw new Error(`安全限制: ${memoryPath} 是符号链接，拒绝写入`);
    }
    await writeFile(memoryPath, memoryContent, 'utf-8');
    if (memoryContent.length >= maxMemory) {
      warnings.push(`MEMORY.md 已达 ${maxMemory} 字符上限，部分记忆被裁剪`);
    }

    // Write USER.md
    const userPath = join(memoriesDir, 'USER.md');
    if (userContent.trim()) {
      await writeFile(userPath, userContent, 'utf-8');
    }

    return {
      success: true, method: 'file_write',
      items_imported: this.countImported(data), items_skipped: 0,
      output_path: memoriesDir, warnings,
    };
  }

  /**
   * Build MEMORY.md content within character limit
   * Uses § as separator (Hermes convention)
   * Prioritizes: projects > knowledge summaries > high-confidence memories
   */
  private buildMemoryContent(data: MemoBridgeData, maxChars: number): string {
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
    let currentLength = 0;

    for (const entry of entries) {
      const addition = entry.text + '§';
      if (currentLength + addition.length > maxChars) break;
      result.push(entry.text);
      currentLength += addition.length;
    }

    return result.join('§');
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
    if (result.length > maxChars) {
      result = result.slice(0, maxChars - 3) + '...';
    }
    return result;
  }
}
