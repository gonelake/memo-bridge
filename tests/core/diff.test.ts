import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  diffMemories,
  applyDiff,
  computeSnapshotHash,
  loadImportLedger,
  recordImported,
  filterAgainstLedger,
} from '../../src/core/diff.js';
import { scoreMemories, computeHash } from '../../src/core/quality.js';
import type { Memory, MemoBridgeData } from '../../src/core/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mem(overrides: Partial<Memory> = {}): Memory {
  return {
    id: 'm1',
    content: 'baseline',
    category: 'general',
    source: 'test',
    confidence: 0.8,
    ...overrides,
  };
}

function makeData(memories: Memory[]): MemoBridgeData {
  return {
    meta: {
      version: '0.1',
      exported_at: '2026-04-20T00:00:00.000Z',
      source: { tool: 'codebuddy', extraction_method: 'file' },
      stats: { total_memories: memories.length, categories: 1 },
    },
    profile: { identity: {}, preferences: {}, work_patterns: {} },
    knowledge: [],
    projects: [],
    feeds: [],
    raw_memories: memories,
  };
}

/** Build a pair of scored Memory[] (ensures content_hash is present). */
function scored(...contents: string[]): Memory[] {
  const d = makeData(contents.map((c, i) => mem({ id: `m${i}`, content: c })));
  scoreMemories(d);
  return d.raw_memories;
}

