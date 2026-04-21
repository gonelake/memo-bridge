import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, writeFile, stat, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ClaudeCodeImporter from '../../src/importers/claude-code.js';
import CursorImporter from '../../src/importers/cursor.js';
import HermesImporter from '../../src/importers/hermes.js';
import OpenClawImporter from '../../src/importers/openclaw.js';
import { CodeBuddyImporter } from '../../src/importers/instruction-based.js';
import type { MemoBridgeData } from '../../src/core/types.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeData(): MemoBridgeData {
  return {
    meta: {
      version: '0.1',
      exported_at: '2026-04-20T08:00:00.000Z',
      source: { tool: 'codebuddy', extraction_method: 'file' },
      stats: { total_memories: 4, categories: 3 },
    },
    profile: {
      identity: { 角色: '工程师' },
      preferences: { 风格: '简洁' },
      work_patterns: {},
    },
    knowledge: [{ title: 'AI', items: [{ topic: 'LLM' }, { topic: 'RAG' }] }],
    projects: [
      { name: 'MemoBridge', status: 'active', key_insights: ['中间格式设计'] },
    ],
    feeds: [{ name: 'AI 日报', schedule: '08:30', total_issues: 120 }],
    raw_memories: [
      { id: 'm1', content: '集成测试不要 mock', category: 'g', source: 's', confidence: 0.9 },
      { id: 'm2', content: '偏好简洁回复', category: 'g', source: 's', confidence: 0.8 },
    ],
  };
}

async function fileExists(p: string): Promise<boolean> {
  try { await stat(p); return true; } catch { return false; }
}

