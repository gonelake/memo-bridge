import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import HermesExtractor from '../../src/extractors/hermes.js';

// Hermes extractor treats options.workspace as the hermes root dir
// (equivalent to ~/.hermes). We build a fake one under tmp to keep the
// test hermetic — no real ~/.hermes access.

let root: string;
let memoriesDir: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'memobridge-hermes-'));
  memoriesDir = join(root, 'memories');
  await mkdir(memoriesDir, { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// MEMORY.md parsing
// ---------------------------------------------------------------------------

describe('HermesExtractor — MEMORY.md parsing', () => {
  const extractor = new HermesExtractor();

  it('parses § separated entries', async () => {
    await writeFile(
      join(memoriesDir, 'MEMORY.md'),
      'Project: MemoBridge§Uses Docker for deployment§Workflow: TDD first',
    );
    const data = await extractor.extract({ workspace: root });
    expect(data.raw_memories).toHaveLength(3);
    expect(data.raw_memories.map(m => m.content)).toContain('Project: MemoBridge');
    expect(data.raw_memories.map(m => m.content)).toContain('Uses Docker for deployment');
  });

  it('falls back to newline-separated parsing when no § is present', async () => {
    await writeFile(
      join(memoriesDir, 'MEMORY.md'),
      [
        'Project: MemoBridge is the main project',
        'Uses Docker for deployment',
        'ignored', // too short (< 5 chars when combined with filter)
      ].join('\n'),
    );
    const data = await extractor.extract({ workspace: root });
    expect(data.raw_memories.length).toBeGreaterThanOrEqual(2);
    expect(data.raw_memories.map(m => m.content)).toContain('Project: MemoBridge is the main project');
  });

  it('skips capacity headers like "MEMORY [67% — 1,474/2,200 chars]"', async () => {
    await writeFile(
      join(memoriesDir, 'MEMORY.md'),
      'MEMORY [67% — 1,474/2,200 chars]§Real entry about projects§===',
    );
    const data = await extractor.extract({ workspace: root });
    // Only "Real entry about projects" passes (capacity header + === are skipped)
    expect(data.raw_memories.map(m => m.content)).toEqual(['Real entry about projects']);
  });

  it('skips entries starting with = (section separator)', async () => {
    await writeFile(
      join(memoriesDir, 'MEMORY.md'),
      'valid memory entry§=====§another valid entry',
    );
    const data = await extractor.extract({ workspace: root });
    expect(data.raw_memories).toHaveLength(2);
  });

  it('strips leading - or * from bullet-style entries', async () => {
    await writeFile(
      join(memoriesDir, 'MEMORY.md'),
      '- bullet dash entry§* bullet star entry',
    );
    const data = await extractor.extract({ workspace: root });
    expect(data.raw_memories[0].content).toBe('bullet dash entry');
    expect(data.raw_memories[1].content).toBe('bullet star entry');
  });

  it('drops entries shorter than 5 characters after cleaning', async () => {
    await writeFile(
      join(memoriesDir, 'MEMORY.md'),
      'tiny§abc§valid long memory entry',
    );
    const data = await extractor.extract({ workspace: root });
    expect(data.raw_memories.map(m => m.content)).toEqual(['valid long memory entry']);
  });

  it('classifies entries by heuristics', async () => {
    await writeFile(
      join(memoriesDir, 'MEMORY.md'),
      [
        'Project: MemoBridge repository',    // -> project
        'User prefers terse responses',      // -> preference
        'Runs on macOS with zsh shell',      // -> environment
        'Workflow: TDD then refactor',       // -> workflow
        'Random fact about the weather',     // -> fact (default)
      ].join('§'),
    );
    const data = await extractor.extract({ workspace: root });
    const byContent = Object.fromEntries(data.raw_memories.map(m => [m.content, m.category]));
    expect(byContent['Project: MemoBridge repository']).toBe('project');
    expect(byContent['User prefers terse responses']).toBe('preference');
    expect(byContent['Runs on macOS with zsh shell']).toBe('environment');
    expect(byContent['Workflow: TDD then refactor']).toBe('workflow');
    expect(byContent['Random fact about the weather']).toBe('fact');
  });

  it('assigns sequential hermes-mem-N ids', async () => {
    await writeFile(
      join(memoriesDir, 'MEMORY.md'),
      'first long entry§second long entry§third long entry',
    );
    const data = await extractor.extract({ workspace: root });
    expect(data.raw_memories.map(m => m.id)).toEqual([
      'hermes-mem-0', 'hermes-mem-1', 'hermes-mem-2',
    ]);
  });

  it('assigns source=MEMORY.md and confidence=0.9 to memory entries', async () => {
    await writeFile(join(memoriesDir, 'MEMORY.md'), 'a valid memory entry');
    const data = await extractor.extract({ workspace: root });
    expect(data.raw_memories[0].source).toBe('MEMORY.md');
    expect(data.raw_memories[0].confidence).toBe(0.9);
  });

  it('infers work_patterns when MEMORY entry mentions os / shell / editor', async () => {
    await writeFile(
      join(memoriesDir, 'MEMORY.md'),
      'OS: macOS 14§shell: zsh§editor: neovim',
    );
    const data = await extractor.extract({ workspace: root });
    expect(data.profile.work_patterns['OS']).toBe('macOS 14');
    expect(data.profile.work_patterns['shell']).toBe('zsh');
    expect(data.profile.work_patterns['editor']).toBe('neovim');
  });
});

// ---------------------------------------------------------------------------
// USER.md parsing
// ---------------------------------------------------------------------------

describe('HermesExtractor — USER.md parsing', () => {
  const extractor = new HermesExtractor();

  it('splits kv entries into identity vs preferences', async () => {
    await writeFile(
      join(memoriesDir, 'USER.md'),
      [
        'role: engineer',
        'name: Alice',
        'prefer: terse replies',
        'communication style: direct',
        '风格：简洁',
        '偏好：中文回答',
      ].join('\n'),
    );
    const data = await extractor.extract({ workspace: root });

    // preferences
    expect(data.profile.preferences['prefer']).toBe('terse replies');
    expect(data.profile.preferences['communication style']).toBe('direct');
    expect(data.profile.preferences['风格']).toBe('简洁');
    expect(data.profile.preferences['偏好']).toBe('中文回答');
    // identity (everything else with a kv shape)
    expect(data.profile.identity['role']).toBe('engineer');
    expect(data.profile.identity['name']).toBe('Alice');
  });

  it('falls back to a "用户特征-N" key for non-kv lines', async () => {
    await writeFile(
      join(memoriesDir, 'USER.md'),
      [
        'role: engineer',
        'standalone trait without a colon',
      ].join('\n'),
    );
    const data = await extractor.extract({ workspace: root });
    const prefEntries = Object.entries(data.profile.preferences);
    const traitKey = prefEntries.find(([k]) => k.startsWith('用户特征-'));
    expect(traitKey?.[1]).toBe('standalone trait without a colon');
  });

  it('skips USER/PROFILE capacity headers and = separators', async () => {
    await writeFile(
      join(memoriesDir, 'USER.md'),
      [
        'USER [20% — 100/1,375 chars]',
        '=====',
        'role: engineer',
      ].join('\n'),
    );
    const data = await extractor.extract({ workspace: root });
    expect(data.profile.identity['role']).toBe('engineer');
    expect(data.profile.identity['USER']).toBeUndefined();
  });

  it('strips bullet prefixes from USER entries', async () => {
    await writeFile(
      join(memoriesDir, 'USER.md'),
      '- role: engineer\n* style: terse',
    );
    const data = await extractor.extract({ workspace: root });
    expect(data.profile.identity['role']).toBe('engineer');
    expect(data.profile.preferences['style']).toBe('terse');
  });
});

// ---------------------------------------------------------------------------
// config.yaml parsing
// ---------------------------------------------------------------------------

describe('HermesExtractor — config.yaml parsing', () => {
  const extractor = new HermesExtractor();

  it('extracts Hermes model into work_patterns', async () => {
    await writeFile(
      join(root, 'config.yaml'),
      [
        'version: 1',
        'model: "claude-sonnet-4"',
        'other: stuff',
      ].join('\n'),
    );
    const data = await extractor.extract({ workspace: root });
    expect(data.profile.work_patterns['Hermes 模型']).toBe('claude-sonnet-4');
  });

  it('extracts platforms into work_patterns', async () => {
    await writeFile(
      join(root, 'config.yaml'),
      [
        'telegram:',
        '  token: xxx',
        'discord:',
        '  token: yyy',
        'email:',
        '  addr: foo@bar',
      ].join('\n'),
    );
    const data = await extractor.extract({ workspace: root });
    const platforms = data.profile.work_patterns['Hermes 平台'];
    expect(platforms).toContain('telegram');
    expect(platforms).toContain('discord');
    expect(platforms).toContain('email');
  });

  it('is a no-op when config.yaml is absent', async () => {
    await writeFile(join(memoriesDir, 'MEMORY.md'), 'some memory');
    const data = await extractor.extract({ workspace: root });
    expect(data.profile.work_patterns['Hermes 模型']).toBeUndefined();
    expect(data.profile.work_patterns['Hermes 平台']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// skills directory
// ---------------------------------------------------------------------------

describe('HermesExtractor — skills directory', () => {
  const extractor = new HermesExtractor();

  it('collects skill directory names into extensions.hermes.skills', async () => {
    const skillsDir = join(root, 'skills');
    await mkdir(join(skillsDir, 'code-review'), { recursive: true });
    await mkdir(join(skillsDir, 'doc-writer'), { recursive: true });
    await writeFile(join(skillsDir, 'readme.txt'), 'not a dir skill');

    const data = await extractor.extract({ workspace: root });
    const skills = data.extensions?.hermes?.skills as string[] | undefined;
    expect(skills).toBeTruthy();
    expect(skills).toContain('code-review');
    expect(skills).toContain('doc-writer');
    expect(skills).not.toContain('readme.txt'); // files excluded
  });

  it('does not pollute raw_memories with a hermes-skills entry', async () => {
    const skillsDir = join(root, 'skills');
    await mkdir(join(skillsDir, 'code-review'), { recursive: true });
    const data = await extractor.extract({ workspace: root });
    expect(data.raw_memories.find(m => m.id === 'hermes-skills')).toBeUndefined();
  });

  it('omits extensions.hermes when the directory has no subdirs', async () => {
    const data = await extractor.extract({ workspace: root });
    expect(data.extensions?.hermes).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Meta and stats
// ---------------------------------------------------------------------------

describe('HermesExtractor — meta and stats', () => {
  const extractor = new HermesExtractor();

  it('sets meta.source.tool=hermes and extraction_method=file', async () => {
    const data = await extractor.extract({ workspace: root });
    expect(data.meta.source.tool).toBe('hermes');
    expect(data.meta.source.extraction_method).toBe('file');
    expect(data.meta.source.workspace).toBe(root);
  });

  it('returns empty data when no files exist', async () => {
    // Fresh empty hermes dir (only the created memories/ subdir)
    const data = await extractor.extract({ workspace: root });
    expect(data.raw_memories).toEqual([]);
    expect(data.profile.identity).toEqual({});
    expect(data.profile.preferences).toEqual({});
    expect(data.meta.stats.total_memories).toBe(0);
  });

  it('computes total_memories from all contributions', async () => {
    await writeFile(join(memoriesDir, 'MEMORY.md'), 'first long entry§second entry');
    await writeFile(join(memoriesDir, 'USER.md'), 'role: engineer');
    const data = await extractor.extract({ workspace: root });
    // 2 raw + 1 identity = 3
    expect(data.meta.stats.total_memories).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Privacy integration
// ---------------------------------------------------------------------------

describe('HermesExtractor — privacy integration', () => {
  const extractor = new HermesExtractor();

  it('redacts secrets from MEMORY.md before storing them', async () => {
    await writeFile(
      join(memoriesDir, 'MEMORY.md'),
      'Deployed with GitHub token ghp_abcdefghijklmnopqrstuvwxyz0123456789',
    );
    const data = await extractor.extract({ workspace: root });
    const combined = data.raw_memories.map(m => m.content).join('\n');
    expect(combined).toContain('ghp_***REDACTED***');
    expect(combined).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz0123456789');
  });

  it('does NOT redact USER.md (by design — profile is less secret-prone)', async () => {
    // This is a documented behavior of the current implementation:
    // parseHermesUser uses raw content, not scanAndRedact. Capture this
    // so a future change is an intentional decision, not accidental.
    await writeFile(
      join(memoriesDir, 'USER.md'),
      'email: admin@example.com\nrole: engineer',
    );
    const data = await extractor.extract({ workspace: root });
    // No redaction was applied to USER.md in the current implementation
    expect(data.profile.identity['email']).toBe('admin@example.com');
  });
});
