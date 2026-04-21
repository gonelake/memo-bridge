/**
 * MemoBridge — Config file loader (v0.2 M6)
 *
 * Loads user configuration from two locations in decreasing priority:
 *   1. Project-level:  ./.memobridge.yaml (walks up from cwd)
 *   2. Global:         ~/.config/memobridge/config.yaml
 *
 * CLI flags always win over config files — this module only supplies
 * defaults.
 *
 * Design principles:
 * - Never throws. A broken config is WORSE than no config when the user
 *   just wants to run a quick command. Malformed YAML produces a warning
 *   and falls back to the other layer (or defaults).
 * - Unknown keys are silently ignored (forward-compatible for future
 *   fields added in v0.3+).
 * - Validation is strict where it matters (regex patterns, positive
 *   integers) and lenient where it doesn't (unknown values are dropped).
 */

import { readFile, access } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { parse as parseYaml } from 'yaml';
import { log } from '../utils/logger.js';
import { validateWritePath } from '../utils/security.js';

// ============================================================
// Types
// ============================================================

/**
 * The resolved config seen by the rest of the codebase. Always fully
 * populated (no undefined keys) — callers can read fields directly
 * without optional chaining.
 */
export interface ResolvedConfig {
  defaultWorkspace?: string;
  privacy: {
    /** Valid user-supplied regex sources (invalid ones already filtered). */
    extraPatterns: string[];
  };
  quality: {
    /** Additional keywords to treat as importance signals. */
    importanceKeywords: string[];
  };
  backup: {
    /** How many backups per tool to keep when pruning. */
    retention: number;
  };
}

/** Shape of raw YAML before validation. All fields optional. */
interface RawConfig {
  default_workspace?: unknown;
  privacy?: { extra_patterns?: unknown };
  quality?: { importance_keywords?: unknown };
  backup?: { retention?: unknown };
}

// ============================================================
// Defaults
// ============================================================

export const DEFAULT_CONFIG: ResolvedConfig = Object.freeze({
  privacy: Object.freeze({ extraPatterns: [] as string[] }) as ResolvedConfig['privacy'],
  quality: Object.freeze({ importanceKeywords: [] as string[] }) as ResolvedConfig['quality'],
  backup: Object.freeze({ retention: 10 }) as ResolvedConfig['backup'],
});

// ============================================================
// Public API
// ============================================================

export interface LoadConfigOptions {
  /** Starting directory for the project config walk. Default: process.cwd(). */
  cwd?: string;
  /** Override home dir (for tests). Default: os.homedir(). */
  home?: string;
}

/**
 * Load config from global + project locations and merge. Project wins
 * over global on a per-field basis. Missing files silently skipped.
 *
 * Returns a fully-resolved config — callers never see `undefined`
 * for nested fields. Array fields (patterns/keywords) are the UNION of
 * global and project entries (so users can scope additions without
 * having to restate the global list).
 */
export async function loadConfig(options: LoadConfigOptions = {}): Promise<ResolvedConfig> {
  const cwd = options.cwd ?? process.cwd();
  const home = options.home ?? homedir();

  const globalPath = join(home, '.config', 'memobridge', 'config.yaml');
  const projectPath = await findProjectConfig(cwd);

  const globalRaw = await readRawConfig(globalPath);
  const projectRaw = projectPath ? await readRawConfig(projectPath) : null;

  return mergeConfigs(globalRaw, projectRaw);
}

// ============================================================
// Internal
// ============================================================

/**
 * Walk upward from `startDir` looking for .memobridge.yaml.
 * Stops at the filesystem root. Returns the first match or null.
 *
 * Walking upward (rather than only checking cwd) means a user inside a
 * subdirectory of their project still picks up the project config — same
 * behavior as git / npm / most dev tools.
 */
async function findProjectConfig(startDir: string): Promise<string | null> {
  let dir = resolve(startDir);
  // Guard against infinite loop on weird filesystems — cap at 32 levels.
  for (let i = 0; i < 32; i++) {
    const candidate = join(dir, '.memobridge.yaml');
    try {
      await access(candidate);
      return candidate;
    } catch {
      // not here — try parent
    }
    const parent = dirname(dir);
    if (parent === dir) return null; // reached root
    dir = parent;
  }
  return null;
}

