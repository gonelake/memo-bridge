import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ClaudeCodeExtractor from '../../src/extractors/claude-code.js';

// Claude Code's extract() hits ~/.claude by default. We subclass and
// override getGlobalDir() so tests point at a hermetic tmp tree instead.

let claudeDir: string;
let wsDir: string;

class TestableClaudeCodeExtractor extends ClaudeCodeExtractor {
  constructor(private readonly overrideDir: string) { super(); }
  protected getGlobalDir(): string { return this.overrideDir; }
}

beforeEach(async () => {
  const root = await mkdtemp(join(tmpdir(), 'memobridge-claude-'));
  claudeDir = join(root, 'claude');
  wsDir = join(root, 'ws');
  await mkdir(claudeDir, { recursive: true });
  await mkdir(wsDir, { recursive: true });
});

afterEach(async () => {
  // claudeDir and wsDir share a parent; remove that.
  await rm(join(claudeDir, '..'), { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Global CLAUDE.md
// ---------------------------------------------------------------------------

describe('ClaudeCodeExtractor — global CLAUDE.md', () => {
  it('parses global CLAUDE.md bullets into raw memories', async () => {
    await writeFile(
      join(claudeDir, 'CLAUDE.md'),
      [
        '# Global instructions',
        '- always use TypeScript strict mode',
        '- this is a long fact about Claude behavior',
      ].join('\n'),
    );
    const ext = new TestableClaudeCodeExtractor(claudeDir);
    const data = await ext.extract({});
    const globalMemories = data.raw_memories.filter(m => m.source === 'global');
    expect(globalMemories.length).toBeGreaterThan(0);
  });

  it('returns empty data when global CLAUDE.md is absent', async () => {
    const ext = new TestableClaudeCodeExtractor(claudeDir);
    const data = await ext.extract({});
    expect(data.raw_memories).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Per-project CLAUDE.md files under ~/.claude/projects/
// ---------------------------------------------------------------------------

describe('ClaudeCodeExtractor — project CLAUDE.md files', () => {
  it('walks ~/.claude/projects/<hash>/CLAUDE.md subdirectories', async () => {
    const projectsDir = join(claudeDir, 'projects');
    await mkdir(join(projectsDir, 'hash-aaa'), { recursive: true });
    await mkdir(join(projectsDir, 'hash-bbb'), { recursive: true });
    await writeFile(
      join(projectsDir, 'hash-aaa', 'CLAUDE.md'),
      '- this is a fact from project aaa',
    );
    await writeFile(
      join(projectsDir, 'hash-bbb', 'CLAUDE.md'),
      '- this is a fact from project bbb',
    );

    const ext = new TestableClaudeCodeExtractor(claudeDir);
    const data = await ext.extract({});
    const sources = data.raw_memories.map(m => m.source);
    expect(sources).toContain('project:hash-aaa');
    expect(sources).toContain('project:hash-bbb');
  });

  it('skips project subdirs that have no CLAUDE.md', async () => {
    const projectsDir = join(claudeDir, 'projects');
    await mkdir(join(projectsDir, 'hash-empty'), { recursive: true });
    const ext = new TestableClaudeCodeExtractor(claudeDir);
    const data = await ext.extract({});
    expect(data.raw_memories).toEqual([]);
  });

  it('is safe when the projects/ directory does not exist', async () => {
    const ext = new TestableClaudeCodeExtractor(claudeDir);
    const data = await ext.extract({});
    expect(data.raw_memories).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// memory.md (from /memory command)
// ---------------------------------------------------------------------------

describe('ClaudeCodeExtractor — manual memory.md', () => {
  it('parses memory.md with source=manual-memory', async () => {
    await writeFile(
      join(claudeDir, 'memory.md'),
      '- this is a fact saved via the /memory command',
    );
    const ext = new TestableClaudeCodeExtractor(claudeDir);
    const data = await ext.extract({});
    expect(data.raw_memories.some(m => m.source === 'manual-memory')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Workspace-level CLAUDE.md (when --workspace is passed)
// ---------------------------------------------------------------------------

describe('ClaudeCodeExtractor — workspace CLAUDE.md', () => {
  it('parses workspace CLAUDE.md when options.workspace is provided', async () => {
    await writeFile(
      join(wsDir, 'CLAUDE.md'),
      '- this is a workspace-level instruction',
    );
    const ext = new TestableClaudeCodeExtractor(claudeDir);
    const data = await ext.extract({ workspace: wsDir });
    const sources = data.raw_memories.map(m => m.source);
    expect(sources).toContain(`workspace:${wsDir}`);
  });

  it('does not read workspace CLAUDE.md when options.workspace is absent', async () => {
    await writeFile(
      join(wsDir, 'CLAUDE.md'),
      '- workspace instruction that should not be read',
    );
    const ext = new TestableClaudeCodeExtractor(claudeDir);
    const data = await ext.extract({});
    expect(data.raw_memories).toEqual([]);
  });

  it('is safe when workspace has no CLAUDE.md', async () => {
    const ext = new TestableClaudeCodeExtractor(claudeDir);
    // Empty workspace — should not throw
    const data = await ext.extract({ workspace: wsDir });
    expect(data.raw_memories).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// parseClaudeMd — classification rules
// ---------------------------------------------------------------------------

describe('ClaudeCodeExtractor — bullet classification', () => {
  async function extractWith(globalContent: string) {
    await writeFile(join(claudeDir, 'CLAUDE.md'), globalContent);
    const ext = new TestableClaudeCodeExtractor(claudeDir);
    return ext.extract({});
  }

  it('classifies preference keywords into profile.preferences', async () => {
    const data = await extractWith([
      '- I prefer terse responses over chatty ones',
      '- always use strict mode',
      '- never commit secrets to the repo',
      '- 偏好简洁的回答',
    ].join('\n'));
    // All four should land in preferences (not raw_memories)
    expect(Object.keys(data.profile.preferences).length).toBe(4);
    // And these specific ones should NOT appear as raw memories
    const rawContent = data.raw_memories.map(m => m.content).join('\n');
    expect(rawContent).not.toContain('prefer terse');
    expect(rawContent).not.toContain('always use');
  });

  it('classifies project-related bullets as project memories', async () => {
    const data = await extractWith([
      '- working on MemoBridge project this week',
      '- the 项目 is in active development',
    ].join('\n'));
    const projectMems = data.raw_memories.filter(m => m.category === 'project');
    expect(projectMems).toHaveLength(2);
    expect(projectMems[0].confidence).toBe(0.9);
  });

  it('defaults other bullets to category=fact with confidence 0.85', async () => {
    const data = await extractWith([
      '- the team uses TypeScript strict mode',
      '- deployments happen on Fridays',
    ].join('\n'));
    const facts = data.raw_memories.filter(m => m.category === 'fact');
    expect(facts).toHaveLength(2);
    expect(facts[0].confidence).toBe(0.85);
  });

  it('captures non-bullet prose over 10 chars as instruction memories', async () => {
    const data = await extractWith([
      '# Heading skipped',
      '',
      'This is free-form prose that describes context and is captured as instruction.',
      'short', // < 10 chars — skipped
    ].join('\n'));
    const instructions = data.raw_memories.filter(m => m.category === 'instruction');
    expect(instructions).toHaveLength(1);
    expect(instructions[0].content).toContain('free-form prose');
    expect(instructions[0].confidence).toBe(0.8);
  });

  it('truncates long prose to 300 chars', async () => {
    const longProse = 'A'.repeat(500);
    const data = await extractWith(longProse);
    const inst = data.raw_memories.find(m => m.category === 'instruction');
    expect(inst).toBeTruthy();
    expect(inst!.content.length).toBe(300);
  });

  it('skips headers (lines starting with #)', async () => {
    const data = await extractWith([
      '# header 1',
      '## header 2',
      '- this is a valid bullet fact',
    ].join('\n'));
    expect(data.raw_memories).toHaveLength(1);
    expect(data.raw_memories[0].content).toContain('valid bullet fact');
  });

  it('strips - or * bullet prefixes', async () => {
    const data = await extractWith([
      '- dash bullet',
      '* star bullet',
    ].join('\n'));
    const contents = data.raw_memories.map(m => m.content);
    expect(contents).toContain('dash bullet');
    expect(contents).toContain('star bullet');
  });

  it('drops bullets with fewer than 5 chars', async () => {
    const data = await extractWith([
      '- tiny',  // 4 chars after strip — dropped
      '- abcd',  // 4 chars — dropped
      '- 5char',  // 5 chars — kept
    ].join('\n'));
    expect(data.raw_memories).toHaveLength(1);
    expect(data.raw_memories[0].content).toBe('5char');
  });
});

// ---------------------------------------------------------------------------
// Privacy integration
// ---------------------------------------------------------------------------

describe('ClaudeCodeExtractor — privacy integration', () => {
  it('redacts secrets from global CLAUDE.md', async () => {
    await writeFile(
      join(claudeDir, 'CLAUDE.md'),
      '- deploy token is ghp_abcdefghijklmnopqrstuvwxyz0123456789 for CI',
    );
    const ext = new TestableClaudeCodeExtractor(claudeDir);
    const data = await ext.extract({});
    const combined = data.raw_memories.map(m => m.content).join('\n');
    expect(combined).toContain('ghp_***REDACTED***');
    expect(combined).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz0123456789');
  });

  it('redacts secrets from project CLAUDE.md', async () => {
    const p = join(claudeDir, 'projects', 'hash-x');
    await mkdir(p, { recursive: true });
    await writeFile(
      join(p, 'CLAUDE.md'),
      '- api_key: "verylongsecretvalue123456"',
    );
    const ext = new TestableClaudeCodeExtractor(claudeDir);
    const data = await ext.extract({});
    const combined = [
      ...data.raw_memories.map(m => m.content),
      ...Object.values(data.profile.preferences),
    ].join('\n');
    expect(combined).toContain('***API_KEY_REDACTED***');
  });

  it('redacts secrets from workspace CLAUDE.md', async () => {
    await writeFile(
      join(wsDir, 'CLAUDE.md'),
      '- db password: "supersecret9999"',
    );
    const ext = new TestableClaudeCodeExtractor(claudeDir);
    const data = await ext.extract({ workspace: wsDir });
    const combined = [
      ...data.raw_memories.map(m => m.content),
      ...Object.values(data.profile.preferences),
    ].join('\n');
    expect(combined).toContain('***PASSWORD_REDACTED***');
  });
});

// ---------------------------------------------------------------------------
// Meta and stats
// ---------------------------------------------------------------------------

describe('ClaudeCodeExtractor — meta and stats', () => {
  it('sets meta.source.tool=claude-code', async () => {
    const ext = new TestableClaudeCodeExtractor(claudeDir);
    const data = await ext.extract({});
    expect(data.meta.source.tool).toBe('claude-code');
    expect(data.meta.source.extraction_method).toBe('file');
    expect(data.meta.source.workspace).toBe(claudeDir);
  });

  it('counts categories including preferences and raw memories', async () => {
    await writeFile(
      join(claudeDir, 'CLAUDE.md'),
      [
        '- prefer terse output',
        '- working on MemoBridge',
        '- random fact here',
      ].join('\n'),
    );
    const ext = new TestableClaudeCodeExtractor(claudeDir);
    const data = await ext.extract({});
    expect(data.meta.stats.categories).toBeGreaterThan(0);
  });

  it('returns an empty skeleton when nothing is present', async () => {
    const ext = new TestableClaudeCodeExtractor(claudeDir);
    const data = await ext.extract({});
    expect(data.raw_memories).toEqual([]);
    expect(data.profile.identity).toEqual({});
    expect(data.profile.preferences).toEqual({});
  });
});
