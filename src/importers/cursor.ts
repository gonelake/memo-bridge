/**
 * MemoBridge — Cursor Importer
 * Writes to: .cursorrules (project-level)
 */

import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BaseImporter, readExistingFile } from './base.js';
import { validateWritePath, validateContentSize, isNotSymlink } from '../utils/security.js';
import type { MemoBridgeData, ImportOptions, ImportResult } from '../core/types.js';

export default class CursorImporter extends BaseImporter {
  readonly toolId = 'cursor' as const;

  listTargets(_data: MemoBridgeData, options: ImportOptions): string[] {
    if (!options.workspace) return [];
    return [join(options.workspace, '.cursorrules')];
  }

  async import(data: MemoBridgeData, options: ImportOptions): Promise<ImportResult> {
    if (!options.workspace) {
      return {
        success: false, method: 'file_write', items_imported: 0, items_skipped: 0,
        instructions: '请使用 --workspace 指定项目路径，Cursor 的 .cursorrules 是项目级文件。',
      };
    }

    const targetPath = validateWritePath(join(options.workspace, '.cursorrules'));
    const content = this.buildCursorrules(data);

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

  private buildCursorrules(data: MemoBridgeData): string {
    const lines: string[] = [
      `\n# Imported via MemoBridge from ${data.meta.source.tool}`,
      '',
    ];

    // Preferences as rules
    for (const [k, v] of Object.entries(data.profile.preferences)) {
      lines.push(`- ${k}: ${v}`);
    }

    // Work patterns
    for (const [k, v] of Object.entries(data.profile.work_patterns)) {
      lines.push(`- ${k}: ${v}`);
    }

    // Key rules from raw memories
    const rules = data.raw_memories
      .filter(m => m.category === 'rule' || m.category === 'instruction')
      .slice(0, 10);
    for (const r of rules) {
      lines.push(`- ${r.content}`);
    }

    return lines.join('\n') + '\n';
  }

  private async writeOrAppend(path: string, content: string, overwrite?: boolean): Promise<void> {
    if (!await isNotSymlink(path)) {
      throw new Error(`安全限制: ${path} 是符号链接，拒绝写入`);
    }
    if (overwrite) {
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