async function readRawConfig(path: string): Promise<RawConfig | null> {
  let text: string;
  try {
    text = await readFile(path, 'utf-8');
  } catch {
    return null; // file absent — normal case
  }
  // Cap parse size — config files shouldn't be huge.
  if (text.length > 100_000) {
    log.warn(`配置文件过大，已忽略: ${path}`);
    return null;
  }
  try {
    const parsed = parseYaml(text, { maxAliasCount: 20 });
    if (parsed === null || parsed === undefined) return {}; // empty file
    if (typeof parsed !== 'object' || Array.isArray(parsed)) {
      log.warn(`配置文件根节点必须是对象: ${path}`);
      return null;
    }
    return parsed as RawConfig;
  } catch (err) {
    log.warn(`配置文件 YAML 解析失败 (${path}): ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

function mergeConfigs(global: RawConfig | null, project: RawConfig | null): ResolvedConfig {
  const out: ResolvedConfig = {
    defaultWorkspace: undefined,
    privacy: { extraPatterns: [] },
    quality: { importanceKeywords: [] },
    backup: { retention: DEFAULT_CONFIG.backup.retention },
  };

  applyLayer(out, global, 'global');
  applyLayer(out, project, 'project');

  return out;
}

function applyLayer(out: ResolvedConfig, raw: RawConfig | null, source: string): void {
  if (!raw) return;

  // default_workspace: last non-empty string wins.
  //
  // P0-2 fix: run a syntactic + forbidden-dir smoke test here (via
  // validateWritePath) so a malicious `.memobridge.yaml` can't steer the
  // importer at `/etc/...` or similar. validateWritePath doesn't require
  // the path to exist — it only checks for null bytes, resolves to abs,
  // and rejects well-known system dirs. A full write-time path check
  // still happens inside each importer; this is an early cheap guard.
  if (typeof raw.default_workspace === 'string' && raw.default_workspace.trim()) {
    const candidate = raw.default_workspace.trim();
    try {
      validateWritePath(candidate);
      out.defaultWorkspace = candidate;
    } catch (err) {
      log.warn(
        `[${source}] 拒绝 default_workspace: ${candidate} — ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  // privacy.extra_patterns: union (both layers contribute)
  const rawPatterns = raw.privacy?.extra_patterns;
  if (Array.isArray(rawPatterns)) {
    for (const p of rawPatterns) {
      if (typeof p !== 'string' || !p.trim()) continue;
      const src = p.trim();
      if (!isValidRegex(src)) {
        log.warn(`[${source}] 跳过非法正则表达式: ${src}`);
        continue;
      }
      if (!out.privacy.extraPatterns.includes(src)) {
        out.privacy.extraPatterns.push(src);
      }
    }
  }

  // quality.importance_keywords: union, case-insensitive dedupe
  const rawKw = raw.quality?.importance_keywords;
  if (Array.isArray(rawKw)) {
    const existingLower = new Set(out.quality.importanceKeywords.map(k => k.toLowerCase()));
    for (const k of rawKw) {
      if (typeof k !== 'string' || !k.trim()) continue;
      const kw = k.trim();
      const low = kw.toLowerCase();
      if (!existingLower.has(low)) {
        out.quality.importanceKeywords.push(kw);
        existingLower.add(low);
      }
    }
  }

  // backup.retention: positive integer, last layer wins
  const rawRetention = raw.backup?.retention;
  if (typeof rawRetention === 'number' && Number.isInteger(rawRetention) && rawRetention > 0) {
    out.backup.retention = rawRetention;
  } else if (rawRetention !== undefined) {
    log.warn(`[${source}] backup.retention 必须是正整数，已忽略: ${JSON.stringify(rawRetention)}`);
  }
}

function isValidRegex(src: string): boolean {
  try {
    new RegExp(src);
    return true;
  } catch {
    return false;
  }
}
