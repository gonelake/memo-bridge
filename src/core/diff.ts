/**
 * MemoBridge — Incremental diff (v0.2 M4)
 *
 * Given two MemoBridgeData snapshots, compute which raw_memories are NEW
 * or CHANGED vs. the previous baseline. Identity is content-addressable
 * via `content_hash` (populated by quality.scoreMemories), so this
 * module has no opinion about source-specific ids.
 *
 * Semantics:
 *   - NEW:     memory whose content_hash does not appear in the baseline
 *   - CHANGED: same id/source, different content_hash
 *              (best-effort — id semantics are tool-local, so "same id"
 *               is a weak signal. We only flag if source also matches.)
 *   - DELETED: present in baseline, absent now — NOT propagated in v0.2.
 *              (v0.3 will add delete propagation with user confirmation.)
 *
 * Out of scope for v0.2:
 *   - Diffing profile / knowledge / projects / feeds. Those are treated
 *     as "full snapshots" and pass through unchanged. v0.3 will introduce
 *     entity-ids for them so they can participate in incremental sync.
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, appendFile, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import type { MemoBridgeData, Memory, ToolId } from './types.js';
import { computeHash } from './quality.js';

// ============================================================
// Types
// ============================================================

export interface DiffStats {
  /** Memories present in `current` but not in `previous`. */
  new: number;
  /** Memories whose content changed (matched by id+source). */
  changed: number;
  /** Memories present in `previous` but not in `current`.
   *  v0.2 does NOT act on this — reported for visibility only. */
  deleted: number;
  /** Memories unchanged between snapshots. */
  unchanged: number;
}

export interface DiffResult {
  /** New + changed memories, in the order they appeared in `current`. */
  memories: Memory[];
  /** Stats for display / decision-making. */
  stats: DiffStats;
}

// ============================================================
// Public API
// ============================================================

/**
 * Compute the incremental delta of raw_memories between two snapshots.
 *
 * Identity key is `content_hash`. If a memory has no hash (legacy v0.1
 * data), we compute one on the fly so diff still works.
 *
 * Not symmetric: `current` is the source of truth for output order; only
 * its memories appear in `memories`.
 */
export function diffMemories(
  current: Memory[],
  previous: Memory[],
): DiffResult {
  const prevHashes = new Set<string>();
  const prevByIdSource = new Map<string, string>();

  for (const m of previous) {
    const hash = m.content_hash ?? computeHash(m.content);
    prevHashes.add(hash);
    if (m.id && m.source) {
      prevByIdSource.set(`${m.source}::${m.id}`, hash);
    }
  }

  const out: Memory[] = [];
  const stats: DiffStats = { new: 0, changed: 0, deleted: 0, unchanged: 0 };
  const currentHashes = new Set<string>();
  // De-dupe within `current` itself. When users merge memories from
  // multiple workspaces before diffing, the same logical memory can
  // appear more than once. We keep the first occurrence and skip the
  // rest silently (not counted as new / changed / unchanged — they
  // contribute no information beyond the first copy).
  const seenInCurrent = new Set<string>();

  for (const m of current) {
    const hash = m.content_hash ?? computeHash(m.content);
    if (seenInCurrent.has(hash)) continue;
    seenInCurrent.add(hash);
    currentHashes.add(hash);

    if (prevHashes.has(hash)) {
      stats.unchanged++;
      continue;
    }

    // Same (source, id) with a different hash ⇒ changed; else new.
    const key = m.id && m.source ? `${m.source}::${m.id}` : null;
    const prevHashAtKey = key ? prevByIdSource.get(key) : undefined;
    if (prevHashAtKey && prevHashAtKey !== hash) {
      stats.changed++;
    } else {
      stats.new++;
    }
    out.push(m);
  }

  for (const h of prevHashes) {
    if (!currentHashes.has(h)) stats.deleted++;
  }

  return { memories: out, stats };
}

/**
 * Apply a diff result to the memories of a MemoBridgeData snapshot.
 * Returns a NEW object — does not mutate inputs.
 *
 * Non-memory fields (profile/knowledge/projects/feeds/extensions) pass
 * through from `current` unchanged. This is deliberate: in v0.2 those
 * are "full snapshots" and incremental import replaces them wholesale.
 * meta.stats.total_memories is recomputed to reflect the reduced set.
 */
export function applyDiff(current: MemoBridgeData, diff: DiffResult): MemoBridgeData {
  return {
    ...current,
    raw_memories: diff.memories,
    meta: {
      ...current.meta,
      stats: {
        ...current.meta.stats,
        total_memories: diff.memories.length,
      },
    },
  };
}

/**
 * Compute a stable snapshot hash over a memory set — used to detect
 * "have we seen exactly this baseline before" at a higher level than
 * per-memory hashes. Order-insensitive (hashes are sorted before digest).
 */
