/**
 * MemoBridge — OpenClaw Importer
 * Writes to: MEMORY.md, memory/YYYY-MM-DD.md, USER.md
 *
 * v0.2 — also writes back extensions.openclaw.{soul,dreams}:
 *   - soul   → SOUL.md (restored literally; extraction captured ≤500 chars)
 *   - dreams → DREAMS.md (written as a STUB; only the char count was
 *              preserved during extraction, never the content itself)
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { BaseImporter, readExistingFile } from './base.js';
import { validateWritePath, validateContentSize, isNotSymlink } from '../utils/security.js';
import type { MemoBridgeData, ImportOptions, ImportResult } from '../core/types.js';

export default class OpenClawImporter extends BaseImporter {
  readonly toolId = 'openclaw' as const;

  listTargets(data: MemoBridgeData, options: ImportOptions): string[] {
    const wsPath = options.workspace || join(homedir(), '.openclaw', 'workspace');
    const targets = [join(wsPath, 'MEMORY.md'), join(wsPath, 'USER.md')];
    // v0.2 — extensions write-back
    if (typeof data.extensions?.openclaw?.soul === 'string') {
      targets.push(join(wsPath, 'SOUL.md'));
    }
    if (data.extensions?.openclaw?.dreams) {
      targets.push(join(wsPath, 'DREAMS.md'));
    }
    return targets;
  }

  async import(data: MemoBridgeData, options: ImportOptions): Promise<ImportResult> {
    const wsPath = validateWritePath(options.workspace || join(homedir(), '.openclaw', 'workspace'));
    const warnings: string[] = [];

    if (options.dryRun) {
      const dryParts: string[] = [
        join(wsPath, 'MEMORY.md'),
        join(wsPath, 'USER.md'),
      ];
      if (typeof data.extensions?.openclaw?.soul === 'string') {
        dryParts.push(join(wsPath, 'SOUL.md'));
      }
      if (data.extensions?.openclaw?.dreams) {
        dryParts.push(`${join(wsPath, 'DREAMS.md')} (stub)`);
      }
      return {
        success: true, method: 'file_write',
        items_imported: this.countImported(data), items_skipped: 0,
        output_path: wsPath,
        instructions: `[DRY RUN] 将写入:\n  ${dryParts.join('\n  ')}`,
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

    // v0.2 — SOUL.md: extraction captured up to 500 chars of the original,
    // so we can faithfully restore that (partial) content. We only write
    // when the soul field is present to avoid clobbering a richer local
    // SOUL.md the user may have authored directly.
    const soul = data.extensions?.openclaw?.soul;
    if (typeof soul === 'string' && soul.trim()) {
      const soulPath = join(wsPath, 'SOUL.md');
      if (!await isNotSymlink(soulPath)) {
        throw new Error(`安全限制: ${soulPath} 是符号链接，拒绝写入`);
      }
      const soulContent = this.buildSoulStub(soul, data);
      validateContentSize(soulContent);
      await writeFile(soulPath, soulContent, 'utf-8');
    }

    // v0.2 — DREAMS.md: the intermediate format only records the char
    // count of the origin's DREAMS.md, not its contents. Writing a stub
    // is honest about that — it tells the user "there WAS a dreams file
    // of N chars on the origin machine, but its content didn't cross the
    // bridge." This is better than silently producing a fake one.
    const dreams = data.extensions?.openclaw?.dreams;
    if (dreams && typeof dreams === 'object' && 'chars' in dreams) {
      const dreamsPath = join(wsPath, 'DREAMS.md');
      if (!await isNotSymlink(dreamsPath)) {
        throw new Error(`安全限制: ${dreamsPath} 是符号链接，拒绝写入`);
      }
      const stub = this.buildDreamsStub(dreams as { chars: unknown }, data);
      validateContentSize(stub);
      await writeFile(dreamsPath, stub, 'utf-8');
      warnings.push('DREAMS.md 仅回写为 stub（原始内容未保留在中间格式中）');
    }

    return {
      success: true, method: 'file_write',
      items_imported: this.countImported(data), items_skipped: 0,
      output_path: wsPath, warnings,
    };
  }

  private buildSoulStub(soul: string, data: MemoBridgeData): string {
    // Prepend a one-line header so future readers know this content came
    // through MemoBridge and may have been truncated at extraction time.
    const header = `<!-- Imported from ${data.meta.source.tool} via MemoBridge on ${new Date().toISOString().slice(0, 10)}. Extraction captures up to 500 chars; re-author this file if needed. -->\n\n`;
    return header + soul;
  }

  private buildDreamsStub(dreams: { chars: unknown }, data: MemoBridgeData): string {
    const chars = typeof dreams.chars === 'number' ? dreams.chars : 0;
    return [
      `<!-- Imported from ${data.meta.source.tool} via MemoBridge on ${new Date().toISOString().slice(0, 10)} -->`,
      '',
      '# DREAMS.md (stub)',
      '',
      `The origin machine's DREAMS.md was ${chars} characters, but the MemoBridge`,
      `intermediate format only preserves its metadata (char count), not its`,
      `contents. Populate this file manually or copy it from the origin.`,
      '',
    ].join('\n');
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
