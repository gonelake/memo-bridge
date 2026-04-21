import { describe, it, expect } from 'vitest';
import {
  computeHash,
  computeFreshness,
  computeImportance,
  computeQuality,
  scoreMemories,
} from '../../src/core/quality.js';
import type { MemoBridgeData, Memory } from '../../src/core/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NOW = new Date('2026-04-20T00:00:00.000Z');

function makeData(memories: Memory[]): MemoBridgeData {
  return {
    meta: {
      version: '0.1',
      exported_at: NOW.toISOString(),
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

function mem(overrides: Partial<Memory> = {}): Memory {
  return {
    id: 'm1',
    content: 'baseline memory content',
    category: 'general',
    source: 'test',
    confidence: 0.8,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// computeHash
// ---------------------------------------------------------------------------

describe('computeHash', () => {
  it('returns a stable 12-char hex string', () => {
    const h = computeHash('hello world');
    expect(h).toMatch(/^[0-9a-f]{12}$/);
  });

  it('is deterministic for identical content', () => {
    expect(computeHash('foo')).toBe(computeHash('foo'));
  });

  it('differs for different content', () => {
    expect(computeHash('foo')).not.toBe(computeHash('bar'));
  });

  it('normalizes whitespace (trim + collapse) so cosmetic edits do not change hash', () => {
    expect(computeHash('hello   world')).toBe(computeHash('hello world'));
    expect(computeHash('  hello world  ')).toBe(computeHash('hello world'));
    expect(computeHash('hello\n\tworld')).toBe(computeHash('hello world'));
  });
});

// ---------------------------------------------------------------------------
// computeFreshness
// ---------------------------------------------------------------------------

describe('computeFreshness', () => {
  it('returns 1.0 when no date is provided (neutral — no reason to discount)', () => {
    expect(computeFreshness(undefined, NOW)).toBe(1);
  });

  it('returns 0.5 for malformed date strings (neutral fallback)', () => {
    expect(computeFreshness('not-a-date', NOW)).toBe(0.5);
  });

  it('gives full freshness for today', () => {
    expect(computeFreshness('2026-04-20', NOW)).toBeCloseTo(1, 1);
  });

  it('decays linearly within 30 days (1.0 → 0.8)', () => {
    const d15 = new Date(NOW.getTime() - 15 * 24 * 60 * 60 * 1000).toISOString();
    const f = computeFreshness(d15, NOW);
    expect(f).toBeGreaterThan(0.8);
    expect(f).toBeLessThan(1);
  });

  it('~0.8 at 30 days, ~0.5 at 90 days', () => {
    const d30 = new Date(NOW.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const d90 = new Date(NOW.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString();
    expect(computeFreshness(d30, NOW)).toBeCloseTo(0.8, 1);
    expect(computeFreshness(d90, NOW)).toBeCloseTo(0.5, 1);
  });

  it('~0.2 at 365 days, 0.1 beyond', () => {
    const d365 = new Date(NOW.getTime() - 365 * 24 * 60 * 60 * 1000).toISOString();
    const d1000 = new Date(NOW.getTime() - 1000 * 24 * 60 * 60 * 1000).toISOString();
    expect(computeFreshness(d365, NOW)).toBeCloseTo(0.2, 1);
    expect(computeFreshness(d1000, NOW)).toBe(0.1);
  });

  it('treats future dates as fresh (clock skew tolerance)', () => {
    const future = new Date(NOW.getTime() + 10 * 24 * 60 * 60 * 1000).toISOString();
    expect(computeFreshness(future, NOW)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// computeImportance
// ---------------------------------------------------------------------------

describe('computeImportance', () => {
  it('uses category weight as base', () => {
    const longTerm = computeImportance(mem({ category: 'long_term', content: 'x'.repeat(50) }));
    const note     = computeImportance(mem({ category: 'note',      content: 'x'.repeat(50) }));
    expect(longTerm).toBeGreaterThan(note);
  });

  it('defaults unknown category to 0.5 base', () => {
    const i = computeImportance(mem({ category: 'xyz-unknown', content: 'x'.repeat(50), confidence: 0.5 }));
    expect(i).toBeCloseTo(0.5, 1);
  });

  it('rewards importance keywords (中文 + English)', () => {
    const withKw = computeImportance(mem({ content: '这是一条重要的决定：永远使用 TypeScript' }));
    const noKw   = computeImportance(mem({ content: '今天吃了什么好吃的东西还行' }));
    expect(withKw).toBeGreaterThan(noKw);
  });

  it('accepts extra keywords from config', () => {
    const baseline = computeImportance(mem({ content: '该项目使用 widget-foo 架构' }));
    const boosted  = computeImportance(mem({ content: '该项目使用 widget-foo 架构' }), ['widget-foo']);
    expect(boosted).toBeGreaterThan(baseline);
  });

  it('caps keyword bonus (many hits ≠ runaway score)', () => {
    const manyHits = computeImportance(
      mem({ content: '重要 关键 核心 必须 决定 决策 约定 规则', category: 'long_term', confidence: 1 }),
    );
    expect(manyHits).toBeLessThanOrEqual(1);
  });

  it('applies short-content penalty', () => {
    const short = computeImportance(mem({ content: 'ok', category: 'knowledge' }));
    const long  = computeImportance(mem({ content: 'x'.repeat(50), category: 'knowledge' }));
    expect(long).toBeGreaterThan(short);
  });

  it('rewards higher confidence', () => {
    const low  = computeImportance(mem({ confidence: 0.3, content: 'x'.repeat(50) }));
    const high = computeImportance(mem({ confidence: 1.0, content: 'x'.repeat(50) }));
    expect(high).toBeGreaterThan(low);
  });

  it('clamps to [0, 1]', () => {
    const m = mem({ content: '重要 关键 核心 必须', category: 'long_term', confidence: 1 });
    const i = computeImportance(m);
    expect(i).toBeGreaterThanOrEqual(0);
    expect(i).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// computeQuality
// ---------------------------------------------------------------------------

describe('computeQuality', () => {
  it('weights importance > freshness > confidence per formula', () => {
    // Spec: 0.5·I + 0.3·F + 0.2·C
    const q = computeQuality(1, 0, 0);
    expect(q).toBeCloseTo(0.5, 2);
    const q2 = computeQuality(0, 1, 0);
    expect(q2).toBeCloseTo(0.3, 2);
    const q3 = computeQuality(0, 0, 1);
    expect(q3).toBeCloseTo(0.2, 2);
  });

  it('clamps to [0, 1]', () => {
    expect(computeQuality(1, 1, 1)).toBe(1);
    expect(computeQuality(0, 0, 0)).toBe(0);
  });

  it('does not collapse to 0 when one axis is 0 (unlike pure product)', () => {
    const q = computeQuality(0.8, 0, 0.8);
    expect(q).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// scoreMemories — batch entry point
// ---------------------------------------------------------------------------

describe('scoreMemories', () => {
  it('populates content_hash / importance / freshness / quality on all memories', () => {
    const data = makeData([mem({ content: '我决定永远使用 TypeScript', confidence: 0.9 })]);
    scoreMemories(data, { now: NOW });
    const [m] = data.raw_memories;
    expect(m.content_hash).toMatch(/^[0-9a-f]{12}$/);
    expect(m.importance).toBeGreaterThan(0);
    expect(m.freshness).toBe(1);          // no date → neutral 1
    expect(m.quality).toBeGreaterThan(0);
  });

  it('is idempotent — re-running produces identical scores', () => {
    const data = makeData([mem({ content: 'stable memory', updated_at: '2026-04-10' })]);
    scoreMemories(data, { now: NOW });
    const first = { ...data.raw_memories[0] };
    scoreMemories(data, { now: NOW });
    expect(data.raw_memories[0]).toEqual(first);
  });

  it('skips memories with empty content (does not crash)', () => {
    const data = makeData([mem({ content: '' })]);
    scoreMemories(data, { now: NOW });
    expect(data.raw_memories[0].content_hash).toBeUndefined();
  });

  it('prefers updated_at over created_at for freshness', () => {
    const d = makeData([
      mem({
        content: 'test',
        created_at: '2020-01-01',        // old
        updated_at: '2026-04-19',        // fresh
      }),
    ]);
    scoreMemories(d, { now: NOW });
    expect(d.raw_memories[0].freshness).toBeGreaterThan(0.9);
  });

  it('mutates in place and returns the same reference', () => {
    const data = makeData([mem()]);
    const ret = scoreMemories(data, { now: NOW });
    expect(ret).toBe(data);
  });

  it('respects importanceKeywords option', () => {
    const base = makeData([mem({ content: '使用 widget-foo 模式', category: 'note' })]);
    const boosted = makeData([mem({ content: '使用 widget-foo 模式', category: 'note' })]);
    scoreMemories(base, { now: NOW });
    scoreMemories(boosted, { now: NOW, importanceKeywords: ['widget-foo'] });
    expect(boosted.raw_memories[0].importance).toBeGreaterThan(base.raw_memories[0].importance!);
  });

  it('survives empty memory list', () => {
    const data = makeData([]);
    expect(() => scoreMemories(data)).not.toThrow();
  });

  it('preserves an existing content_hash instead of recomputing it', () => {
    // Regression for P0: full-mode import writes the parsed hash into the
    // ledger, while incremental-mode runs scoreMemories first. If
    // scoreMemories overwrote content_hash, the two paths would produce
    // different ledger entries for the same physical memory, breaking
    // dedup. scoreMemories must be non-destructive on an existing hash.
    const data = makeData([mem({ content: 'some memory', content_hash: 'existing-hash' })]);
    scoreMemories(data, { now: NOW });
    expect(data.raw_memories[0].content_hash).toBe('existing-hash');
  });
});
