import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import CursorExtractor from '../../src/extractors/cursor.js';

// Cursor's extract() hits ~/.cursor by default. We subclass and override
// getGlobalDir() so tests point at a hermetic tmp tree.

let cursorDir: string;
let wsDir: string;

class TestableCursorExtractor extends CursorExtractor {
  constructor(private readonly overrideDir: string) { super(); }
  protected getGlobalDir(): string { return this.overrideDir; }
}

beforeEach(async () => {
  const root = await mkdtemp(join(tmpdir(), 'memobridge-cursor-'));
  cursorDir = join(root, 'cursor');
  wsDir = join(root, 'ws');
  await mkdir(cursorDir, { recursive: true });
  await mkdir(wsDir, { recursive: true });
});

afterEach(async () => {
  await rm(join(cursorDir, '..'), { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Global ~/.cursor/rules/*.md
// ---------------------------------------------------------------------------

describe('CursorExtractor — global rules', () => {
  it('reads .md files under ~/.cursor/rules/', async () => {
    const rulesDir = join(cursorDir, 'rules');
    await mkdir(rulesDir, { recursive: true });
    await writeFile(
      join(rulesDir, 'typescript.md'),
      '- always use strict mode',
    );
    const ext = new TestableCursorExtractor(cursorDir);
    const data = await ext.extract({});
    const sources = data.raw_memories.map(m => m.source);
    expect(sources).toContain('global:typescript.md');
  });

  it('also reads .mdc files', async () => {
    const rulesDir = join(cursorDir, 'rules');
    await mkdir(rulesDir, { recursive: true });
    await writeFile(
      join(rulesDir, 'python.mdc'),
      '- use type hints always',
    );
    const ext = new TestableCursorExtractor(cursorDir);
    const data = await ext.extract({});
    expect(data.raw_memories.some(m => m.source === 'global:python.mdc')).toBe(true);
  });

  it('ignores non-md files in rules/', async () => {
    const rulesDir = join(cursorDir, 'rules');
    await mkdir(rulesDir, { recursive: true });
    await writeFile(join(rulesDir, 'notes.txt'), '- ignored rule');
    await writeFile(join(rulesDir, 'valid.md'), '- valid rule content');
    const ext = new TestableCursorExtractor(cursorDir);
    const data = await ext.extract({});
    const sources = data.raw_memories.map(m => m.source);
    expect(sources).toContain('global:valid.md');
    expect(sources.some(s => s.includes('notes.txt'))).toBe(false);
  });

  it('is safe when rules/ directory does not exist', async () => {
    const ext = new TestableCursorExtractor(cursorDir);
    const data = await ext.extract({});
    expect(data.raw_memories).toEqual([]);
  });

  it('reads multiple rules files in sorted order', async () => {
    const rulesDir = join(cursorDir, 'rules');
    await mkdir(rulesDir, { recursive: true });
    await writeFile(join(rulesDir, 'b-second.md'), '- rule B content');
    await writeFile(join(rulesDir, 'a-first.md'), '- rule A content');
    const ext = new TestableCursorExtractor(cursorDir);
    const data = await ext.extract({});
    const sources = data.raw_memories.map(m => m.source);
    // sort() is alphabetic — 'a-first' before 'b-second'
    expect(sources.indexOf('global:a-first.md'))
      .toBeLessThan(sources.indexOf('global:b-second.md'));
  });
});

// ---------------------------------------------------------------------------
// Workspace-level .cursorrules
// ---------------------------------------------------------------------------

describe('CursorExtractor — workspace .cursorrules', () => {
  it('parses .cursorrules when workspace is provided', async () => {
    await writeFile(
      join(wsDir, '.cursorrules'),
      '- prefer functional style',
    );
    const ext = new TestableCursorExtractor(cursorDir);
    const data = await ext.extract({ workspace: wsDir });
    expect(data.raw_memories.some(m => m.source === 'project:.cursorrules')).toBe(true);
  });

  it('skips .cursorrules when workspace is not given', async () => {
    await writeFile(
      join(wsDir, '.cursorrules'),
      '- this rule should not be read',
    );
    const ext = new TestableCursorExtractor(cursorDir);
    const data = await ext.extract({});
    expect(data.raw_memories).toEqual([]);
  });

  it('is safe when .cursorrules does not exist', async () => {
    const ext = new TestableCursorExtractor(cursorDir);
    const data = await ext.extract({ workspace: wsDir });
    expect(data.raw_memories).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Workspace .cursor/rules/*.md
// ---------------------------------------------------------------------------

describe('CursorExtractor — workspace .cursor/rules/', () => {
  it('reads .cursor/rules/*.md inside workspace', async () => {
    const dir = join(wsDir, '.cursor', 'rules');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'style.md'), '- use 2-space indent');
    const ext = new TestableCursorExtractor(cursorDir);
    const data = await ext.extract({ workspace: wsDir });
    expect(data.raw_memories.some(m => m.source === 'project:style.md')).toBe(true);
  });

  it('supports .mdc files in workspace rules', async () => {
    const dir = join(wsDir, '.cursor', 'rules');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'formatting.mdc'), '- always use prettier');
    const ext = new TestableCursorExtractor(cursorDir);
    const data = await ext.extract({ workspace: wsDir });
    expect(data.raw_memories.some(m => m.source === 'project:formatting.mdc')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// parseRules — classification
// ---------------------------------------------------------------------------

describe('CursorExtractor — parseRules', () => {
  async function seedGlobal(content: string) {
    const dir = join(cursorDir, 'rules');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'rules.md'), content);
  }

  it('bullet rules produce both raw_memory (category=rule) and preference', async () => {
    await seedGlobal([
      '- always enable strict mode',
      '- never commit secrets',
    ].join('\n'));
    const ext = new TestableCursorExtractor(cursorDir);
    const data = await ext.extract({});

    const rules = data.raw_memories.filter(m => m.category === 'rule');
    expect(rules).toHaveLength(2);
    expect(rules[0].confidence).toBe(1.0);

    // parseRules also writes to profile.preferences
    expect(Object.keys(data.profile.preferences).length).toBe(2);
  });

  it('strips both - and * bullet prefixes', async () => {
    await seedGlobal('- dash rule here\n* star rule here');
    const ext = new TestableCursorExtractor(cursorDir);
    const data = await ext.extract({});
    const contents = data.raw_memories.map(m => m.content);
    expect(contents).toContain('dash rule here');
    expect(contents).toContain('star rule here');
  });

  it('drops bullets shorter than 5 chars', async () => {
    await seedGlobal('- tiny\n- abcd\n- five+');
    const ext = new TestableCursorExtractor(cursorDir);
    const data = await ext.extract({});
    expect(data.raw_memories).toHaveLength(1);
    expect(data.raw_memories[0].content).toBe('five+');
  });

  it('treats non-bullet prose > 15 chars as instruction (confidence 0.95)', async () => {
    await seedGlobal([
      'This is free-form instruction text about the project.',
      'short prose', // < 15 chars — dropped
    ].join('\n'));
    const ext = new TestableCursorExtractor(cursorDir);
    const data = await ext.extract({});
    const inst = data.raw_memories.filter(m => m.category === 'instruction');
    expect(inst).toHaveLength(1);
    expect(inst[0].confidence).toBe(0.95);
  });

  it('truncates long prose to 300 chars', async () => {
    await seedGlobal('X'.repeat(500));
    const ext = new TestableCursorExtractor(cursorDir);
    const data = await ext.extract({});
    const inst = data.raw_memories.find(m => m.category === 'instruction');
    expect(inst).toBeTruthy();
    expect(inst!.content.length).toBe(300);
  });

  it('skips headers starting with #', async () => {
    await seedGlobal([
      '# Heading',
      '## Sub-heading',
      '- valid bullet rule',
    ].join('\n'));
    const ext = new TestableCursorExtractor(cursorDir);
    const data = await ext.extract({});
    expect(data.raw_memories).toHaveLength(1);
    expect(data.raw_memories[0].category).toBe('rule');
  });
});

// ---------------------------------------------------------------------------
// Combined sources
// ---------------------------------------------------------------------------

describe('CursorExtractor — combines global + workspace sources', () => {
  it('collects rules from ~/.cursor/rules, .cursorrules, and .cursor/rules', async () => {
    const globalRules = join(cursorDir, 'rules');
    await mkdir(globalRules, { recursive: true });
    await writeFile(join(globalRules, 'a.md'), '- global rule A');

    await writeFile(join(wsDir, '.cursorrules'), '- cursorrules rule');

    const wsRules = join(wsDir, '.cursor', 'rules');
    await mkdir(wsRules, { recursive: true });
    await writeFile(join(wsRules, 'b.md'), '- workspace rule B');

    const ext = new TestableCursorExtractor(cursorDir);
    const data = await ext.extract({ workspace: wsDir });

    const sources = data.raw_memories.map(m => m.source);
    expect(sources).toContain('global:a.md');
    expect(sources).toContain('project:.cursorrules');
    expect(sources).toContain('project:b.md');
    expect(data.raw_memories).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// Privacy integration
// ---------------------------------------------------------------------------

describe('CursorExtractor — privacy integration', () => {
  it('redacts secrets from global rules', async () => {
    const dir = join(cursorDir, 'rules');
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'deploy.md'),
      '- use token ghp_abcdefghijklmnopqrstuvwxyz0123456789 for CI',
    );
    const ext = new TestableCursorExtractor(cursorDir);
    const data = await ext.extract({});
    const combined = data.raw_memories.map(m => m.content).join('\n');
    expect(combined).toContain('ghp_***REDACTED***');
    expect(combined).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz0123456789');
  });

  it('redacts secrets from .cursorrules', async () => {
    await writeFile(
      join(wsDir, '.cursorrules'),
      '- use api_key: "mysecretapikey1234567890"',
    );
    const ext = new TestableCursorExtractor(cursorDir);
    const data = await ext.extract({ workspace: wsDir });
    const combined = data.raw_memories.map(m => m.content).join('\n');
    expect(combined).toContain('***API_KEY_REDACTED***');
  });
});

// ---------------------------------------------------------------------------
// Meta and stats
// ---------------------------------------------------------------------------

describe('CursorExtractor — meta and stats', () => {
  it('sets meta.source.tool=cursor and extraction_method=file', async () => {
    const ext = new TestableCursorExtractor(cursorDir);
    const data = await ext.extract({});
    expect(data.meta.source.tool).toBe('cursor');
    expect(data.meta.source.extraction_method).toBe('file');
    expect(data.meta.source.workspace).toBe(cursorDir);
  });

  it('returns empty data for an empty global dir', async () => {
    const ext = new TestableCursorExtractor(cursorDir);
    const data = await ext.extract({});
    expect(data.raw_memories).toEqual([]);
    expect(data.profile.preferences).toEqual({});
  });

  it('computes categories from preferences and rule memories', async () => {
    const dir = join(cursorDir, 'rules');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'r.md'), '- some rule here');
    const ext = new TestableCursorExtractor(cursorDir);
    const data = await ext.extract({});
    expect(data.meta.stats.categories).toBeGreaterThan(0);
  });
});
