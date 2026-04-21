/**
 * MemoBridge — Hermes Agent Importer
 * Writes to: ~/.hermes/memories/MEMORY.md (≤2,200 chars) + USER.md (≤1,375 chars)
 * Automatically trims content to fit Hermes' strict character limits
 *
 * v0.2 — also writes back `extensions.hermes.skills` as empty directory
 * placeholders. Hermes skills are user-authored scripts that live in
 * ~/.hermes/skills/<name>/; the MemoBridge intermediate format only
 * preserves directory NAMES (not the scripts), so a fresh import into a
 * new Hermes install creates the folder skeleton with a README stub
 * telling the user what was there. Real cross-machine skill migration
 * requires copying the directories themselves and is a v0.3 feature.
 */

import { writeFile, mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { BaseImporter } from './base.js';
import { validateWritePath, isNotSymlink } from '../utils/security.js';
import type { MemoBridgeData, ImportOptions, ImportResult } from '../core/types.js';

const MEMORY_CHAR_LIMIT = 2200;
const USER_CHAR_LIMIT = 1375;

/**
 * Strict whitelist for Hermes skill directory names (P1-4).
 *
 * Must satisfy ALL of:
 *  - First char is [A-Za-z0-9_-]. Leading `.` is banned because `.git`,
 *    `.ssh` etc. could shadow sensitive hidden folders; a leading dot
 *    also trips file listing tools that hide dotfiles.
 *  - Subsequent chars are [A-Za-z0-9_.-].
 *  - Length 1..64 — long enough for real skill names, short enough that
 *    ENAMETOOLONG is impossible even when joined with a deep workspace
 *    path. Prevents buffer-like shenanigans with 4KB+ names.
 *
 * Consequently rejected: `/`, `\`, `.`, `..`, `\u0000`, `\n`, `\t`,
 * control chars, Windows reserved names (`CON`, `PRN`, `AUX`, `NUL`,
 * `COM1-9`, `LPT1-9` — all start with a letter so they'd pass syntax
 * but are forbidden by the separate reservedWindows check below).
 */
const SKILL_NAME_RE = /^[A-Za-z0-9_-][A-Za-z0-9_.\-]{0,63}$/;

/**
 * Windows reserved device names — case-insensitive match on the full
 * name (before any `.ext`). Creating a directory with one of these
 * names on Windows fails cryptically, and on cross-platform archives
 * it causes extraction errors. Easier to refuse upfront.
 */
const WINDOWS_RESERVED = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
]);

/** Return true if the given skill name passes the strict whitelist. */
function isValidSkillName(name: string): boolean {
  if (!SKILL_NAME_RE.test(name)) return false;
  const stem = name.split('.')[0]!.toUpperCase();
  if (WINDOWS_RESERVED.has(stem)) return false;
  return true;
}

/** Return the UTF-8 byte length of a string (matches on-disk file size). */
function byteLength(s: string): number {
  return Buffer.byteLength(s, 'utf-8');
}

export default class HermesImporter extends BaseImporter {
  readonly toolId = 'hermes' as const;

  listTargets(data: MemoBridgeData, options: ImportOptions): string[] {
    const hermesDir = options.workspace || join(homedir(), '.hermes');
    const memoriesDir = join(hermesDir, 'memories');
    const targets = [join(memoriesDir, 'MEMORY.md'), join(memoriesDir, 'USER.md')];

    // v0.2 — declare skill README stubs we may create, so backup/restore
    // can delete them on rollback. We conservatively list ALL declared
    // skills (not just "will be newly created"), because listTargets is
    // called BEFORE import — we don't yet know which already exist.
    // If a stub is pre-existing, backup records existed=true and restore
    // puts it back; if it's ours, backup records existed=false and
    // restore deletes it. Either way: safe.
    const skills = data.extensions?.hermes?.skills;
    if (Array.isArray(skills)) {
      for (const s of skills) {
        if (typeof s !== 'string') continue;
        const name = s.trim();
        // P1-4: same strict whitelist as writeBackSkills — keeps backup
        // `targets` in sync with the directories we'll actually touch.
        if (!name || !isValidSkillName(name)) continue;
        targets.push(join(hermesDir, 'skills', name, 'README.md'));
      }
    }
    return targets;
  }

