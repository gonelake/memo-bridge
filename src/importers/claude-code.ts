/**
 * MemoBridge — Claude Code Importer
 * Writes to: CLAUDE.md (project-level or global)
 */

import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { BaseImporter, readExistingFile } from './base.js';
import { validateWritePath, validateContentSize, isNotSymlink } from '../utils/security.js';
import type { MemoBridgeData, ImportOptions, ImportResult } from '../core/types.js';

export default class ClaudeCodeImporter extends BaseImporter {
  readonly toolId = 'claude-code' as const;

  listTargets(_data: MemoBridgeData, options: ImportOptions): string[] {
    const rawPath = options.workspace
      ? join(options.workspace, 'CLAUDE.md')
      : join(homedir(), '.claude', 'CLAUDE.md');
    return [rawPath];
  }

  async import(data: MemoBridgeData, options: ImportOptions): Promise<ImportResult> {
    const rawPath = options.workspace
      ? join(options.workspace, 'CLAUDE.md')
      : join(homedir(), '.claude', 'CLAUDE.md');
    const targetPath = validateWritePath(rawPath);

    const content = this.buildClaudeMd(data);
    validateContentSize(content);

    if (options.dryRun) {
      return {
        success: true, method: 'file_write',
        items_imported: this.countImported(data), items_skipped: 0,
        output_path: targetPath,
        instructions: `[DRY RUN] 将${options.overwrite ? '覆盖' : '追加'}写入: ${targetPath}`,
      };
    }

    await this.writeOrAppend(targetPath, content, options.overwrite);

    return {
      success: true, method: 'file_write',
      items_imported: this.countImported(data), items_skipped: 0,
      output_path: targetPath,
    };
  }

  private buildClaudeMd(data: MemoBridgeData): string {
    const lines: string[] = [
      `\n# Imported via MemoBridge from ${data.meta.source.tool} (${new Date().toISOString().slice(0, 10)})`,
      '',
    ];

    // User context
    const profileEntries = [
      ...Object.entries(data.profile.identity),
      ...Object.entries(data.profile.preferences),
      ...Object.entries(data.profile.work_patterns),
    ];
    if (profileEntries.length > 0) {
      lines.push('## User Context');
      for (const [k, v] of profileEntries) {
        lines.push(`- ${k}: ${v}`);
      }
      lines.push('');
    }

    // Project context
    if (data.projects.length > 0) {
      lines.push('## Projects');
      for (const p of data.projects) {
        lines.push(`- **${p.name}** (${p.status}): ${p.key_insights.slice(0, 2).join('; ')}`);
      }
      lines.push('');
    }

    // Key facts
    const topFacts = data.raw_memories
      .filter(m => m.confidence >= 0.8)
      .slice(0, 15);
    if (topFacts.length > 0) {
      lines.push('## Key Facts');
      for (const m of topFacts) {
        lines.push(`- ${m.content}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  private async writeOrAppend(path: string, content: string, overwrite?: boolean): Promise<void> {
    if (!await isNotSymlink(path)) {
      throw new Error(`安全限制: ${path} 是符号链接，拒绝写入`);
    }
    if (overwrite) {
      // Overwrite still needs to be validated in case this helper is
      // reached through a path that didn't pre-check (e.g. a future
      // caller). cursor.ts follows the same pattern for symmetry.
      validateContentSize(content);
      await writeFile(path, content, 'utf-8');
    } else {
      const existing = await readExistingFile(path);
      const combined = existing + '\n' + content;
      validateContentSize(combined);
      await writeFile(path, combined, 'utf-8');
    }
  }
}
