import { describe, it, expect } from 'vitest';
import { mergeMemories } from '../../src/core/merger.js';
import type { MemoBridgeData, Memory, ToolId } from '../../src/core/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeData(overrides: Partial<MemoBridgeData> = {}, tool: ToolId = 'codebuddy'): MemoBridgeData {
  return {
    meta: {
      version: '0.1',
      exported_at: '2026-04-01T00:00:00.000Z',
      source: { tool, extraction_method: 'file' },
      stats: { total_memories: 0, categories: 0 },
    },
    profile: { identity: {}, preferences: {}, work_patterns: {} },
    knowledge: [],
    projects: [],
    feeds: [],
    raw_memories: [],
    ...overrides,
  };
}

function memory(id: string, content: string, opts: Partial<Memory> = {}): Memory {
  return {
    id,
    content,
    category: 'fact',
    source: 'test',
    confidence: 0.8,
    ...opts,
  };
}

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('mergeMemories — edge cases', () => {
  it('throws when called with no sources', () => {
    expect(() => mergeMemories()).toThrowError(/At least one source required/);
  });

  it('returns the single source as-is when only one is provided', () => {
    const data = makeData({ raw_memories: [memory('m1', 'hello')] });
    const result = mergeMemories(data);
    expect(result).toBe(data); // same reference
  });

  it('does not mutate the first source when merging multiple', () => {
    const a = makeData({ raw_memories: [memory('m1', 'first entry')] });
    const b = makeData({ raw_memories: [memory('m2', 'second entry')] }, 'cursor');
    const aSnapshot = JSON.stringify(a);

    mergeMemories(a, b);

    expect(JSON.stringify(a)).toBe(aSnapshot);
  });
});

// ---------------------------------------------------------------------------
// Profile merging — later source wins on conflicts
// ---------------------------------------------------------------------------

describe('mergeMemories — profile', () => {
  it('combines identity / preferences / work_patterns from all sources', () => {
    const a = makeData({
      profile: {
        identity: { 角色: '工程师' },
        preferences: { 风格: '简洁' },
        work_patterns: {},
      },
    });
    const b = makeData({
      profile: {
        identity: { 兴趣: 'AI' },
        preferences: {},
        work_patterns: { 工作时间: '9-6' },
      },
    });

    const result = mergeMemories(a, b);
    expect(result.profile.identity).toEqual({ 角色: '工程师', 兴趣: 'AI' });
    expect(result.profile.preferences).toEqual({ 风格: '简洁' });
    expect(result.profile.work_patterns).toEqual({ 工作时间: '9-6' });
  });

  it('later source overwrites identical keys', () => {
    const a = makeData({
      profile: {
        identity: { 角色: '工程师' },
        preferences: {},
        work_patterns: {},
      },
    });
    const b = makeData({
      profile: {
        identity: { 角色: '架构师' }, // overrides
        preferences: {},
        work_patterns: {},
      },
    });

    const result = mergeMemories(a, b);
    expect(result.profile.identity['角色']).toBe('架构师');
  });
});

// ---------------------------------------------------------------------------
// Knowledge merging — by section title and item topic
// ---------------------------------------------------------------------------

describe('mergeMemories — knowledge', () => {
  it('appends new knowledge sections from later sources', () => {
    const a = makeData({
      knowledge: [{ title: 'AI', items: [{ topic: 'LLM 基础' }] }],
    });
    const b = makeData({
      knowledge: [{ title: '英语', items: [{ topic: 'apple' }] }],
    });

    const result = mergeMemories(a, b);
    expect(result.knowledge.map(s => s.title)).toEqual(['AI', '英语']);
  });

  it('merges items into an existing section by title, deduping by topic', () => {
    const a = makeData({
      knowledge: [{ title: 'AI', items: [{ topic: 'LLM' }, { topic: 'RAG' }] }],
    });
    const b = makeData({
      knowledge: [{
        title: 'AI',
        items: [{ topic: 'RAG' }, { topic: 'Agent' }], // RAG dup, Agent new
      }],
    });

    const result = mergeMemories(a, b);
    expect(result.knowledge).toHaveLength(1);
    expect(result.knowledge[0].items.map(i => i.topic)).toEqual(['LLM', 'RAG', 'Agent']);
  });

  it('keeps the original item when topic clashes (does not overwrite)', () => {
    const a = makeData({
      knowledge: [{
        title: 'AI',
        items: [{ topic: 'LLM', mastery: 'mastered' }],
      }],
    });
    const b = makeData({
      knowledge: [{
        title: 'AI',
        items: [{ topic: 'LLM', mastery: 'learned' }], // duplicate topic
      }],
    });

    const result = mergeMemories(a, b);
    expect(result.knowledge[0].items[0].mastery).toBe('mastered');
  });
});

