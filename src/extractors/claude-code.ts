/**
 * MemoBridge — Claude Code Extractor
 *
 * Claude Code memory structure:
 *   ~/.claude/CLAUDE.md                  — global memory
 *   ~/.claude/projects/<hash>/CLAUDE.md  — per-project memory
 *   ~/.claude/memory.md                  — manual /memory saves
 *   <project>/CLAUDE.md                  — project-level instructions
 */

import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { BaseExtractor, type DetectConfig } from './base.js';
import { scanAndRedact } from '../core/privacy.js';
import { log } from '../utils/logger.js';
import type { ExtractOptions, MemoBridgeData } from '../core/types.js';

export default class ClaudeCodeExtractor extends BaseExtractor {
  readonly toolId = 'claude-code' as const;
  readonly detectConfig: DetectConfig = {
    globalPaths: ['~/.claude'],
    workspaceMarkers: ['CLAUDE.md'],
    description: 'Claude Code with CLAUDE.md project memory',
  };

  /**
   * Return the path to the global ~/.claude directory.
   * Subclasses (or tests) may override this to point elsewhere.
   */
  protected getGlobalDir(): string {
    return join(homedir(), '.claude');
  }

  async extract(options: ExtractOptions): Promise<MemoBridgeData> {
    const claudeDir = this.getGlobalDir();
    const data = this.createEmptyData(claudeDir);

    if (options.verbose) log.info(`扫描 Claude Code: ${claudeDir}`);

    // 1. Global CLAUDE.md
    const globalClaudeMd = await this.readFileSafe(join(claudeDir, 'CLAUDE.md'));
    if (globalClaudeMd) {
      const { redacted_content } = scanAndRedact(globalClaudeMd);
      this.parseClaudeMd(redacted_content, 'global', data);
    }

    // 2. Per-project CLAUDE.md files
    const projectsDir = join(claudeDir, 'projects');
    if (await this.dirExists(projectsDir)) {
      const projectDirs = await readdir(projectsDir).catch(() => [] as string[]);
      for (const dir of projectDirs) {
        const projectClaudeMd = await this.readFileSafe(join(projectsDir, dir, 'CLAUDE.md'));
        if (projectClaudeMd) {
          const { redacted_content } = scanAndRedact(projectClaudeMd);
          this.parseClaudeMd(redacted_content, `project:${dir}`, data);
        }
      }
    }

    // 3. memory.md (from /memory command)
    const memoryMd = await this.readFileSafe(join(claudeDir, 'memory.md'));
    if (memoryMd) {
      const { redacted_content } = scanAndRedact(memoryMd);
      this.parseClaudeMd(redacted_content, 'manual-memory', data);
    }

    // 4. Workspace-level CLAUDE.md (if workspace specified)
    if (options.workspace) {
      const wsClaudeMd = await this.readFileSafe(join(options.workspace, 'CLAUDE.md'));
      if (wsClaudeMd) {
        const { redacted_content } = scanAndRedact(wsClaudeMd);
        this.parseClaudeMd(redacted_content, `workspace:${options.workspace}`, data);
      }
    }

    data.meta = this.createMeta('file', claudeDir,
      data.raw_memories.length + Object.keys(data.profile.identity).length +
      Object.keys(data.profile.preferences).length, this.countCategories(data));

    return data;
  }

  private parseClaudeMd(content: string, source: string, data: MemoBridgeData): void {
    const lines = content.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      // Bullet points are memories
      if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
        const text = trimmed.replace(/^[-*]\s+/, '');
        if (text.length < 5) continue;

        // Try to classify into profile vs raw memory
        const lower = text.toLowerCase();
        if (lower.includes('prefer') || lower.includes('偏好') || lower.includes('always use') || lower.includes('never')) {
          data.profile.preferences[`claude-${Object.keys(data.profile.preferences).length}`] = text;
        } else if (lower.includes('project') || lower.includes('项目') || lower.includes('working on')) {
          data.raw_memories.push({
            id: `claude-${data.raw_memories.length}`,
            content: text, category: 'project', source, confidence: 0.9,
          });
        } else {
          data.raw_memories.push({
            id: `claude-${data.raw_memories.length}`,
            content: text, category: 'fact', source, confidence: 0.85,
          });
        }
      } else if (trimmed.length > 10) {
        // Non-bullet prose — likely instructions or context
        data.raw_memories.push({
          id: `claude-${data.raw_memories.length}`,
          content: trimmed.slice(0, 300), category: 'instruction', source, confidence: 0.8,
        });
      }
    }
  }

  private countCategories(data: MemoBridgeData): number {
    const cats = new Set<string>();
    if (Object.keys(data.profile.identity).length) cats.add('profile');
    if (Object.keys(data.profile.preferences).length) cats.add('preferences');
    data.raw_memories.forEach(m => cats.add(m.category));
    return cats.size;
  }
}
