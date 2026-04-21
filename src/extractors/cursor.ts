/**
 * MemoBridge — Cursor Extractor
 *
 * Cursor memory structure:
 *   ~/.cursor/rules/*.md           — global rules
 *   <project>/.cursorrules         — project-level rules
 *   <project>/.cursor/rules/*.md   — project cursor rules
 */

import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { BaseExtractor, type DetectConfig } from './base.js';
import { scanAndRedact } from '../core/privacy.js';
import { log } from '../utils/logger.js';
import type { ExtractOptions, MemoBridgeData } from '../core/types.js';

export default class CursorExtractor extends BaseExtractor {
  readonly toolId = 'cursor' as const;
  readonly detectConfig: DetectConfig = {
    globalPaths: ['~/.cursor'],
    workspaceMarkers: ['.cursorrules', '.cursor'],
    description: 'Cursor IDE with .cursorrules',
  };

  /**
   * Return the path to the global ~/.cursor directory.
   * Subclasses (or tests) may override this to point elsewhere.
   */
  protected getGlobalDir(): string {
    return join(homedir(), '.cursor');
  }

  async extract(options: ExtractOptions): Promise<MemoBridgeData> {
    const cursorDir = this.getGlobalDir();
    const data = this.createEmptyData(cursorDir);

    if (options.verbose) log.info(`扫描 Cursor: ${cursorDir}`);

    // 1. Global rules ~/.cursor/rules/*.md
    const globalRulesDir = join(cursorDir, 'rules');
    if (await this.dirExists(globalRulesDir)) {
      const ruleFiles = await this.listMdFiles(globalRulesDir);
      for (const file of ruleFiles) {
        const content = await this.readFileSafe(join(globalRulesDir, file));
        if (content) {
          const { redacted_content } = scanAndRedact(content);
          this.parseRules(redacted_content, `global:${file}`, data);
        }
      }
    }

    // 2. Project .cursorrules (if workspace specified)
    if (options.workspace) {
      const projectRules = await this.readFileSafe(join(options.workspace, '.cursorrules'));
      if (projectRules) {
        const { redacted_content } = scanAndRedact(projectRules);
        this.parseRules(redacted_content, `project:.cursorrules`, data);
      }

      // 3. Project .cursor/rules/*.md
      const projectRulesDir = join(options.workspace, '.cursor', 'rules');
      if (await this.dirExists(projectRulesDir)) {
        const files = await this.listMdFiles(projectRulesDir);
        for (const file of files) {
          const content = await this.readFileSafe(join(projectRulesDir, file));
          if (content) {
            const { redacted_content } = scanAndRedact(content);
            this.parseRules(redacted_content, `project:${file}`, data);
          }
        }
      }
    }

    data.meta = this.createMeta('file', cursorDir,
      data.raw_memories.length + Object.keys(data.profile.preferences).length,
      this.countCategories(data));

    return data;
  }

  private parseRules(content: string, source: string, data: MemoBridgeData): void {
    const lines = content.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
        const text = trimmed.replace(/^[-*]\s+/, '');
        if (text.length < 5) continue;

        // Cursor rules are mostly preferences/instructions
        data.raw_memories.push({
          id: `cursor-${data.raw_memories.length}`,
          content: text,
          category: 'rule',
          source,
          confidence: 1.0,  // Rules are explicit
        });

        // Also extract as preferences
        data.profile.preferences[`cursor-rule-${Object.keys(data.profile.preferences).length}`] = text;
      } else if (trimmed.length > 15) {
        data.raw_memories.push({
          id: `cursor-${data.raw_memories.length}`,
          content: trimmed.slice(0, 300),
          category: 'instruction',
          source,
          confidence: 0.95,
        });
      }
    }
  }

  private async listMdFiles(dir: string): Promise<string[]> {
    try {
      const files = await readdir(dir);
      return files.filter(f => f.endsWith('.md') || f.endsWith('.mdc')).sort();
    } catch { return []; }
  }

  private countCategories(data: MemoBridgeData): number {
    const cats = new Set<string>();
    if (Object.keys(data.profile.preferences).length) cats.add('preferences');
    data.raw_memories.forEach(m => cats.add(m.category));
    return cats.size;
  }
}