export function computeSnapshotHash(memories: Memory[]): string {
  const hashes = memories
    .map(m => m.content_hash ?? computeHash(m.content))
    .sort();
  return createHash('sha256').update(hashes.join(',')).digest('hex').slice(0, 12);
}

// ============================================================
// Import ledger — which hashes has each tool already received?
// ============================================================

/**
 * Path to the per-tool "ledger" file that records every content_hash
 * successfully imported into `tool`. Lives under the backup/state root
 * so it's co-located with backups (same .memobridge/ tree).
 */
function ledgerPath(tool: ToolId, root: string): string {
  return join(root, '.memobridge', 'imported', `${tool}.hashes`);
}

/**
 * Load the set of content_hashes that have been imported into `tool`.
 * Returns an empty set if no ledger exists yet (first-time import).
 *
 * Format: one hash per line. Keeps the file diff-friendly and trivially
 * parseable without YAML/JSON dependencies.
 */
export async function loadImportLedger(tool: ToolId, root: string = process.cwd()): Promise<Set<string>> {
  try {
    const content = await readFile(ledgerPath(tool, root), 'utf-8');
    return new Set(
      content.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#')),
    );
  } catch {
    return new Set();
  }
}

/**
 * Append `hashes` to the ledger for `tool`. Idempotent at read time:
 * `loadImportLedger` deduplicates via a Set, so re-importing the same
 * hashes grows the file but does not change its semantic content.
 *
 * Concurrency: uses O_APPEND (`appendFile`) so that concurrent writers
 * — e.g. a cron-driven extract racing with a manual import — are
 * serialized at the kernel level and neither loses its new entries.
 * A prior read-merge-write implementation would deadlock-free but
 * silently drop writes when two processes overlapped.
 *
 * We intentionally never shrink this ledger — even if the user rolls
 * back an import, the ledger entry survives. That's a conservative
 * trade-off favoring "don't silently re-import" over "perfect mirror
 * of current state." If it becomes a real pain in practice, v0.3 can
 * add an explicit `memo-bridge ledger forget <tool>` command.
 */
export async function recordImported(
  tool: ToolId,
  hashes: Iterable<string>,
  root: string = process.cwd(),
): Promise<void> {
  // Drop empties up front. No work to do if the caller has nothing.
  const unique = new Set<string>();
  for (const h of hashes) {
    const trimmed = h?.trim();
    if (trimmed) unique.add(trimmed);
  }
  if (unique.size === 0) return;

  const path = ledgerPath(tool, root);
  await mkdir(dirname(path), { recursive: true });

  // If the ledger file does not exist yet, write the header first. We
  // deliberately do this as a separate step (rather than prepending to
  // the payload) so subsequent appenders can be pure O_APPEND writers
  // without worrying about duplicating the header.
  let needsHeader = false;
  try {
    await access(path);
  } catch {
    needsHeader = true;
  }
  if (needsHeader) {
    const header = `# MemoBridge import ledger — ${tool}\n# One content_hash per line. Safe to delete to reset incremental state.\n`;
    // Use writeFile with flag 'wx' so that if two processes both see
    // "no file" and race, only one wins the header write; the other
    // gets EEXIST and we swallow it (the file now exists — good).
    try {
      await writeFile(path, header, { encoding: 'utf-8', flag: 'wx' });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
  }

  // Atomic append — multiple concurrent appenders are serialized by the
  // kernel, so no entries are lost. Duplicate hashes across runs are
  // harmless: loadImportLedger reduces them through a Set.
  const body = [...unique].join('\n') + '\n';
  await appendFile(path, body, 'utf-8');
}

/**
 * Filter `data.raw_memories` to only include hashes NOT in the ledger.
 * Returns a new MemoBridgeData — does not mutate input. Non-memory fields
 * pass through unchanged (same rationale as applyDiff).
 */
export function filterAgainstLedger(
  data: MemoBridgeData,
  ledger: Set<string>,
): { data: MemoBridgeData; skipped: number } {
  const kept: Memory[] = [];
  // De-dupe within the incoming set as well: re-merged exports can
  // carry the same memory twice, and shipping duplicates through the
  // ledger write-back would pollute the MEMORY.md output. Count these
  // as "skipped" so the user sees them in the import summary.
  const seen = new Set<string>();
  let skipped = 0;
  for (const m of data.raw_memories) {
    const hash = m.content_hash ?? computeHash(m.content);
    if (ledger.has(hash) || seen.has(hash)) {
      skipped++;
      continue;
    }
    seen.add(hash);
    kept.push(m);
  }
  return {
    data: {
      ...data,
      raw_memories: kept,
      meta: {
        ...data.meta,
        stats: { ...data.meta.stats, total_memories: kept.length },
      },
    },
    skipped,
  };
}