let testRoot: string;
beforeEach(async () => {
  testRoot = await mkdir(
    join(tmpdir(), `memobridge-diff-${Date.now()}-${Math.random().toString(36).slice(2)}`),
    { recursive: true },
  ) as string;
});
afterEach(async () => {
  await rm(testRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// diffMemories
// ---------------------------------------------------------------------------

describe('diffMemories', () => {
  it('returns all memories as new when previous is empty', () => {
    const current = scored('a', 'b');
    const diff = diffMemories(current, []);
    expect(diff.stats.new).toBe(2);
    expect(diff.stats.unchanged).toBe(0);
    expect(diff.memories).toHaveLength(2);
  });

  it('returns [] when nothing changed', () => {
    const prev = scored('a', 'b');
    const curr = scored('a', 'b');
    const diff = diffMemories(curr, prev);
    expect(diff.stats.unchanged).toBe(2);
    expect(diff.stats.new).toBe(0);
    expect(diff.memories).toHaveLength(0);
  });

  it('detects truly new memories by content_hash', () => {
    const prev = scored('a', 'b');
    const curr = scored('a', 'b', 'c');
    const diff = diffMemories(curr, prev);
    expect(diff.stats.new).toBe(1);
    expect(diff.stats.unchanged).toBe(2);
    expect(diff.memories[0]!.content).toBe('c');
  });

  it('classifies "same id+source, different content" as CHANGED (not new)', () => {
    // Same logical memory (id/source match) with edited content
    const prev = [
      mem({ id: 'memX', source: 'file.md', content: 'old text' }),
    ];
    const curr = [
      mem({ id: 'memX', source: 'file.md', content: 'new text' }),
    ];
    scoreMemories(makeData(prev));
    scoreMemories(makeData(curr));

    const diff = diffMemories(curr, prev);
    expect(diff.stats.changed).toBe(1);
    expect(diff.stats.new).toBe(0);
    expect(diff.memories).toHaveLength(1);
  });

  it('reports deleted count but does NOT propagate deletes in v0.2', () => {
    const prev = scored('a', 'b', 'c');
    const curr = scored('a');
    const diff = diffMemories(curr, prev);
    expect(diff.stats.deleted).toBe(2);
    // Output contains only what's in current
    expect(diff.memories).toHaveLength(0);
  });

  it('computes hash on the fly for legacy memories without content_hash', () => {
    const prev = [mem({ content: 'legacy-v0.1' })]; // no hash field
    const curr = [mem({ content: 'legacy-v0.1' })];
    const diff = diffMemories(curr, prev);
    expect(diff.stats.unchanged).toBe(1);
  });

  it('preserves order from current snapshot', () => {
    const prev = scored('existing');
    const curr = scored('existing', 'first-new', 'second-new');
    const diff = diffMemories(curr, prev);
    expect(diff.memories.map(m => m.content)).toEqual(['first-new', 'second-new']);
  });

  it('de-dupes within current by content_hash (multi-workspace merge case)', () => {
    // Regression for P1-3: users who merge raw_memories from several
    // workspaces can pass the same logical memory twice. Before this
    // fix both copies would flow through into MEMORY.md. Now only the
    // first is emitted; the repeat is silently dropped — not counted
    // as new, changed, unchanged, or anything.
    const hA = computeHash('A');
    const [a1, a1Dup, b1] = [
      mem({ id: 'a', content: 'A', content_hash: hA }),
      mem({ id: 'a-again', content: 'A', content_hash: hA }),
      mem({ id: 'b', content: 'B' }),
    ];
    scoreMemories(makeData([a1, a1Dup, b1]));
    const diff = diffMemories([a1, a1Dup, b1], []);
    expect(diff.memories).toHaveLength(2);
    expect(diff.stats.new).toBe(2);
    expect(diff.stats.unchanged).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// applyDiff
// ---------------------------------------------------------------------------

describe('applyDiff', () => {
  it('returns a new object with reduced raw_memories', () => {
    const data = makeData(scored('a', 'b', 'c'));
    const diff = { memories: data.raw_memories.slice(0, 1), stats: { new: 1, changed: 0, deleted: 0, unchanged: 2 } };
    const out = applyDiff(data, diff);
    expect(out).not.toBe(data);
    expect(out.raw_memories).toHaveLength(1);
    expect(data.raw_memories).toHaveLength(3); // original untouched
  });

  it('recomputes meta.stats.total_memories', () => {
    const data = makeData(scored('a', 'b', 'c'));
    const diff = { memories: [], stats: { new: 0, changed: 0, deleted: 3, unchanged: 0 } };
    const out = applyDiff(data, diff);
    expect(out.meta.stats.total_memories).toBe(0);
  });

  it('passes profile/knowledge/projects/feeds through unchanged', () => {
    const data: MemoBridgeData = {
      ...makeData([]),
      profile: { identity: { name: 'Alice' }, preferences: {}, work_patterns: {} },
      knowledge: [{ title: 'AI', items: [{ topic: 'LLM' }] }],
      projects: [{ name: 'P', status: 'active', key_insights: ['i'] }],
      feeds: [{ name: 'F' }],
    };
    const out = applyDiff(data, { memories: [], stats: { new: 0, changed: 0, deleted: 0, unchanged: 0 } });
    expect(out.profile).toEqual(data.profile);
    expect(out.knowledge).toEqual(data.knowledge);
    expect(out.projects).toEqual(data.projects);
    expect(out.feeds).toEqual(data.feeds);
  });
});

// ---------------------------------------------------------------------------
// computeSnapshotHash
// ---------------------------------------------------------------------------

describe('computeSnapshotHash', () => {
  it('is deterministic for identical content sets', () => {
    const s1 = computeSnapshotHash(scored('a', 'b', 'c'));
    const s2 = computeSnapshotHash(scored('a', 'b', 'c'));
    expect(s1).toBe(s2);
  });

  it('is order-insensitive', () => {
    const s1 = computeSnapshotHash(scored('a', 'b', 'c'));
    const s2 = computeSnapshotHash(scored('c', 'a', 'b'));
    expect(s1).toBe(s2);
  });

  it('differs when content set differs', () => {
    const s1 = computeSnapshotHash(scored('a', 'b'));
    const s2 = computeSnapshotHash(scored('a', 'c'));
    expect(s1).not.toBe(s2);
  });

  it('returns a 12-char hex string', () => {
    const h = computeSnapshotHash(scored('a'));
    expect(h).toMatch(/^[0-9a-f]{12}$/);
  });
});

// ---------------------------------------------------------------------------
// Import ledger
// ---------------------------------------------------------------------------

describe('loadImportLedger', () => {
  it('returns empty set when no ledger file exists', async () => {
    const ledger = await loadImportLedger('hermes', testRoot);
    expect(ledger.size).toBe(0);
  });

  it('reads hashes from a written ledger', async () => {
    await recordImported('hermes', ['aaa111', 'bbb222'], testRoot);
    const ledger = await loadImportLedger('hermes', testRoot);
    expect(ledger.has('aaa111')).toBe(true);
    expect(ledger.has('bbb222')).toBe(true);
    expect(ledger.size).toBe(2);
  });

  it('ignores comment lines and blanks', async () => {
    const path = join(testRoot, '.memobridge', 'imported', 'hermes.hashes');
    await mkdir(join(testRoot, '.memobridge', 'imported'), { recursive: true });
    await writeFile(path, '# header comment\n\nabc123\n   \n  def456  \n');
    const ledger = await loadImportLedger('hermes', testRoot);
    expect(ledger.size).toBe(2);
    expect(ledger.has('abc123')).toBe(true);
    expect(ledger.has('def456')).toBe(true);
  });
});

describe('recordImported', () => {
  it('creates the ledger file with a header', async () => {
    await recordImported('openclaw', ['hash1'], testRoot);
    const content = await readFile(join(testRoot, '.memobridge', 'imported', 'openclaw.hashes'), 'utf-8');
    expect(content).toContain('# MemoBridge import ledger — openclaw');
    expect(content).toContain('hash1');
  });

  it('is idempotent (re-recording same hashes does not duplicate)', async () => {
    await recordImported('hermes', ['a', 'b'], testRoot);
    await recordImported('hermes', ['a', 'b'], testRoot);
    const ledger = await loadImportLedger('hermes', testRoot);
    expect(ledger.size).toBe(2);
  });

  it('merges with existing ledger (union, not overwrite)', async () => {
    await recordImported('hermes', ['a', 'b'], testRoot);
    await recordImported('hermes', ['b', 'c'], testRoot);
    const ledger = await loadImportLedger('hermes', testRoot);
    expect([...ledger].sort()).toEqual(['a', 'b', 'c']);
  });

  it('keeps per-tool ledgers isolated', async () => {
    await recordImported('hermes', ['h-only'], testRoot);
    await recordImported('openclaw', ['o-only'], testRoot);
    const h = await loadImportLedger('hermes', testRoot);
    const o = await loadImportLedger('openclaw', testRoot);
    expect(h.has('h-only')).toBe(true);
    expect(h.has('o-only')).toBe(false);
    expect(o.has('o-only')).toBe(true);
    expect(o.has('h-only')).toBe(false);
  });

  it('is safe under concurrent writers — nothing is lost to a race', async () => {
    // Regression for P1-1: the old read-merge-write implementation let
    // two processes read the same baseline, each add their own hashes,
    // and each serialize the full set — the later writer's file state
    // overwrote the earlier one, silently dropping half the entries.
    // Append-only semantics (O_APPEND in the kernel) must preserve both.
    await Promise.all([
      recordImported('hermes', ['a', 'b'], testRoot),
      recordImported('hermes', ['c', 'd'], testRoot),
      recordImported('hermes', ['e', 'f'], testRoot),
    ]);
    const ledger = await loadImportLedger('hermes', testRoot);
    expect([...ledger].sort()).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  });

  it('only writes the header once, even across many appends', async () => {
    await recordImported('hermes', ['a'], testRoot);
    await recordImported('hermes', ['b'], testRoot);
    await recordImported('hermes', ['c'], testRoot);
    const raw = await readFile(
      join(testRoot, '.memobridge', 'imported', 'hermes.hashes'),
      'utf-8',
    );
    // The marker line should appear exactly once. A naive fix that
    // writes the header on every call would produce 3 occurrences.
    const headerCount = raw.split('\n').filter(l => l.startsWith('# MemoBridge import ledger')).length;
    expect(headerCount).toBe(1);
  });
});

describe('filterAgainstLedger', () => {
  it('drops memories whose content_hash is in the ledger', () => {
    const data = makeData(scored('keep', 'skip'));
    const ledger = new Set([data.raw_memories[1]!.content_hash!]);
    const { data: filtered, skipped } = filterAgainstLedger(data, ledger);
    expect(skipped).toBe(1);
    expect(filtered.raw_memories.map(m => m.content)).toEqual(['keep']);
  });

  it('updates meta.stats.total_memories to match filtered count', () => {
    const data = makeData(scored('a', 'b', 'c'));
    const ledger = new Set([
      data.raw_memories[0]!.content_hash!,
      data.raw_memories[1]!.content_hash!,
    ]);
    const { data: filtered } = filterAgainstLedger(data, ledger);
    expect(filtered.meta.stats.total_memories).toBe(1);
  });

  it('returns a new object (does not mutate input)', () => {
    const data = makeData(scored('a'));
    const { data: filtered } = filterAgainstLedger(data, new Set());
    expect(filtered).not.toBe(data);
    expect(data.raw_memories).toHaveLength(1);
  });

  it('handles memories without content_hash by computing on the fly', () => {
    const data = makeData([mem({ content: 'legacy' })]); // no hash
    const { data: filtered, skipped } = filterAgainstLedger(data, new Set());
    expect(skipped).toBe(0);
    expect(filtered.raw_memories).toHaveLength(1);
  });

  it('de-dupes within the incoming data (second copy counts as skipped)', () => {
    const data = makeData(scored('same'));
    // Push a duplicate-by-hash copy
    data.raw_memories.push({ ...data.raw_memories[0]!, id: 'copy' });
    const { data: filtered, skipped } = filterAgainstLedger(data, new Set());
    expect(filtered.raw_memories).toHaveLength(1);
    expect(skipped).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Round-trip scenarios
// ---------------------------------------------------------------------------

describe('end-to-end incremental scenarios', () => {
  it('import-twice scenario: second import of same data skips everything', async () => {
    const data = makeData(scored('first', 'second'));
    const hashes = data.raw_memories.map(m => m.content_hash!);

    // First import → record all hashes
    await recordImported('hermes', hashes, testRoot);

    // Second run: filter against the ledger we just wrote
    const ledger = await loadImportLedger('hermes', testRoot);
    const { data: filtered, skipped } = filterAgainstLedger(data, ledger);
    expect(skipped).toBe(2);
    expect(filtered.raw_memories).toHaveLength(0);
  });

  it('extract-then-import-incremental: only new memories flow to importer', async () => {
    // Step 1: initial export had 2 memories, both imported
    const initial = makeData(scored('m1', 'm2'));
    await recordImported('hermes', initial.raw_memories.map(m => m.content_hash!), testRoot);

    // Step 2: next export adds a third
    const next = makeData(scored('m1', 'm2', 'm3'));

    // Step 3: import in incremental mode
    const ledger = await loadImportLedger('hermes', testRoot);
    const { data: toWrite, skipped } = filterAgainstLedger(next, ledger);
    expect(skipped).toBe(2);
    expect(toWrite.raw_memories).toHaveLength(1);
    expect(toWrite.raw_memories[0]!.content).toBe('m3');
  });

  it('full mode then incremental mode produce the same hash for the same content', async () => {
    // Regression for P0: ensure scoreMemories on pre-hashed data does not
    // recompute the hash. If it did, full-mode would write hash_v0.1 into
    // the ledger while incremental-mode would look up hash_recomputed, and
    // dedup would silently fail for any memory that already had a hash.

    // Start from a fully-scored export (what parseMemoBridge would give us
    // when it reads a v0.2 memo-bridge.md with hash fields present).
    const exported = makeData(scored('memory A', 'memory B'));
    const originalHashes = exported.raw_memories.map(m => m.content_hash!);

    // Simulate "full mode": read → score → record ledger with parsed hashes
    scoreMemories(exported);
    await recordImported('hermes', exported.raw_memories.map(m => m.content_hash!), testRoot);

    // Simulate "incremental mode": same export → score again → filter
    const ledger = await loadImportLedger('hermes', testRoot);
    const { skipped } = filterAgainstLedger(exported, ledger);

    expect(skipped).toBe(2);
    // Hashes must be untouched across the score-twice lifecycle
    expect(exported.raw_memories.map(m => m.content_hash!)).toEqual(originalHashes);
  });

  it('diff on already-hashed memories respects the incoming hash', () => {
    // Build two memories with hand-set hashes; they should not be
    // overwritten by diff's on-the-fly fallback.
    const prev: Memory[] = [
      mem({ id: 'x', content: 'unchanged', content_hash: 'fixed-hash-1' }),
    ];
    const curr: Memory[] = [
      mem({ id: 'x', content: 'unchanged', content_hash: 'fixed-hash-1' }),
    ];
    const diff = diffMemories(curr, prev);
    expect(diff.stats.unchanged).toBe(1);
    expect(diff.stats.new).toBe(0);
  });
});
