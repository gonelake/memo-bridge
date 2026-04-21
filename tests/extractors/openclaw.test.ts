import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import OpenClawExtractor from '../../src/extractors/openclaw.js';

let ws: string;

beforeEach(async () => {
  ws = await mkdtemp(join(tmpdir(), 'memobridge-oc-'));
});

afterEach(async () => {
  await rm(ws, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// MEMORY.md parsing
// ---------------------------------------------------------------------------

describe('OpenClawExtractor — MEMORY.md', () => {
  const extractor = new OpenClawExtractor();

  it('parses bullet entries into raw_memories', async () => {
    await writeFile(
      join(ws, 'MEMORY.md'),
      [
        '- first long memory entry',
        '* second long memory entry',
        '- tiny', // < 5 chars: dropped
        'non-bullet line ignored',
      ].join('\n'),
    );
    const data = await extractor.extract({ workspace: ws });
    expect(data.raw_memories).toHaveLength(2);
    expect(data.raw_memories[0].content).toBe('first long memory entry');
    expect(data.raw_memories[0].category).toBe('long_term');
    expect(data.raw_memories[0].source).toBe('MEMORY.md');
    expect(data.raw_memories[0].confidence).toBe(0.9);
  });

  it('assigns sequential ocmem-N ids', async () => {
    await writeFile(join(ws, 'MEMORY.md'), '- entry one\n- entry two\n- entry three');
    const data = await extractor.extract({ workspace: ws });
    expect(data.raw_memories.map(m => m.id))
      .toEqual(['ocmem-0', 'ocmem-1', 'ocmem-2']);
  });

  it('returns empty when MEMORY.md absent', async () => {
    const data = await extractor.extract({ workspace: ws });
    expect(data.raw_memories).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// USER.md parsing
// ---------------------------------------------------------------------------

describe('OpenClawExtractor — USER.md', () => {
  const extractor = new OpenClawExtractor();

  it('routes name / role keys to identity', async () => {
    await writeFile(
      join(ws, 'USER.md'),
      [
        '- name: Alice',
        '- role: engineer',
        '- 职业：研究员',
        '- 姓名：张三',
      ].join('\n'),
    );
    const data = await extractor.extract({ workspace: ws });
    expect(data.profile.identity['name']).toBe('Alice');
    expect(data.profile.identity['role']).toBe('engineer');
    expect(data.profile.identity['职业']).toBe('研究员');
    expect(data.profile.identity['姓名']).toBe('张三');
  });

  it('routes prefer / style keys to preferences', async () => {
    await writeFile(
      join(ws, 'USER.md'),
      [
        '- prefers: terse replies',
        '- style: direct',
        '- 风格：简洁',
        '- 偏好：中文',
      ].join('\n'),
    );
    const data = await extractor.extract({ workspace: ws });
    expect(data.profile.preferences['prefers']).toBe('terse replies');
    expect(data.profile.preferences['style']).toBe('direct');
    expect(data.profile.preferences['风格']).toBe('简洁');
    expect(data.profile.preferences['偏好']).toBe('中文');
  });

  it('routes unknown keys to identity by default', async () => {
    await writeFile(join(ws, 'USER.md'), '- location: Shanghai');
    const data = await extractor.extract({ workspace: ws });
    expect(data.profile.identity['location']).toBe('Shanghai');
  });

  it('ignores lines without a kv shape', async () => {
    await writeFile(
      join(ws, 'USER.md'),
      [
        'no bullet line',
        '- bullet without colon',
        '- role: engineer',
      ].join('\n'),
    );
    const data = await extractor.extract({ workspace: ws });
    expect(Object.keys(data.profile.identity)).toEqual(['role']);
  });
});

// ---------------------------------------------------------------------------
// SOUL.md
// ---------------------------------------------------------------------------

describe('OpenClawExtractor — SOUL.md', () => {
  const extractor = new OpenClawExtractor();

  it('stores SOUL.md content in extensions.openclaw.soul (truncated to 500 chars)', async () => {
    const body = 'A'.repeat(600);
    await writeFile(join(ws, 'SOUL.md'), body);
    const data = await extractor.extract({ workspace: ws });
    const soul = data.extensions?.openclaw?.soul as string | undefined;
    expect(soul).toBeTruthy();
    expect(soul!.length).toBe(500);
  });

  it('does not pollute raw_memories with an openclaw-soul entry', async () => {
    await writeFile(join(ws, 'SOUL.md'), 'personality text');
    const data = await extractor.extract({ workspace: ws });
    expect(data.raw_memories.find(m => m.id === 'openclaw-soul')).toBeUndefined();
  });

  it('omits extensions.openclaw.soul when SOUL.md is absent', async () => {
    const data = await extractor.extract({ workspace: ws });
    expect(data.extensions?.openclaw?.soul).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// DREAMS.md
// ---------------------------------------------------------------------------

describe('OpenClawExtractor — DREAMS.md', () => {
  const extractor = new OpenClawExtractor();

  it('records dreams metadata in extensions.openclaw.dreams', async () => {
    await writeFile(join(ws, 'DREAMS.md'), 'dream entry body content');
    const data = await extractor.extract({ workspace: ws });
    const dreams = data.extensions?.openclaw?.dreams as { chars: number } | undefined;
    expect(dreams).toBeTruthy();
    expect(dreams!.chars).toBe('dream entry body content'.length);
  });

  it('does not pollute raw_memories with an openclaw-dreams entry', async () => {
    await writeFile(join(ws, 'DREAMS.md'), 'dreams');
    const data = await extractor.extract({ workspace: ws });
    expect(data.raw_memories.find(m => m.id === 'openclaw-dreams')).toBeUndefined();
  });

  it('coexists with soul in the same openclaw namespace', async () => {
    await writeFile(join(ws, 'SOUL.md'), 'soul content');
    await writeFile(join(ws, 'DREAMS.md'), 'dream content');
    const data = await extractor.extract({ workspace: ws });
    expect(data.extensions?.openclaw?.soul).toBe('soul content');
    expect((data.extensions?.openclaw?.dreams as { chars: number }).chars)
      .toBe('dream content'.length);
  });
});

// ---------------------------------------------------------------------------
// Daily notes
// ---------------------------------------------------------------------------

describe('OpenClawExtractor — daily notes', () => {
  const extractor = new OpenClawExtractor();

  beforeEach(async () => {
    await mkdir(join(ws, 'memory'), { recursive: true });
  });

  it('parses memory/YYYY-MM-DD.md files into daily_note entries', async () => {
    await writeFile(
      join(ws, 'memory', '2026-04-20.md'),
      '- today I refactored the registry for decoupling',
    );
    const data = await extractor.extract({ workspace: ws });
    const daily = data.raw_memories.filter(m => m.category === 'daily_note');
    expect(daily).toHaveLength(1);
    expect(daily[0].content).toBe('today I refactored the registry for decoupling');
    expect(daily[0].source).toBe('memory/2026-04-20.md');
    expect(daily[0].created_at).toBe('2026-04-20');
    expect(daily[0].confidence).toBe(0.8);
  });

  it('splits § separated content within a single daily bullet', async () => {
    await writeFile(
      join(ws, 'memory', '2026-04-20.md'),
      '- entry one about the refactor§entry two about testing§entry three about docs',
    );
    const data = await extractor.extract({ workspace: ws });
    const daily = data.raw_memories.filter(m => m.category === 'daily_note');
    expect(daily.map(d => d.content)).toEqual([
      'entry one about the refactor',
      'entry two about testing',
      'entry three about docs',
    ]);
  });

  it('skips bullets shorter than 20 chars', async () => {
    await writeFile(
      join(ws, 'memory', '2026-04-20.md'),
      [
        '- too short',
        '- this bullet is long enough to be captured',
      ].join('\n'),
    );
    const data = await extractor.extract({ workspace: ws });
    const daily = data.raw_memories.filter(m => m.category === 'daily_note');
    expect(daily).toHaveLength(1);
    expect(daily[0].content).toBe('this bullet is long enough to be captured');
  });

  it('ignores files that do not match YYYY-MM-DD.md', async () => {
    await writeFile(join(ws, 'memory', '2026-04-20.md'), '- valid dated entry exists here');
    await writeFile(join(ws, 'memory', 'notes.md'), '- undated file ignored entirely');
    await writeFile(join(ws, 'memory', '20260420.md'), '- bad date format ignored too');
    const data = await extractor.extract({ workspace: ws });
    const daily = data.raw_memories.filter(m => m.category === 'daily_note');
    expect(daily).toHaveLength(1);
    expect(daily[0].content).toContain('valid dated entry exists here');
  });

  it('computes earliest/latest stats from daily note dates', async () => {
    await writeFile(join(ws, 'memory', '2025-01-05.md'), '- first long entry here');
    await writeFile(join(ws, 'memory', '2026-04-20.md'), '- last long entry here');
    await writeFile(join(ws, 'memory', '2025-11-15.md'), '- middle long entry here');
    const data = await extractor.extract({ workspace: ws });
    expect(data.meta.stats.earliest).toBe('2025-01-05');
    expect(data.meta.stats.latest).toBe('2026-04-20');
  });
});

// ---------------------------------------------------------------------------
// Meta and stats
// ---------------------------------------------------------------------------

describe('OpenClawExtractor — meta and stats', () => {
  const extractor = new OpenClawExtractor();

  it('sets meta.source.tool=openclaw and workspace path', async () => {
    const data = await extractor.extract({ workspace: ws });
    expect(data.meta.source.tool).toBe('openclaw');
    expect(data.meta.source.workspace).toBe(ws);
    expect(data.meta.source.extraction_method).toBe('file');
  });

  it('counts total_memories across all sections', async () => {
    await writeFile(join(ws, 'MEMORY.md'), '- one long\n- two long');
    await writeFile(join(ws, 'USER.md'), '- role: engineer');
    await writeFile(join(ws, 'SOUL.md'), 'personality text');
    // raw: 2 memory (soul no longer in raw_memories); identity: 1; total = 3
    const data = await extractor.extract({ workspace: ws });
    expect(data.meta.stats.total_memories).toBe(3);
  });

  it('returns an empty data structure for an empty workspace', async () => {
    const data = await extractor.extract({ workspace: ws });
    expect(data.raw_memories).toEqual([]);
    expect(data.profile.identity).toEqual({});
    expect(data.meta.stats.total_memories).toBe(0);
    expect(data.meta.stats.earliest).toBeUndefined();
    expect(data.meta.stats.latest).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Privacy integration
// ---------------------------------------------------------------------------

describe('OpenClawExtractor — privacy integration', () => {
  const extractor = new OpenClawExtractor();

  it('redacts secrets in MEMORY.md', async () => {
    await writeFile(
      join(ws, 'MEMORY.md'),
      '- GitHub token ghp_abcdefghijklmnopqrstuvwxyz0123456789 used for deploy',
    );
    const data = await extractor.extract({ workspace: ws });
    const combined = data.raw_memories.map(m => m.content).join('\n');
    expect(combined).toContain('ghp_***REDACTED***');
    expect(combined).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz0123456789');
  });

  it('redacts secrets in daily notes', async () => {
    await mkdir(join(ws, 'memory'), { recursive: true });
    await writeFile(
      join(ws, 'memory', '2026-04-20.md'),
      '- deployed with api_key: "sekretsekretsekret123"',
    );
    const data = await extractor.extract({ workspace: ws });
    const combined = data.raw_memories.map(m => m.content).join('\n');
    expect(combined).toContain('***API_KEY_REDACTED***');
  });
});