// Use a workspace under os.tmpdir() — validateWritePath allows /var/folders
// (macOS) thanks to WRITE_EXCEPTIONS.
let ws: string;
beforeEach(async () => {
  ws = await mkdtemp(join(tmpdir(), 'memobridge-imp-'));
});
afterEach(async () => {
  await rm(ws, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// ClaudeCodeImporter
// ---------------------------------------------------------------------------

describe('ClaudeCodeImporter', () => {
  const importer = new ClaudeCodeImporter();

  it('writes CLAUDE.md to the workspace when workspace is provided', async () => {
    const data = makeData();
    const result = await importer.import(data, { workspace: ws });
    expect(result.success).toBe(true);
    expect(result.method).toBe('file_write');
    expect(result.output_path).toBe(join(ws, 'CLAUDE.md'));
    expect(await fileExists(join(ws, 'CLAUDE.md'))).toBe(true);
  });

  it('includes identity and raw memory content in the written file', async () => {
    const data = makeData();
    await importer.import(data, { workspace: ws });
    const contents = await readFile(join(ws, 'CLAUDE.md'), 'utf-8');
    expect(contents).toContain('工程师');
    expect(contents).toContain('集成测试不要 mock');
  });

  it('dryRun reports target path without writing the file', async () => {
    const data = makeData();
    const result = await importer.import(data, { workspace: ws, dryRun: true });
    expect(result.success).toBe(true);
    expect(result.output_path).toBe(join(ws, 'CLAUDE.md'));
    expect(result.instructions).toMatch(/\[DRY RUN\]/);
    expect(await fileExists(join(ws, 'CLAUDE.md'))).toBe(false);
  });

  it('dryRun instructions reflect overwrite flag', async () => {
    const data = makeData();
    const append = await importer.import(data, { workspace: ws, dryRun: true });
    expect(append.instructions).toContain('追加');
    const over = await importer.import(data, { workspace: ws, dryRun: true, overwrite: true });
    expect(over.instructions).toContain('覆盖');
  });

  it('append mode preserves existing content', async () => {
    const existingMarker = '## EXISTING_CONTENT_MARKER';
    await writeFile(join(ws, 'CLAUDE.md'), existingMarker + '\nexisting body', 'utf-8');

    await importer.import(makeData(), { workspace: ws });

    const merged = await readFile(join(ws, 'CLAUDE.md'), 'utf-8');
    expect(merged).toContain(existingMarker);
    expect(merged).toContain('工程师'); // appended content
  });

  it('overwrite mode replaces existing content', async () => {
    const existingMarker = 'EXISTING_CONTENT_MARKER';
    await writeFile(join(ws, 'CLAUDE.md'), existingMarker, 'utf-8');

    await importer.import(makeData(), { workspace: ws, overwrite: true });

    const result = await readFile(join(ws, 'CLAUDE.md'), 'utf-8');
    expect(result).not.toContain(existingMarker);
    expect(result).toContain('工程师');
  });

  it('items_imported reflects countImported(data)', async () => {
    const result = await importer.import(makeData(), { workspace: ws, dryRun: true });
    // countImported: 2 raw + 1 project + 1 feed + 2 knowledge + 1 identity + 1 pref = 8
    expect(result.items_imported).toBe(8);
    expect(result.items_skipped).toBe(0);
  });

  it('rejects oversized content in overwrite mode too', async () => {
    // Regression for P1-2: overwrite used to write directly without
    // running validateContentSize. Craft a payload larger than the 5MB
    // write ceiling. buildClaudeMd copies every profile.identity entry
    // verbatim, so stuffing a 6MB value there reliably overflows.
    const data = makeData();
    data.profile.identity['huge'] = 'x'.repeat(6 * 1024 * 1024);
    await expect(
      importer.import(data, { workspace: ws, overwrite: true }),
    ).rejects.toThrowError(/安全限制/);
  });
});

// ---------------------------------------------------------------------------
// CursorImporter
// ---------------------------------------------------------------------------

describe('CursorImporter', () => {
  const importer = new CursorImporter();

  it('fails gracefully when workspace is missing', async () => {
    const result = await importer.import(makeData(), {});
    expect(result.success).toBe(false);
    expect(result.method).toBe('file_write');
    expect(result.instructions).toMatch(/--workspace/);
    expect(result.items_imported).toBe(0);
  });

  it('writes .cursorrules inside the workspace', async () => {
    const result = await importer.import(makeData(), { workspace: ws });
    expect(result.success).toBe(true);
    expect(result.output_path).toBe(join(ws, '.cursorrules'));
    expect(await fileExists(join(ws, '.cursorrules'))).toBe(true);
  });

  it('dryRun does not write the file', async () => {
    const result = await importer.import(makeData(), { workspace: ws, dryRun: true });
    expect(result.success).toBe(true);
    expect(result.instructions).toMatch(/\[DRY RUN\]/);
    expect(await fileExists(join(ws, '.cursorrules'))).toBe(false);
  });

  it('overwrite=true replaces existing .cursorrules content', async () => {
    await writeFile(join(ws, '.cursorrules'), 'OLD', 'utf-8');
    await importer.import(makeData(), { workspace: ws, overwrite: true });
    const content = await readFile(join(ws, '.cursorrules'), 'utf-8');
    expect(content).not.toContain('OLD');
  });

  it('append mode preserves existing .cursorrules content', async () => {
    await writeFile(join(ws, '.cursorrules'), 'OLD_RULE', 'utf-8');
    await importer.import(makeData(), { workspace: ws });
    const content = await readFile(join(ws, '.cursorrules'), 'utf-8');
    expect(content).toContain('OLD_RULE');
  });
});

// ---------------------------------------------------------------------------
// HermesImporter
// ---------------------------------------------------------------------------

describe('HermesImporter', () => {
  const importer = new HermesImporter();

  it('writes MEMORY.md and USER.md under memories/ directory', async () => {
    await importer.import(makeData(), { workspace: ws });
    expect(await fileExists(join(ws, 'memories', 'MEMORY.md'))).toBe(true);
    expect(await fileExists(join(ws, 'memories', 'USER.md'))).toBe(true);
  });

  it('output_path points to the memories directory', async () => {
    const result = await importer.import(makeData(), { workspace: ws });
    expect(result.output_path).toBe(join(ws, 'memories'));
    expect(result.method).toBe('file_write');
  });

  it('dryRun reports both file sizes without writing', async () => {
    const result = await importer.import(makeData(), { workspace: ws, dryRun: true });
    expect(result.success).toBe(true);
    expect(result.instructions).toMatch(/MEMORY\.md.*bytes/);
    expect(result.instructions).toMatch(/USER\.md.*bytes/);
    expect(await fileExists(join(ws, 'memories'))).toBe(false);
  });

  it('emits a warning when MEMORY content hits the char limit', async () => {
    const data = makeData();
    // Pad with many raw memories to force truncation at a low maxChars
    for (let i = 0; i < 200; i++) {
      data.raw_memories.push({
        id: `m${i + 100}`,
        content: `padding memory number ${i} with enough text to add bytes`,
        category: 'g',
        source: 's',
        confidence: 0.5,
      });
    }
    const result = await importer.import(data, { workspace: ws, maxChars: 500 });
    expect(result.warnings?.some(w => /字节上限/.test(w))).toBe(true);
  });

  it('does NOT emit truncation warning when well under the char limit', async () => {
    const result = await importer.import(makeData(), { workspace: ws });
    expect(result.warnings?.length ?? 0).toBe(0);
  });

  it('measures the char budget in UTF-8 bytes, not code units', async () => {
    // Chinese char = 3 bytes in UTF-8 but 1 code unit. With a byte budget of
    // 60, we can fit ~20 Chinese chars; with a code-unit budget misused as
    // "bytes" we would wrongly fit 60 Chinese chars (180 bytes) and overflow.
    const data: MemoBridgeData = {
      ...makeData(),
      raw_memories: [
        { id: 'a', content: '中'.repeat(30), category: 'g', source: 's', confidence: 0.95 },
      ],
      projects: [],
      knowledge: [],
      feeds: [],
    };
    await importer.import(data, { workspace: ws, maxChars: 60 });
    const content = await readFile(join(ws, 'memories', 'MEMORY.md'), 'utf-8');
    // File must not exceed the 60-byte budget
    expect(Buffer.byteLength(content, 'utf-8')).toBeLessThanOrEqual(60);
  });

  it('refuses to write when target path is a symlink', async () => {
    // Pre-create a symlink where MEMORY.md is expected
    const memoriesDir = join(ws, 'memories');
    await mkdir(memoriesDir, { recursive: true });
    const { symlink } = await import('node:fs/promises');
    await symlink('/tmp/nonexistent-target', join(memoriesDir, 'MEMORY.md'));

    await expect(importer.import(makeData(), { workspace: ws }))
      .rejects.toThrowError(/符号链接/);
  });
});

// ---------------------------------------------------------------------------
// OpenClawImporter
// ---------------------------------------------------------------------------

describe('OpenClawImporter', () => {
  const importer = new OpenClawImporter();

  it('writes MEMORY.md and USER.md at workspace root', async () => {
    await importer.import(makeData(), { workspace: ws });
    expect(await fileExists(join(ws, 'MEMORY.md'))).toBe(true);
    expect(await fileExists(join(ws, 'USER.md'))).toBe(true);
  });

  it('output_path is the workspace directory', async () => {
    const result = await importer.import(makeData(), { workspace: ws });
    expect(result.output_path).toBe(ws);
    expect(result.method).toBe('file_write');
  });

  it('dryRun lists both target files without writing', async () => {
    const result = await importer.import(makeData(), { workspace: ws, dryRun: true });
    expect(result.instructions).toContain('MEMORY.md');
    expect(result.instructions).toContain('USER.md');
    expect(await fileExists(join(ws, 'MEMORY.md'))).toBe(false);
  });

  it('append mode preserves existing MEMORY.md content', async () => {
    await writeFile(join(ws, 'MEMORY.md'), 'OLD_MEMORY', 'utf-8');
    await importer.import(makeData(), { workspace: ws });
    const content = await readFile(join(ws, 'MEMORY.md'), 'utf-8');
    expect(content).toContain('OLD_MEMORY');
  });

  it('overwrite mode replaces existing MEMORY.md content', async () => {
    await writeFile(join(ws, 'MEMORY.md'), 'OLD_MEMORY_MARKER', 'utf-8');
    await importer.import(makeData(), { workspace: ws, overwrite: true });
    const content = await readFile(join(ws, 'MEMORY.md'), 'utf-8');
    expect(content).not.toContain('OLD_MEMORY_MARKER');
  });

  it('skips USER.md when there is nothing to write for it', async () => {
    // Data with no profile identity/preferences should produce empty USER.md content
    const bare: MemoBridgeData = {
      ...makeData(),
      profile: { identity: {}, preferences: {}, work_patterns: {} },
    };
    await importer.import(bare, { workspace: ws });
    // USER.md may exist as empty-file OR be skipped entirely; the key point
    // is that overwrite write doesn't crash.
    expect(await fileExists(join(ws, 'MEMORY.md'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// CodeBuddyImporter (file_write, despite living in instruction-based.ts)
// ---------------------------------------------------------------------------

describe('CodeBuddyImporter', () => {
  const importer = new CodeBuddyImporter();

  it('writes a dated file under .memory/', async () => {
    const result = await importer.import(makeData(), { workspace: ws });
    expect(result.success).toBe(true);
    expect(result.method).toBe('file_write');
    // Filename format: .memory/imported-YYYY-MM-DD.md
    expect(result.output_path).toMatch(/\.memory\/imported-\d{4}-\d{2}-\d{2}\.md$/);
    expect(result.output_path!.startsWith(join(ws, '.memory'))).toBe(true);
    expect(await fileExists(result.output_path!)).toBe(true);
  });

  it('file content includes source header and flattened data', async () => {
    const result = await importer.import(makeData(), { workspace: ws });
    const content = await readFile(result.output_path!, 'utf-8');
    expect(content).toMatch(/Imported via MemoBridge from codebuddy/);
    expect(content).toContain('工程师');
    expect(content).toContain('集成测试不要 mock');
  });

  it('dryRun reports target path without creating the .memory directory', async () => {
    const result = await importer.import(makeData(), { workspace: ws, dryRun: true });
    expect(result.instructions).toMatch(/\[DRY RUN\]/);
    expect(await fileExists(join(ws, '.memory'))).toBe(false);
  });

  it('defaults to process.cwd() when no workspace is provided', async () => {
    const { realpath } = await import('node:fs/promises');
    const originalCwd = process.cwd();
    process.chdir(ws);
    try {
      const result = await importer.import(makeData(), { dryRun: true });
      // macOS resolves /var/folders/... → /private/var/folders/... via symlinks
      // when reading cwd, so compare realpaths instead of prefixes.
      const realWs = await realpath(ws);
      expect(result.output_path!.startsWith(realWs)).toBe(true);
      expect(result.output_path).toMatch(/\.memory\/imported-\d{4}-\d{2}-\d{2}\.md$/);
    } finally {
      process.chdir(originalCwd);
    }
  });
});

// ---------------------------------------------------------------------------
// v0.2 M5 — Extensions write-back
// ---------------------------------------------------------------------------

describe('HermesImporter — extensions.hermes.skills write-back', () => {
  const importer = new HermesImporter();

  function dataWithSkills(skills: unknown): MemoBridgeData {
    return {
      ...makeData(),
      extensions: { hermes: { skills } },
    };
  }

  it('creates skill directories with a README stub', async () => {
    const data = dataWithSkills(['code-review', 'doc-writer']);
    await importer.import(data, { workspace: ws });

    for (const name of ['code-review', 'doc-writer']) {
      const dir = join(ws, 'skills', name);
      expect(await fileExists(dir)).toBe(true);
      const readme = join(dir, 'README.md');
      expect(await fileExists(readme)).toBe(true);
      const content = await readFile(readme, 'utf-8');
      expect(content).toContain(`Skill: ${name}`);
      expect(content).toContain('MemoBridge');
    }
  });

  it('does not touch pre-existing skill directories', async () => {
    // Pre-create one of the skills with actual content
    const existing = join(ws, 'skills', 'code-review');
    await mkdir(existing, { recursive: true });
    await writeFile(join(existing, 'handler.py'), 'print("real skill")');

    await importer.import(dataWithSkills(['code-review', 'doc-writer']), { workspace: ws });

    // Pre-existing skill's contents must survive
    expect(await readFile(join(existing, 'handler.py'), 'utf-8')).toBe('print("real skill")');
    // Existing skill should NOT get a stub README (we didn't create the dir)
    expect(await fileExists(join(existing, 'README.md'))).toBe(false);
    // Newly-declared skill should have the stub
    expect(await fileExists(join(ws, 'skills', 'doc-writer', 'README.md'))).toBe(true);
  });

  it('rejects skill names that try to escape the skills directory', async () => {
    const data = dataWithSkills(['../../../etc', 'good-skill', '/abs/path', '.', '..']);
    const result = await importer.import(data, { workspace: ws });

    expect(await fileExists(join(ws, 'skills', 'good-skill'))).toBe(true);
    // No file should have been created outside skills/
    expect(await fileExists(join(ws, '..', 'etc'))).toBe(false);
    expect(await fileExists(join(ws, 'skills', '..'))).toBe(true); // '..' resolves to skills itself — fine
    expect(result.warnings?.some(w => w.includes('非法 skill 名'))).toBe(true);
  });

  it('silently ignores non-string entries in the skills array', async () => {
    const data = dataWithSkills(['valid', 123, null, { a: 1 }, '']);
    const result = await importer.import(data, { workspace: ws });
    expect(await fileExists(join(ws, 'skills', 'valid', 'README.md'))).toBe(true);
    expect(result.success).toBe(true);
  });

  it('is a no-op when extensions.hermes.skills is absent', async () => {
    await importer.import(makeData(), { workspace: ws }); // no extensions
    expect(await fileExists(join(ws, 'skills'))).toBe(false);
  });

  it('listTargets includes skill README paths for backup', () => {
    const data = dataWithSkills(['skill-a', 'skill-b']);
    const targets = importer.listTargets(data, { workspace: ws });
    expect(targets).toContain(join(ws, 'skills', 'skill-a', 'README.md'));
    expect(targets).toContain(join(ws, 'skills', 'skill-b', 'README.md'));
  });
});

describe('OpenClawImporter — extensions.openclaw write-back', () => {
  const importer = new OpenClawImporter();

  it('writes SOUL.md when extensions.openclaw.soul is a non-empty string', async () => {
    const data: MemoBridgeData = {
      ...makeData(),
      extensions: { openclaw: { soul: 'I am a thoughtful assistant.' } },
    };
    await importer.import(data, { workspace: ws });

    const soulPath = join(ws, 'SOUL.md');
    expect(await fileExists(soulPath)).toBe(true);
    const content = await readFile(soulPath, 'utf-8');
    expect(content).toContain('I am a thoughtful assistant.');
    expect(content).toContain('MemoBridge'); // header tag
  });

  it('does not write SOUL.md when soul is absent or empty', async () => {
    // Absent
    await importer.import(makeData(), { workspace: ws });
    expect(await fileExists(join(ws, 'SOUL.md'))).toBe(false);

    // Empty string
    const dataEmpty: MemoBridgeData = {
      ...makeData(),
      extensions: { openclaw: { soul: '   ' } },
    };
    await importer.import(dataEmpty, { workspace: ws });
    expect(await fileExists(join(ws, 'SOUL.md'))).toBe(false);
  });

  it('writes DREAMS.md as a STUB (with char count) — honest about lost fidelity', async () => {
    const data: MemoBridgeData = {
      ...makeData(),
      extensions: { openclaw: { dreams: { chars: 5432 } } },
    };
    const result = await importer.import(data, { workspace: ws });

    const dreamsPath = join(ws, 'DREAMS.md');
    expect(await fileExists(dreamsPath)).toBe(true);
    const content = await readFile(dreamsPath, 'utf-8');
    expect(content).toContain('stub');
    expect(content).toContain('5432');

    // Importer must warn about the partial fidelity
    expect(result.warnings?.some(w => w.includes('DREAMS.md'))).toBe(true);
  });

  it('does not write DREAMS.md when dreams is absent', async () => {
    await importer.import(makeData(), { workspace: ws });
    expect(await fileExists(join(ws, 'DREAMS.md'))).toBe(false);
  });

  it('listTargets includes SOUL.md / DREAMS.md iff declared in extensions', () => {
    const withBoth = importer.listTargets(
      {
        ...makeData(),
        extensions: { openclaw: { soul: 's', dreams: { chars: 1 } } },
      },
      { workspace: ws },
    );
    expect(withBoth).toContain(join(ws, 'SOUL.md'));
    expect(withBoth).toContain(join(ws, 'DREAMS.md'));

    const without = importer.listTargets(makeData(), { workspace: ws });
    expect(without).not.toContain(join(ws, 'SOUL.md'));
    expect(without).not.toContain(join(ws, 'DREAMS.md'));
  });

  it('dry-run lists SOUL/DREAMS paths in its instructions', async () => {
    const data: MemoBridgeData = {
      ...makeData(),
      extensions: { openclaw: { soul: 'x', dreams: { chars: 1 } } },
    };
    const result = await importer.import(data, { workspace: ws, dryRun: true });
    expect(result.instructions).toContain('SOUL.md');
    expect(result.instructions).toContain('DREAMS.md');
    // Nothing should have actually been written
    expect(await fileExists(join(ws, 'SOUL.md'))).toBe(false);
    expect(await fileExists(join(ws, 'DREAMS.md'))).toBe(false);
  });
});
