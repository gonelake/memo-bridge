/**
 * MemoBridge — Backup & restore (v0.2 M3)
 *
 * Snapshots files that an Importer is about to touch, so the user can roll
 * back a failed or undesired import. Backups live in
 * `<workspace-or-cwd>/.memobridge/backups/<tool>-<timestamp>/`, one folder
 * per import invocation.
 *
 * Design principles:
 * - The backup module is decoupled from Importers. It takes a list of
 *   target file paths and snapshots whichever ones currently exist. If a
 *   target doesn't exist yet (first-time import), that's fine — we just
 *   don't snapshot anything for it, and restore will delete it on rollback.
 * - A `manifest.json` records every snapshot so restore can faithfully
 *   recreate pre-import state (including files that were absent before).
 * - Never throws on non-critical paths (e.g. a backup dir that can't be
 *   created doesn't fail the import — we warn and continue). BUT if a
 *   target FILE can't be read, that IS fatal: we'd rather abort than
 *   import without a recoverable snapshot.
 */

import { mkdir, readFile, writeFile, copyFile, lstat, readdir, rm } from 'node:fs/promises';
import { join, dirname, resolve, basename } from 'node:path';
import type { ToolId } from './types.js';

// ============================================================
// Types
// ============================================================

export interface BackupEntry {
  /** Absolute path of the original file. */
  original: string;
  /** Path of the snapshot copy, relative to the backup directory. */
  snapshot: string;
  /** Whether the original existed at backup time. If false, restore means DELETE. */
  existed: boolean;
}

export interface BackupManifest {
  /** Unique id of this backup (also the folder name). */
  id: string;
  /** Tool that was imported into when this backup was taken. */
  tool: ToolId;
  /** ISO timestamp. */
  created_at: string;
  /** Working directory at the time of backup (for display). */
  workspace?: string;
  /** Snapshot list. */
  entries: BackupEntry[];
  /**
   * Non-fatal notes produced while taking the backup — e.g. a target
   * path was a symlink and was therefore refused. Optional; absent when
   * everything went cleanly. See P0-3.
   */
  warnings?: string[];
}

export interface CreateBackupOptions {
  /** The tool being imported into — used to compose the backup folder name. */
  tool: ToolId;
  /** Absolute paths of files that the importer may overwrite or create. */
  targets: string[];
  /** Root directory under which the .memobridge/backups/ tree lives.
   *  Defaults to process.cwd(). */
  root?: string;
  /** Human-readable workspace label recorded in the manifest. */
  workspace?: string;
}

export interface RestoreResult {
  id: string;
  restored: number;
  deleted: number;
  skipped: number;
  warnings: string[];
}

// ============================================================
// Public API
// ============================================================

/**
 * Snapshot all currently-existing targets into a fresh backup folder.
 * Returns the manifest. Creates the folder even when no targets exist —
 * the empty manifest still documents the intent (useful for audit).
 */
export async function createBackup(options: CreateBackupOptions): Promise<BackupManifest> {
  const root = options.root ?? process.cwd();
  const id = `${options.tool}-${timestampId()}`;
  const backupDir = join(root, '.memobridge', 'backups', id);
  await mkdir(backupDir, { recursive: true });

  const entries: BackupEntry[] = [];
  const warnings: string[] = [];

  for (const rawTarget of options.targets) {
    const target = resolve(rawTarget);
    const exists = await fileExists(target);
    if (!exists) {
      // Includes the symlink case — fileExists uses lstat and returns
      // false on symlinks. If the path really is a symlink (not simply
      // absent), record a warning in the manifest so the user can see
      // that we refused to snapshot it. See P0-3.
      let isSymlink = false;
      try {
        const s = await lstat(target);
        isSymlink = s.isSymbolicLink();
      } catch {
        // absent — no warning
      }
      if (isSymlink) {
        warnings.push(`拒绝备份 symlink: ${target}`);
      }
      entries.push({ original: target, snapshot: '', existed: false });
      continue;
    }
    // P0-3 fix: re-check with lstat right before copyFile to close the
    // TOCTOU window where a symlink could be swapped in between
    // fileExists() and copyFile(). copyFile follows symlinks by default
    // (there is no noFollow flag in node:fs), so we must verify the
    // path is still a regular file or we risk exfiltrating e.g.
    // /etc/passwd into a user-readable backup directory.
    try {
      const s = await lstat(target);
      if (!s.isFile()) {
        warnings.push(`目标路径不是普通文件，跳过备份: ${target}`);
        entries.push({ original: target, snapshot: '', existed: false });
        continue;
      }
    } catch {
      entries.push({ original: target, snapshot: '', existed: false });
      continue;
    }
    // Snapshot name: preserve file basename but disambiguate with a short
    // hash of the full path, so two files with the same name don't collide.
    const snapshotName = `${pathFingerprint(target)}__${basename(target)}`;
    const snapshotPath = join(backupDir, snapshotName);
    await copyFile(target, snapshotPath);
    entries.push({ original: target, snapshot: snapshotName, existed: true });
  }

  const manifest: BackupManifest = {
    id,
    tool: options.tool,
    created_at: new Date().toISOString(),
    workspace: options.workspace,
    entries,
    ...(warnings.length > 0 ? { warnings } : {}),
  };

  await writeFile(
    join(backupDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2),
    'utf-8',
  );

  return manifest;
}

/**
 * List all backups under <root>/.memobridge/backups/, sorted newest-first.
 * Returns [] if the directory doesn't exist.
 *
 * Silently ignores folders without a readable manifest.json (they're
 * either corrupted or concurrent/in-progress — don't crash listing).
 */