  async import(data: MemoBridgeData, options: ImportOptions): Promise<ImportResult> {
    const hermesDir = validateWritePath(options.workspace || join(homedir(), '.hermes'));
    const memoriesDir = join(hermesDir, 'memories');
    const maxMemory = options.maxChars || MEMORY_CHAR_LIMIT;
    const warnings: string[] = [];

    const { content: memoryContent, truncated: memoryTruncated } =
      this.buildMemoryContent(data, maxMemory);
    const userContent = this.buildUserContent(data, USER_CHAR_LIMIT);

    if (options.dryRun) {
      return {
        success: true, method: 'file_write',
        items_imported: this.countImported(data), items_skipped: 0,
        output_path: memoriesDir,
        instructions: `[DRY RUN] 将写入:\n  MEMORY.md (${byteLength(memoryContent)}/${maxMemory} bytes)\n  USER.md (${byteLength(userContent)}/${USER_CHAR_LIMIT} bytes)`,
        warnings: memoryTruncated ? [`MEMORY.md 已达 ${maxMemory} 字节上限，部分记忆被裁剪`] : [],
      };
    }

    await mkdir(memoriesDir, { recursive: true });

    // Write MEMORY.md — Hermes uses § as separator
    const memoryPath = join(memoriesDir, 'MEMORY.md');
    if (!await isNotSymlink(memoryPath)) {
      throw new Error(`安全限制: ${memoryPath} 是符号链接，拒绝写入`);
    }
    await writeFile(memoryPath, memoryContent, 'utf-8');
    if (memoryTruncated) {
      warnings.push(`MEMORY.md 已达 ${maxMemory} 字节上限，部分记忆被裁剪`);
    }

    // Write USER.md
    const userPath = join(memoriesDir, 'USER.md');
    if (userContent.trim()) {
      if (!await isNotSymlink(userPath)) {
        throw new Error(`安全限制: ${userPath} 是符号链接，拒绝写入`);
      }
      await writeFile(userPath, userContent, 'utf-8');
    }

    // v0.2 — write back extensions.hermes.skills as empty directory
    // placeholders. See module header for the design rationale.
    const skillsCreated = await this.writeBackSkills(data, hermesDir, warnings);
    if (skillsCreated > 0) {
      warnings.push(`已创建 ${skillsCreated} 个 skills 目录占位（内容需手动补充）`);
    }

    return {
      success: true, method: 'file_write',
      items_imported: this.countImported(data), items_skipped: 0,
      output_path: memoriesDir, warnings,
    };
  }

