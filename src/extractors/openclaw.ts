/**
 * MemoBridge — OpenClaw Extractor
 *
 * OpenClaw memory structure:
 *   ~/.openclaw/workspace/MEMORY.md          — long-term memory (unlimited)
 *   ~/.openclaw/workspace/memory/YYYY-MM-DD.md — daily notes
 *   ~/.openclaw/workspace/DREAMS.md          — dreaming journal
 *   ~/.openclaw/workspace/SOUL.md            — personality
 *   ~/.openclaw/workspace/USER.md            — user profile (if exists)
 *   ~/.openclaw/workspace/AGENTS.md          — workspace instructions
 */

import { readFile, readdir } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import { BaseExtractor } from './base.js';
import { detectTool } from '../core/detector.js';
import { scanAndRedact } from '../core/privacy.js';
import { log } from '../utils/logger.js';
import type { DetectResult, ExtractOptions, MemoBridgeData } from '../core/types.js';

export default class OpenClawExtractor extends BaseExtractor {
  readonly toolId = 'openclaw' as const;

  async detect(): Promise<DetectResult> {
    return detectTool('openclaw');
  }

  async extract(options: ExtractOptions): Promise<MemoBridgeData> {
    const wsPath = options.workspace || join(homedir(), '.openclaw', 'workspace');
    const data = this.createEmptyData(wsPath);
    const dates: string[] = [];

    if (options.verbose) log.info(`扫描 OpenClaw 工作区: ${wsPath}`);

    // 1. MEMORY.md — long-term memory
    const memoryContent = await this.readFileSafe(join(wsPath, 'MEMORY.md'));
    if (memoryContent) {
      const { redacted_content } = scanAndRedact(memoryContent);
      this.parseMemoryMd(redacted_content, data);
    }

    // 2. USER.md — user profile
    const userContent = await this.readFileSafe(join(wsPath, 'USER.md'));
    if (userContent) {
      this.parseUserMd(userContent, data);
    }

    // 3. SOUL.md — personality (store as raw memory for portability)
    const soulContent = await this.readFileSafe(join(wsPath, 'SOUL.md'));
    if (soulContent) {
      data.raw_memories.push({
        id: 'openclaw-soul',
        content: soulContent.slice(0, 500),
        category: 'personality',
        source: 'SOUL.md',
        confidence: 1.0,
      });
    }

    // 4. Daily notes — memory/YYYY-MM-DD.md
    const memoryDir = join(wsPath, 'memory');
    const dailyFiles = await this.listMdFiles(memoryDir);
    for (const file of dailyFiles) {
      const dateMatch = basename(file, '.md').match(/^(20\d{2}-\d{2}-\d{2})$/);
      if (dateMatch) {
        dates.push(dateMatch[1]);
        const content = await this.readFileSafe(join(memoryDir, file));
        if (content) {
          const { redacted_content } = scanAndRedact(content);
          this.parseDailyNote(dateMatch[1], redacted_content, data);
        }
      }
    }

    // 5. DREAMS.md — dreaming journal (metadata only)
    const dreamsContent = await this.readFileSafe(join(wsPath, 'DREAMS.md'));
    if (dreamsContent) {
      data.raw_memories.push({
        id: 'openclaw-dreams',
        content: `OpenClaw Dreaming journal exists (${dreamsContent.length} chars)`,
        category: 'meta',
        source: 'DREAMS.md',
        confidence: 0.9,
      });
    }

    // Update stats
    const sortedDates = [...new Set(dates)].sort();
    data.meta = this.createMeta(
      'file', wsPath,
      this.countTotal(data),
      this.countCategories(data),
      sortedDates[0], sortedDates[sortedDates.length - 1],
    );

    return data;
  }

  private parseMemoryMd(content: string, data: MemoBridgeData): void {
    const lines = content.split('\n');
    for (const line of lines) {
      if (line.startsWith('- ') || line.startsWith('* ')) {
        const text = line.replace(/^[-*]\s+/, '').trim();
        if (text.length > 5) {
          data.raw_memories.push({
            id: `ocmem-${data.raw_memories.length}`,
            content: text,
            category: 'long_term',
            source: 'MEMORY.md',
            confidence: 0.9,
          });
        }
      }
    }
  }

  private parseUserMd(content: string, data: MemoBridgeData): void {
    const lines = content.split('\n');
    for (const line of lines) {
      const kvMatch = line.match(/^[-*]\s*(.+?)[:：]\s*(.+)/);
      if (kvMatch) {
        const key = kvMatch[1].trim().toLowerCase();
        const value = kvMatch[2].trim();
        if (key.includes('name') || key.includes('名') || key.includes('职业') || key.includes('role')) {
          data.profile.identity[kvMatch[1].trim()] = value;
        } else if (key.includes('prefer') || key.includes('偏好') || key.includes('style') || key.includes('风格')) {
          data.profile.preferences[kvMatch[1].trim()] = value;
        } else {
          data.profile.identity[kvMatch[1].trim()] = value;
        }
      }
    }
  }

  private parseDailyNote(date: string, content: string, data: MemoBridgeData): void {
    const lines = content.split('\n');
    for (const line of lines) {
      if (line.startsWith('- ') && line.length > 20) {
        const text = line.slice(2).trim();
        if (text.includes('§')) {
          // Hermes-style § separated entries
          for (const entry of text.split('§')) {
            if (entry.trim()) {
              data.raw_memories.push({
                id: `ocdaily-${data.raw_memories.length}`,
                content: entry.trim(),
                category: 'daily_note',
                source: `memory/${date}.md`,
                confidence: 0.8,
                created_at: date,
              });
            }
          }
        } else {
          data.raw_memories.push({
            id: `ocdaily-${data.raw_memories.length}`,
            content: text,
            category: 'daily_note',
            source: `memory/${date}.md`,
            confidence: 0.8,
            created_at: date,
          });
        }
      }
    }
  }

  private async readFileSafe(filePath: string): Promise<string | null> {
    try { return await readFile(filePath, 'utf-8'); } catch { return null; }
  }

  private async listMdFiles(dir: string): Promise<string[]> {
    try {
      const files = await readdir(dir);
      return files.filter(f => f.endsWith('.md')).sort();
    } catch { return []; }
  }

  private countTotal(data: MemoBridgeData): number {
    return data.raw_memories.length + data.projects.length +
      Object.keys(data.profile.identity).length +
      Object.keys(data.profile.preferences).length +
      data.knowledge.reduce((n, s) => n + s.items.length, 0);
  }

  private countCategories(data: MemoBridgeData): number {
    const cats = new Set<string>();
    if (Object.keys(data.profile.identity).length) cats.add('profile');
    data.raw_memories.forEach(m => cats.add(m.category));
    if (data.knowledge.length) cats.add('knowledge');
    return cats.size;
  }
}
