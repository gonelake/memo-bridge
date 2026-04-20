/**
 * MemoBridge — Importer base class
 */

import type { Importer, ToolId, MemoBridgeData, ImportOptions, ImportResult } from '../core/types.js';
import { TOOL_NAMES } from '../core/types.js';

export abstract class BaseImporter implements Importer {
  abstract readonly toolId: ToolId;

  get toolName(): string {
    return TOOL_NAMES[this.toolId];
  }

  abstract import(data: MemoBridgeData, options: ImportOptions): Promise<ImportResult>;

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
      Object.keys(data.profile.preferences).length;
  }
}
