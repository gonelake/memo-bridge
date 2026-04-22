/**
 * MemoBridge — Instruction-based importers
 * For tools that don't support file-based import (ChatGPT, 豆包, Kimi)
 * Generates text instructions for the user to paste into the AI tool
 */

import { BaseImporter } from './base.js';
import { join } from 'node:path';
import type { MemoBridgeData, ImportOptions, ImportResult } from '../core/types.js';

/**
 * ChatGPT Importer — generates "please remember" instructions
 */
export class ChatGPTImporter extends BaseImporter {
  readonly toolId = 'chatgpt' as const;

  async import(data: MemoBridgeData, _options: ImportOptions): Promise<ImportResult> {
    const segments = this.buildImportSegments(data);
    const fullText = segments.join('\n\n---\n\n');

    return {
      success: true,
      method: 'instruction',
      items_imported: this.countImported(data),
      items_skipped: 0,
      clipboard_content: fullText,
      instructions: `请将以下 ${segments.length} 段内容逐段粘贴到 ChatGPT 对话中：\n\n${fullText}`,
    };
  }

  private buildImportSegments(data: MemoBridgeData): string[] {
    const segments: string[] = [];

    // Segment 1: User profile
    const profileLines: string[] = [];
    for (const [k, v] of Object.entries(data.profile.identity)) profileLines.push(`${k}: ${v}`);
    for (const [k, v] of Object.entries(data.profile.preferences)) profileLines.push(`${k}: ${v}`);
    for (const [k, v] of Object.entries(data.profile.work_patterns)) profileLines.push(`${k}: ${v}`);
    if (profileLines.length > 0) {
      segments.push(`请记住以下关于我的信息：\n${profileLines.map(l => `- ${l}`).join('\n')}`);
    }

    // Segment 2: Projects
    if (data.projects.length > 0) {
      const projLines = data.projects.map(p =>
        `- ${p.name}(${p.status === 'active' ? '进行中' : '已完成'}): ${p.key_insights.slice(0, 2).join('; ')}`
      );
      segments.push(`请记住我的项目背景：\n${projLines.join('\n')}`);
    }

    // Segment 3: Key knowledge
    if (data.knowledge.length > 0) {
      const knowledgeLines = data.knowledge.map(s =>
        `- ${s.title}: 已学 ${s.items.length} 个主题`
      );
      segments.push(`请记住我的学习进度：\n${knowledgeLines.join('\n')}`);
    }

    return segments;
  }
}

/**
 * 豆包 Importer — generates Chinese "请记住" instructions
 */
export class DouBaoImporter extends BaseImporter {
  readonly toolId = 'doubao' as const;

  async import(data: MemoBridgeData, _options: ImportOptions): Promise<ImportResult> {
    const text = this.buildImportText(data);

    return {
      success: true,
      method: 'instruction',
      items_imported: this.countImported(data),
      items_skipped: 0,
      clipboard_content: text,
      instructions: `请将以下内容粘贴到豆包对话中发送：\n\n${text}`,
    };
  }

  private buildImportText(data: MemoBridgeData): string {
    const lines: string[] = ['请记住以下关于我的所有信息，这些是从我之前使用的AI助手中导出的：\n'];

    // Identity
    const identity = Object.entries(data.profile.identity);
    if (identity.length > 0) {
      lines.push('【个人信息】');
      for (const [k, v] of identity) lines.push(`- ${k}：${v}`);
      lines.push('');
    }

    // Preferences
    const prefs = Object.entries(data.profile.preferences);
    if (prefs.length > 0) {
      lines.push('【偏好设定】');
      for (const [k, v] of prefs) lines.push(`- ${k}：${v}`);
      lines.push('');
    }

    // Projects
    if (data.projects.length > 0) {
      lines.push('【项目背景】');
      for (const p of data.projects) {
        lines.push(`- ${p.name}：${p.key_insights.slice(0, 2).join('；')}`);
      }
      lines.push('');
    }

    // Work patterns
    const patterns = Object.entries(data.profile.work_patterns);
    if (patterns.length > 0) {
      lines.push('【工作模式】');
      for (const [k, v] of patterns) lines.push(`- ${k}：${v}`);
    }

    lines.push('\n请确认你已记住以上所有信息。');
    return lines.join('\n');
  }
}

/**
 * Kimi Importer — generates context injection text
 * Kimi relies on long context, so we inject a structured context block
 */
export class KimiImporter extends BaseImporter {
  readonly toolId = 'kimi' as const;

  async import(data: MemoBridgeData, _options: ImportOptions): Promise<ImportResult> {
    const text = this.buildContextBlock(data);

    return {
      success: true,
      method: 'instruction',
      items_imported: this.countImported(data),
      items_skipped: 0,
      clipboard_content: text,
      instructions: `请在 Kimi 中新建对话，将以下内容作为第一条消息发送，\n这会让 Kimi 在整个对话中参考你的背景信息：\n\n${text}`,
    };
  }

  private buildContextBlock(data: MemoBridgeData): string {
    const text = this.flattenToText(data, 8000); // Kimi supports long context
    return `以下是关于我的背景信息，请在后续所有对话中参考这些信息来回答我的问题：\n\n${text}\n\n请确认你已理解以上背景信息，然后我们开始对话。`;
  }
}

/**
 * CodeBuddy Importer — writes to .memory/ directory
 */
export class CodeBuddyImporter extends BaseImporter {
  readonly toolId = 'codebuddy' as const;

  listTargets(_data: MemoBridgeData, options: ImportOptions): string[] {
    const wsPath = options.workspace || process.cwd();
    const today = new Date().toISOString().slice(0, 10);
    return [join(wsPath, '.memory', `imported-${today}.md`)];
  }

  async import(data: MemoBridgeData, options: ImportOptions): Promise<ImportResult> {
    const { writeFile, mkdir } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const { validateWritePath, validateContentSize, isNotSymlink } = await import('../utils/security.js');

    const wsPath = validateWritePath(options.workspace || process.cwd());
    const memoryDir = join(wsPath, '.memory');

    const today = new Date().toISOString().slice(0, 10);
    const targetPath = join(memoryDir, `imported-${today}.md`);
    const content = this.buildMemoryFile(data);
    validateContentSize(content);

    if (options.dryRun) {
      return {
        success: true, method: 'file_write',
        items_imported: this.countImported(data), items_skipped: 0,
        output_path: targetPath,
        instructions: `[DRY RUN] 将写入: ${targetPath}`,
      };
    }

    await mkdir(memoryDir, { recursive: true });
    if (!await isNotSymlink(targetPath)) {
      throw new Error(`安全限制: ${targetPath} 是符号链接，拒绝写入`);
    }
    await writeFile(targetPath, content, 'utf-8');

    return {
      success: true, method: 'file_write',
      items_imported: this.countImported(data), items_skipped: 0,
      output_path: targetPath,
    };
  }

  private buildMemoryFile(data: MemoBridgeData): string {
    const lines: string[] = [
      `# Imported via MemoBridge from ${data.meta.source.tool}`,
      `> Imported at ${new Date().toISOString()}`,
      '',
    ];

    lines.push(this.flattenToText(data));
    return lines.join('\n');
  }
}