// ---------------------------------------------------------------------------
// Projects / feeds — by name
// ---------------------------------------------------------------------------

describe('mergeMemories — projects', () => {
  it('appends new projects, deduplicates by name', () => {
    const a = makeData({
      projects: [{ name: 'MemoBridge', status: 'active', key_insights: ['x'] }],
    });
    const b = makeData({
      projects: [
        { name: 'MemoBridge', status: 'completed', key_insights: ['y'] }, // dup
        { name: 'OtherProj', status: 'active', key_insights: [] },
      ],
    });

    const result = mergeMemories(a, b);
    expect(result.projects.map(p => p.name)).toEqual(['MemoBridge', 'OtherProj']);
    // Original (first) project preserved
    expect(result.projects[0].status).toBe('active');
  });
});

describe('mergeMemories — feeds', () => {
  it('appends new feeds, deduplicates by name', () => {
    const a = makeData({ feeds: [{ name: 'AI 日报' }] });
    const b = makeData({
      feeds: [{ name: 'AI 日报' }, { name: '英语词汇' }],
    });

    const result = mergeMemories(a, b);
    expect(result.feeds.map(f => f.name)).toEqual(['AI 日报', '英语词汇']);
  });
});

// ---------------------------------------------------------------------------
// Raw memory deduplication — exact + Jaccard similarity
// ---------------------------------------------------------------------------

describe('mergeMemories — raw_memories deduplication', () => {
  it('keeps distinct raw memories', () => {
    const a = makeData({ raw_memories: [memory('m1', 'use jaccard for dedup')] });
    const b = makeData({ raw_memories: [memory('m2', 'workspace is at /tmp/foo')] });

    const result = mergeMemories(a, b);
    expect(result.raw_memories).toHaveLength(2);
  });

  it('drops exact-string duplicates regardless of case/whitespace', () => {
    const a = makeData({ raw_memories: [memory('m1', 'hello world')] });
    const b = makeData({ raw_memories: [memory('m2', '  HELLO WORLD  ')] });

    const result = mergeMemories(a, b);
    expect(result.raw_memories).toHaveLength(1);
  });

  it('drops near-duplicates above Jaccard 0.8 similarity', () => {
    // Identical token sets except one extra word → Jaccard = 9/10 = 0.9 > 0.8
    const a = makeData({
      raw_memories: [memory('m1', 'alpha beta gamma delta epsilon zeta eta theta iota')],
    });
    const b = makeData({
      raw_memories: [memory('m2', 'alpha beta gamma delta epsilon zeta eta theta iota kappa')],
    });

    const result = mergeMemories(a, b);
    expect(result.raw_memories).toHaveLength(1);
    expect(result.raw_memories[0].id).toBe('m1'); // kept the first
  });

  it('keeps memories below Jaccard 0.8 similarity', () => {
    const a = makeData({
      raw_memories: [memory('m1', 'integration tests must hit a real database')],
    });
    const b = makeData({
      raw_memories: [memory('m2', 'prefer terse responses without trailing summaries')],
    });

    const result = mergeMemories(a, b);
    expect(result.raw_memories).toHaveLength(2);
  });

  it('deduplicates across three or more sources', () => {
    const a = makeData({ raw_memories: [memory('m1', 'unique alpha')] });
    const b = makeData({ raw_memories: [memory('m2', 'unique beta')] });
    const c = makeData({ raw_memories: [
      memory('m3', 'unique alpha'),  // dup of a
      memory('m4', 'unique gamma'),
    ] });

    const result = mergeMemories(a, b, c);
    expect(result.raw_memories.map(m => m.content).sort())
      .toEqual(['unique alpha', 'unique beta', 'unique gamma']);
  });
});

// ---------------------------------------------------------------------------
// Stats recomputation
// ---------------------------------------------------------------------------

