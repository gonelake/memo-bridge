/**
 * MemoBridge — Hermes Agent Extractor
 *
 * Hermes memory structure:
 *   ~/.hermes/memories/MEMORY.md   — long-term memory (≤2,200 chars)
 *   ~/.hermes/memories/USER.md     — user profile (≤1,375 chars)
 *   ~/.hermes/state.db             — SQLite session history (FTS5)
 *   ~/.hermes/config.yaml          — configuration
 *   ~/.hermes/skills/              — auto-generated skills
 *
 * Memory format: entries separated by § (section sign)
 * Capacity header: "MEMORY [67% — 1,474/2,200 chars]"
 */

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { BaseExtractor } from './base.js';
import { detectTool } from '../core/detector.js';
import { scanAndRedact } from '../core/privacy.js';
import { log } from '../utils/logger.js';
import type { DetectResult, ExtractOptions, MemoBridgeData } from '../core/types.js';

export default class HermesExtractor extends BaseExtractor {
  readonly toolId = 'hermes' as const;

  async detect(): Promise<DetectResult> {
    return detectTool('hermes');
  }

  async extract(options: ExtractOptions): Promise<MemoBridgeData> {
    const hermesDir = options.workspace || join(homedir(), '.hermes');
    const memoriesDir = join(hermesDir, 'memories');
    const data = this.createEmptyData(hermesDir);

    if (options.verbose) log.info(`扫描 Hermes Agent: ${hermesDir}`);

    // 1. MEMORY.md — bounded long-term memory
    const memoryContent = await this.readFileSafe(join(memoriesDir, 'MEMORY.md'));
    if (memoryContent) {
      const { redacted_content } = scanAndRedact(memoryContent);
      this.parseHermesMemory(redacted_content, data);
    }

    // 2. USER.md — user profile
    const userContent = await this.readFileSafe(join(memoriesDir, 'USER.md'));
    if (userContent) {
      this.parseHermesUser(userContent, data);
    }

    // 3. Skills directory — auto-generated skills
    const skillsDir = join(hermesDir, 'skills');
    const skills = await this.listDirs(skillsDir);
    if (skills.length > 0) {
      data.raw_memories.push({
        id: 'hermes-skills',
        content: `Hermes auto-generated skills: ${skills.join(', ')}`,
        category: 'skills',
        source: '~/.hermes/skills/',
        confidence: 1.0,
      });
    }

    // 4. config.yaml — extract model and platform info
    const configContent = await this.readFileSafe(join(hermesDir, 'config.yaml'));
    if (configContent) {
      this.parseConfig(configContent, data);
    }

    // Update stats
    data.meta = this.createMeta(
      'file', hermesDir,
      this.countTotal(data),
      this.countCategories(data),
    );

    return data;
  }

  /**
   * Parse Hermes MEMORY.md — entries separated by § or newlines
   */
  private parseHermesMemory(content: string, data: MemoBridgeData): void {
    // Hermes stores entries separated by § (section sign)
    const entries = content.includes('§')
      ? content.split('§').map(e => e.trim()).filter(Boolean)
      : content.split('\n').filter(l => l.trim().length > 5);

    for (const entry of entries) {
      // Skip capacity headers like "MEMORY [67% — 1,474/2,200 chars]"
      if (entry.match(/^(MEMORY|USER)\s*\[/)) continue;
      if (entry.startsWith('=')) continue;

      const cleaned = entry.replace(/^[-*]\s+/, '').trim();
      if (cleaned.length < 5) continue;

      // Try to classify
      const category = this.classifyEntry(cleaned);

      data.raw_memories.push({
        id: `hermes-mem-${data.raw_memories.length}`,
        content: cleaned,
        category,
        source: 'MEMORY.md',
        confidence: 0.9,
      });

      // Also extract into profile if it looks like identity/preference info
      this.tryExtractProfile(cleaned, data);
    }
  }

  private parseHermesUser(content: string, data: MemoBridgeData): void {
    const entries = content.includes('§')
      ? content.split('§').map(e => e.trim()).filter(Boolean)
      : content.split('\n').filter(l => l.trim().length > 3);

    for (const entry of entries) {
      if (entry.match(/^(USER|PROFILE)\s*\[/) || entry.startsWith('=')) continue;

      const cleaned = entry.replace(/^[-*]\s+/, '').trim();
      if (cleaned.length < 3) continue;

      // USER.md is all about user preferences and identity
      const kvMatch = cleaned.match(/^(.+?)[:：]\s*(.+)/);
      if (kvMatch) {
        const key = kvMatch[1].trim();
        const value = kvMatch[2].trim();
        const lowerKey = key.toLowerCase();

        if (lowerKey.includes('prefer') || lowerKey.includes('style') || lowerKey.includes('偏好') || lowerKey.includes('风格')) {
          data.profile.preferences[key] = value;
        } else {
          data.profile.identity[key] = value;
        }
      } else {
        data.profile.preferences[`用户特征-${Object.keys(data.profile.preferences).length}`] = cleaned;
      }
    }
  }

  private parseConfig(content: string, data: MemoBridgeData): void {
    // Extract model info
    const modelMatch = content.match(/model:\s*["']?(.+?)["']?\s*$/m);
    if (modelMatch) {
      data.profile.work_patterns['Hermes 模型'] = modelMatch[1];
    }

    // Extract platforms
    const platformMatches = content.match(/(?:telegram|discord|slack|whatsapp|signal|email):\s*\n/gi);
    if (platformMatches) {
      data.profile.work_patterns['Hermes 平台'] = platformMatches
        .map(p => p.replace(/:\s*\n/, '').trim())
        .join(', ');
    }
  }

  private classifyEntry(text: string): string {
    const lower = text.toLowerCase();
    if (lower.includes('project') || lower.includes('项目') || lower.includes('repo')) return 'project';
    if (lower.includes('prefer') || lower.includes('偏好') || lower.includes('likes')) return 'preference';
    if (lower.includes('runs') || lower.includes('uses') || lower.includes('使用')) return 'environment';
    if (lower.includes('workflow') || lower.includes('流程')) return 'workflow';
    return 'fact';
  }

  private tryExtractProfile(text: string, data: MemoBridgeData): void {
    const kvMatch = text.match(/^(.+?)[:：]\s*(.+)/);
    if (!kvMatch) return;

    const key = kvMatch[1].trim();
    const value = kvMatch[2].trim();
    const lowerKey = key.toLowerCase();

    if (lowerKey.includes('os') || lowerKey.includes('machine') || lowerKey.includes('system') ||
        lowerKey.includes('docker') || lowerKey.includes('shell') || lowerKey.includes('editor')) {
      data.profile.work_patterns[key] = value;
    }
  }

  private async readFileSafe(filePath: string): Promise<string | null> {
    try { return await readFile(filePath, 'utf-8'); } catch { return null; }
  }

  private async listDirs(dir: string): Promise<string[]> {
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      return entries.filter(e => e.isDirectory()).map(e => e.name);
    } catch { return []; }
  }

  private countTotal(data: MemoBridgeData): number {
    return data.raw_memories.length +
      Object.keys(data.profile.identity).length +
      Object.keys(data.profile.preferences).length +
      Object.keys(data.profile.work_patterns).length;
  }

  private countCategories(data: MemoBridgeData): number {
    const cats = new Set<string>();
    if (Object.keys(data.profile.identity).length) cats.add('profile');
    if (Object.keys(data.profile.preferences).length) cats.add('preferences');
    data.raw_memories.forEach(m => cats.add(m.category));
    return cats.size;
  }
}