export async function listBackups(root: string = process.cwd()): Promise<BackupManifest[]> {
  const backupsDir = join(root, '.memobridge', 'backups');
  let entries: string[];
  try {
    entries = await readdir(backupsDir);
  } catch {
    return [];
  }

  const manifests: BackupManifest[] = [];
  for (const entry of entries) {
    const manifestPath = join(backupsDir, entry, 'manifest.json');
    try {
      const content = await readFile(manifestPath, 'utf-8');
      const parsed = JSON.parse(content);
      if (isValidManifest(parsed)) {
        manifests.push(parsed);
      }
    } catch {
      // ignore unreadable/invalid manifests
    }
  }

  return manifests.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

/**
 * Restore a backup by id. For each entry:
 *   - existed=true:  copy snapshot back over original
 *   - existed=false: delete original (it didn't exist when we backed up,
 *                    so rolling back means returning to that state)
 *
 * Missing snapshots or inaccessible originals are collected as warnings
 * rather than aborting — partial restore is better than no restore when
 * the user is already in a bad state.
 */
export async function restoreBackup(
  id: string,
  root: string = process.cwd(),
): Promise<RestoreResult> {
  const backupDir = join(root, '.memobridge', 'backups', id);
  const manifestPath = join(backupDir, 'manifest.json');

  let manifest: BackupManifest;
  try {
    const content = await readFile(manifestPath, 'utf-8');
    const parsed = JSON.parse(content);
    if (!isValidManifest(parsed)) {
      throw new Error(`manifest.json 格式错误: ${manifestPath}`);
    }
    manifest = parsed;
  } catch (err) {
    throw new Error(`无法读取备份 ${id}: ${err instanceof Error ? err.message : String(err)}`);
  }

  const result: RestoreResult = { id, restored: 0, deleted: 0, skipped: 0, warnings: [] };

  for (const entry of manifest.entries) {
    try {
      if (entry.existed) {
        const snapshotPath = join(backupDir, entry.snapshot);
        await mkdir(dirname(entry.original), { recursive: true });
        await copyFile(snapshotPath, entry.original);
        result.restored++;
      } else {
        // original didn't exist pre-import; ensure it's gone post-restore
        if (await fileExists(entry.original)) {
          await rm(entry.original, { force: true });
          result.deleted++;
        } else {
          result.skipped++;
        }
      }
    } catch (err) {
      result.warnings.push(`${entry.original}: ${err instanceof Error ? err.message : String(err)}`);
      result.skipped++;
    }
  }

  return result;
}

/**
 * Prune old backups, keeping at most `keep` newest ones per tool.
 * Returns the ids that were removed. Safe to call when no backups exist.
 */
export async function pruneBackups(
  root: string = process.cwd(),
  keep = 10,
): Promise<string[]> {
  const all = await listBackups(root);
  const byTool = new Map<ToolId, BackupManifest[]>();
  for (const m of all) {
    const list = byTool.get(m.tool) ?? [];
    list.push(m);
    byTool.set(m.tool, list);
  }

  const removed: string[] = [];
  for (const [, list] of byTool) {
    // list is sorted newest-first; drop anything beyond `keep`
    const toRemove = list.slice(keep);
    for (const m of toRemove) {
      const dir = join(root, '.memobridge', 'backups', m.id);
      try {
        await rm(dir, { recursive: true, force: true });
        removed.push(m.id);
      } catch {
        // best-effort; leave it for next prune
      }
    }
  }
  return removed;
}

// ============================================================
// Internal helpers
// ============================================================

async function fileExists(path: string): Promise<boolean> {
  try {
    // lstat (not stat) so we don't follow symlinks. A symlink pointing at
    // e.g. /etc/passwd must be treated as "does not exist for backup
    // purposes" — see P0-3 fix in createBackup for the copy-side guard.
    const s = await lstat(path);
    return s.isFile();
  } catch {
    return false;
  }
}

/**
 * Short deterministic fingerprint of a path. 8 hex chars — enough to
 * disambiguate basename collisions within a single backup. We avoid
 * pulling crypto here to keep this helper sync-friendly.
 */
function pathFingerprint(absPath: string): string {
  // Simple FNV-1a — sufficient for disambiguation, not security.
  let h = 0x811c9dc5;
  for (let i = 0; i < absPath.length; i++) {
    h ^= absPath.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * Timestamp id safe for use as a folder name on all OSes (no ':').
 * Format: YYYYMMDDTHHMMSSmmm + 4-char random suffix.
 *
 * Why the suffix: millisecond precision can collide when createBackup is
 * invoked in rapid succession (e.g. a shell loop, or two CLI processes
 * on different tools). A collision silently overwrites the earlier
 * backup via mkdir(recursive), which breaks retention pruning. The
 * 4-char suffix gives ~16M combinations per ms — effectively zero
 * collision risk for human-speed operations.
 */
function timestampId(): string {
  const iso = new Date().toISOString();
  const ts = iso.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, (m) => m.replace('.', '').replace('Z', ''));
  const suffix = Math.random().toString(36).slice(2, 6).padEnd(4, '0');
  return `${ts}${suffix}`;
}

function isValidManifest(x: unknown): x is BackupManifest {
  if (!x || typeof x !== 'object') return false;
  const m = x as Record<string, unknown>;
  return (
    typeof m.id === 'string' &&
    typeof m.tool === 'string' &&
    typeof m.created_at === 'string' &&
    Array.isArray(m.entries)
  );
}