describe('mergeMemories — stats', () => {
  it('recomputes total_memories across all sections after merge', () => {
    const a = makeData({
      profile: {
        identity: { 角色: '工程师' },
        preferences: {},
        work_patterns: {},
      },
      knowledge: [{ title: 'AI', items: [{ topic: 'LLM' }, { topic: 'RAG' }] }],
      projects: [{ name: 'P1', status: 'active', key_insights: [] }],
      feeds: [{ name: 'F1' }],
      raw_memories: [memory('m1', 'a')],
    });
    const b = makeData({
      raw_memories: [memory('m2', 'b')],
    }, 'cursor');

    const result = mergeMemories(a, b);
    // 1 identity + 0 prefs + 0 patterns + 2 knowledge items + 1 project + 1 feed + 2 raw = 7
    expect(result.meta.stats.total_memories).toBe(7);
  });

  it('recomputes categories count', () => {
    const a = makeData({
      profile: {
        identity: { 角色: '工程师' },
        preferences: { style: 'terse' },
        work_patterns: {},
      },
      knowledge: [{ title: 'AI', items: [{ topic: 'LLM' }] }],
      projects: [{ name: 'P1', status: 'active', key_insights: [] }],
      raw_memories: [memory('m1', 'foo')],
    });
    const b = makeData({
      knowledge: [{ title: '英语', items: [{ topic: 'apple' }] }],
    });

    const result = mergeMemories(a, b);
    // profile + preferences + knowledge:AI + knowledge:英语 + projects + raw_memories = 6
    expect(result.meta.stats.categories).toBe(6);
  });

  it('updates exported_at to a fresh timestamp', () => {
    const oldTimestamp = '2020-01-01T00:00:00.000Z';
    const a = makeData({
      meta: {
        version: '0.1',
        exported_at: oldTimestamp,
        source: { tool: 'codebuddy', extraction_method: 'file' },
        stats: { total_memories: 0, categories: 0 },
      },
    });
    const b = makeData({}, 'cursor');

    const result = mergeMemories(a, b);
    expect(result.meta.exported_at).not.toBe(oldTimestamp);
    expect(new Date(result.meta.exported_at).getTime())
      .toBeGreaterThan(new Date(oldTimestamp).getTime());
  });
});

// ---------------------------------------------------------------------------
// Extensions merging (tool-namespaced)
// ---------------------------------------------------------------------------

describe('mergeMemories — extensions', () => {
  it('leaves extensions undefined when no source has any', () => {
    const a = makeData();
    const b = makeData({}, 'cursor');
    const result = mergeMemories(a, b);
    expect(result.extensions).toBeUndefined();
  });

  it('propagates extensions from a single source through single-source fast path', () => {
    const a = makeData({
      extensions: { hermes: { skills: ['x', 'y'] } },
    });
    const result = mergeMemories(a);
    expect(result.extensions?.hermes).toEqual({ skills: ['x', 'y'] });
  });

  it('merges different-tool namespaces side by side without collisions', () => {
    const a = makeData({ extensions: { hermes: { skills: ['a'] } } });
    const b = makeData({ extensions: { openclaw: { soul: 'text' } } }, 'cursor');
    const result = mergeMemories(a, b);
    expect(result.extensions?.hermes).toEqual({ skills: ['a'] });
    expect(result.extensions?.openclaw).toEqual({ soul: 'text' });
  });

  it('later source wins within the same tool namespace', () => {
    const a = makeData({
      extensions: { hermes: { skills: ['old'], model: 'v1' } },
    });
    const b = makeData(
      { extensions: { hermes: { skills: ['new'] } } },
      'cursor',
    );
    const result = mergeMemories(a, b);
    // skills overwritten, model preserved
    expect(result.extensions?.hermes).toEqual({ skills: ['new'], model: 'v1' });
  });

  it('propagates extensions when only the later source has them', () => {
    const a = makeData();
    const b = makeData({ extensions: { hermes: { skills: ['new'] } } }, 'cursor');
    const result = mergeMemories(a, b);
    expect(result.extensions?.hermes).toEqual({ skills: ['new'] });
  });

  it('preserves base extensions when later source has none', () => {
    const a = makeData({ extensions: { hermes: { skills: ['keep'] } } });
    const b = makeData({}, 'cursor');
    const result = mergeMemories(a, b);
    expect(result.extensions?.hermes).toEqual({ skills: ['keep'] });
  });
});