  /**
   * Recreate skill directories declared in extensions.hermes.skills.
   *
   * Only creates directories that don't already exist — never touches
   * existing skill contents. Drops a README.md stub in newly-created dirs
   * so the user knows where it came from and what still needs to be done.
   *
   * Returns the number of directories created. Non-fatal failures are
   * recorded into the `warnings` array so the rest of the import can
   * proceed; losing the skill skeleton shouldn't fail a memory import.
   */
  private async writeBackSkills(
    data: MemoBridgeData,
    hermesDir: string,
    warnings: string[],
  ): Promise<number> {
    const skillsExt = data.extensions?.hermes?.skills;
    if (!Array.isArray(skillsExt) || skillsExt.length === 0) return 0;

    const skillsDir = join(hermesDir, 'skills');
    await mkdir(skillsDir, { recursive: true });

    const existing = new Set<string>();
    try {
      const entries = await readdir(skillsDir, { withFileTypes: true });
      for (const e of entries) if (e.isDirectory()) existing.add(e.name);
    } catch {
      // fresh install — skillsDir empty/absent, existing stays empty
    }

    let created = 0;
    for (const raw of skillsExt) {
      if (typeof raw !== 'string') continue;
      const name = raw.trim();
      // P1-4: strict whitelist (letters/digits/._-, 1..64, no leading dot,
      // no Windows reserved names). Rejects null bytes, newlines, tabs,
      // path separators, `.`/`..`, and over-long names that old
      // includes-based filtering missed.
      if (!name || !isValidSkillName(name)) {
        warnings.push(`跳过非法 skill 名: ${JSON.stringify(raw)}`);
        continue;
      }
      if (existing.has(name)) continue;

      const dir = join(skillsDir, name);
      try {
        await mkdir(dir, { recursive: true });
        const readme = [
          `# Skill: ${name}`,
          '',
          `This skill directory was recreated by MemoBridge during an import from`,
          `${data.meta.source.tool} on ${new Date().toISOString().slice(0, 10)}.`,
          '',
          `The source tool only recorded the skill's directory NAME, not its`,
          `implementation. Re-create the skill scripts here (or copy them from`,
          `the origin machine) to restore functionality.`,
          '',
        ].join('\n');
        await writeFile(join(dir, 'README.md'), readme, 'utf-8');
        created++;
      } catch (err) {
        warnings.push(`创建 skill 目录 ${name} 失败: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return created;
  }

  /**
   * Build MEMORY.md content within character limit.
   * Uses § as separator (Hermes convention).
   * Prioritizes: projects > knowledge summaries > high-confidence memories.
   *
   * Returns both the serialized content and a `truncated` flag indicating
   * whether any entries were dropped due to the char budget. The flag is
   * authoritative — don't infer truncation from `content.length >= maxChars`,
   * because the fitting loop always stops before the budget is exceeded.
   */
  private buildMemoryContent(data: MemoBridgeData, maxChars: number): { content: string; truncated: boolean } {
    const entries: Array<{ text: string; priority: number }> = [];

    // Projects (highest priority)
    for (const project of data.projects) {
      const text = `${project.name}: ${project.key_insights.slice(0, 2).join('; ')}`;
      entries.push({ text, priority: 3 });
    }

    // Knowledge summaries
    for (const section of data.knowledge) {
      const topics = section.items.map(i => i.topic).join(', ');
      entries.push({ text: `${section.title}: ${topics}`, priority: 2 });
    }

    // Feeds
    for (const feed of data.feeds) {
      entries.push({ text: `${feed.name} (${feed.schedule || '定期'})`, priority: 1 });
    }

    // Raw memories (sorted by confidence)
    const sorted = [...data.raw_memories].sort((a, b) => b.confidence - a.confidence);
    for (const m of sorted) {
      entries.push({ text: m.content, priority: m.confidence > 0.9 ? 2 : 1 });
    }

    // Sort by priority and fit within limit
    entries.sort((a, b) => b.priority - a.priority);

    const result: string[] = [];
    let currentBytes = 0;
    let truncated = false;

    for (const entry of entries) {
      // Measure bytes (UTF-8) rather than string.length (UTF-16 code units)
      // so the on-disk file never exceeds Hermes' byte-oriented limit.
      const additionBytes = byteLength(entry.text) + 1; // +1 for the § separator
      if (currentBytes + additionBytes > maxChars) {
        truncated = true;
        break;
      }
      result.push(entry.text);
      currentBytes += additionBytes;
    }

    return { content: result.join('§'), truncated };
  }

  private buildUserContent(data: MemoBridgeData, maxChars: number): string {
    const entries: string[] = [];

    for (const [k, v] of Object.entries(data.profile.identity)) {
      entries.push(`${k}: ${v}`);
    }
    for (const [k, v] of Object.entries(data.profile.preferences)) {
      entries.push(`${k}: ${v}`);
    }
    for (const [k, v] of Object.entries(data.profile.work_patterns)) {
      entries.push(`${k}: ${v}`);
    }

    let result = entries.join('§');
    // Byte-aware truncation: slice until the UTF-8 encoded length fits.
    // Using .slice() on a code-point boundary avoids splitting multi-byte chars.
    if (byteLength(result) > maxChars) {
      while (byteLength(result) > maxChars - 3 && result.length > 0) {
        result = result.slice(0, -1);
      }
      result += '...';
    }
    return result;
  }
}
