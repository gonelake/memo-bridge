/**
 * MemoBridge — OpenClaw Importer
 * Writes to: MEMORY.md, memory/YYYY-MM-DD.md, USER.md
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { BaseImporter, readExistingFile } from './base.js';
import { validateWritePath, validateContentSize, isNotSymlink } from '../utils/security.js';
import type { MemoBridgeData, ImportOptions, ImportResult } from '../core/types.js';

export default class OpenClawImporter extends BaseImporter {
  readonly toolId = 'openclaw' as const;

  async import(data: MemoBridgeData, options: ImportOptions): Promise<ImportResult> {
    const wsPath = validateWritePath(options.workspace || join(homedir(), '.openclaw', 'workspace'));
    const warnings: string[] = [];

    if (options.dryRun) {
      return {
        success: true, method: 'file_write',
        items_imported: this.countImported(data), items_skipped: 0,
        output_path: wsPath,
        instructions: `[DRY RUN] 将写入:\n  ${join(wsPath, 'MEMORY.md')}\n  ${join(wsPath, 'USER.md')}`,
      };
    }

    await mkdir(wsPath, { recursive: true });

    // Write MEMORY.md — append or overwrite
    const memoryPath = join(wsPath, 'MEMORY.md');
    const memoryContent = this.buildMemoryMd(data);
    await this.writeOrAppend(memoryPath, memoryContent, options.overwrite);

    // Write USER.md
    const userPath = join(wsPath, 'USER.md');
    const userContent = this.buildUserMd(data);
    if (userContent.trim()) {
      await this.writeOrAppend(userPath, userContent, options.overwrite);
    }

    return {
      success: true, method: 'file_write',
      items_imported: this.countImported(data), items_skipped: 0,
      output_path: wsPath, warnings,
    };
  }

  private buildMemoryMd(data: MemoBridgeData): string {
    const lines: string[] = [`\n# Imported from ${data.meta.source.tool} via MemoBridge (${data.meta.exported_at})\n`];
    for (const m of data.raw_memories) {
      lines.push(`- ${m.content}`);
    }
    for (const section of data.knowledge) {
      lines.push(`\n## ${section.title}`);
      for (const item of section.items) {
        lines.push(`- ${item.topic}${item.date ? ` (${item.date})` : ''}`);
      }
    }
    for (const project of data.projects) {
      lines.push(`\n## ${project.name}`);
      for (const insight of project.key_insights) {
        lines.push(`- ${insight}`);
      }
    }
    return lines.join('\n') + '\n';
  }

  private buildUserMd(data: MemoBridgeData): string {
    const lines: string[] = [];
    for (const [k, v] of Object.entries(data.profile.identity)) lines.push(`- ${k}: ${v}`);
    for (const [k, v] of Object.entries(data.profile.preferences)) lines.push(`- ${k}: ${v}`);
    for (const [k, v] of Object.entries(data.profile.work_patterns)) lines.push(`- ${k}: ${v}`);
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
      const combined = existing + '\n---\n' + content;
      validateContentSize(combined);
      await writeFile(path, combined, 'utf-8');
    }
  }
}
