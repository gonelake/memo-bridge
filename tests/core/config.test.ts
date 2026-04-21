import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig, DEFAULT_CONFIG } from '../../src/core/config.js';

// ---------------------------------------------------------------------------
// Scaffolding — isolated home & cwd so real user configs don't leak in
// ---------------------------------------------------------------------------

let testHome: string;
let testCwd: string;

beforeEach(async () => {
  const root = await mkdir(
    join(tmpdir(), `memobridge-config-${Date.now()}-${Math.random().toString(36).slice(2)}`),
    { recursive: true },
  ) as string;
  testHome = join(root, 'home');
  testCwd = join(root, 'cwd');
  await mkdir(testHome, { recursive: true });
  await mkdir(testCwd, { recursive: true });
});

afterEach(async () => {
  await rm(join(testHome, '..'), { recursive: true, force: true });
});

async function writeGlobalConfig(yaml: string): Promise<void> {
  const dir = join(testHome, '.config', 'memobridge');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'config.yaml'), yaml, 'utf-8');
}

async function writeProjectConfig(yaml: string, dir: string = testCwd): Promise<void> {
  await writeFile(join(dir, '.memobridge.yaml'), yaml, 'utf-8');
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

describe('loadConfig — defaults', () => {
  it('returns default config when neither file exists', async () => {
    const cfg = await loadConfig({ cwd: testCwd, home: testHome });
    expect(cfg.defaultWorkspace).toBeUndefined();
    expect(cfg.privacy.extraPatterns).toEqual([]);
    expect(cfg.quality.importanceKeywords).toEqual([]);
    expect(cfg.backup.retention).toBe(DEFAULT_CONFIG.backup.retention);
  });

  it('has a fully-populated result shape (no undefined nested fields)', async () => {
    const cfg = await loadConfig({ cwd: testCwd, home: testHome });
    expect(cfg.privacy).toBeDefined();
    expect(cfg.quality).toBeDefined();
    expect(cfg.backup).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Global config
// ---------------------------------------------------------------------------

describe('loadConfig — global only', () => {
  it('reads default_workspace from global', async () => {
    await writeGlobalConfig('default_workspace: /global/ws\n');
    const cfg = await loadConfig({ cwd: testCwd, home: testHome });
    expect(cfg.defaultWorkspace).toBe('/global/ws');
  });

  it('reads privacy.extra_patterns, dropping invalid regexes with warning', async () => {
    await writeGlobalConfig([
      'privacy:',
      '  extra_patterns:',
      '    - "INTERNAL-\\\\d{6}"',
      '    - "INVALID[("',   // bad regex
      '    - ""',             // empty
    ].join('\n'));
    const cfg = await loadConfig({ cwd: testCwd, home: testHome });
    expect(cfg.privacy.extraPatterns).toHaveLength(1);
    expect(cfg.privacy.extraPatterns[0]).toBe('INTERNAL-\\d{6}');
  });

  it('reads quality.importance_keywords', async () => {
    await writeGlobalConfig([
      'quality:',
      '  importance_keywords:',
      '    - widget-foo',
      '    - acme-ritual',
    ].join('\n'));
    const cfg = await loadConfig({ cwd: testCwd, home: testHome });
    expect(cfg.quality.importanceKeywords).toEqual(['widget-foo', 'acme-ritual']);
  });

  it('reads backup.retention when positive integer', async () => {
    await writeGlobalConfig('backup:\n  retention: 5\n');
    const cfg = await loadConfig({ cwd: testCwd, home: testHome });
    expect(cfg.backup.retention).toBe(5);
  });

  it('rejects non-integer or non-positive retention values', async () => {
    await writeGlobalConfig('backup:\n  retention: -3\n');
    const cfg = await loadConfig({ cwd: testCwd, home: testHome });
    expect(cfg.backup.retention).toBe(DEFAULT_CONFIG.backup.retention);
  });
});

// ---------------------------------------------------------------------------
// Project config — walks upward from cwd
// ---------------------------------------------------------------------------

describe('loadConfig — project discovery walks upward', () => {
  it('finds .memobridge.yaml in current dir', async () => {
    await writeProjectConfig('default_workspace: /proj\n');
    const cfg = await loadConfig({ cwd: testCwd, home: testHome });
    expect(cfg.defaultWorkspace).toBe('/proj');
  });

  it('finds .memobridge.yaml in a parent dir when run from a subdirectory', async () => {
    await writeProjectConfig('default_workspace: /proj-root\n');
    const nested = join(testCwd, 'src', 'deep', 'nested');
    await mkdir(nested, { recursive: true });
    const cfg = await loadConfig({ cwd: nested, home: testHome });
    expect(cfg.defaultWorkspace).toBe('/proj-root');
  });

  it('returns defaults when cwd has no project config and no global', async () => {
    const cfg = await loadConfig({ cwd: testCwd, home: testHome });
    expect(cfg.defaultWorkspace).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Merging — project wins over global per-field; lists union
// ---------------------------------------------------------------------------

describe('loadConfig — merge semantics', () => {
  it('project default_workspace overrides global', async () => {
    await writeGlobalConfig('default_workspace: /global\n');
    await writeProjectConfig('default_workspace: /project\n');
    const cfg = await loadConfig({ cwd: testCwd, home: testHome });
    expect(cfg.defaultWorkspace).toBe('/project');
  });

  it('project retention overrides global', async () => {
    await writeGlobalConfig('backup:\n  retention: 20\n');
    await writeProjectConfig('backup:\n  retention: 3\n');
    const cfg = await loadConfig({ cwd: testCwd, home: testHome });
    expect(cfg.backup.retention).toBe(3);
  });

  it('privacy.extra_patterns is the UNION of global + project (no redundant restating)', async () => {
    await writeGlobalConfig([
      'privacy:',
      '  extra_patterns:',
      '    - "GLOBAL-\\\\d+"',
    ].join('\n'));
    await writeProjectConfig([
      'privacy:',
      '  extra_patterns:',
      '    - "PROJECT-\\\\d+"',
    ].join('\n'));
    const cfg = await loadConfig({ cwd: testCwd, home: testHome });
    expect(cfg.privacy.extraPatterns).toEqual(expect.arrayContaining(['GLOBAL-\\d+', 'PROJECT-\\d+']));
  });

  it('privacy.extra_patterns dedupes identical entries across layers', async () => {
    await writeGlobalConfig([
      'privacy:',
      '  extra_patterns:',
      '    - "SHARED-\\\\d+"',
    ].join('\n'));
    await writeProjectConfig([
      'privacy:',
      '  extra_patterns:',
      '    - "SHARED-\\\\d+"',
      '    - "PROJ-\\\\d+"',
    ].join('\n'));
    const cfg = await loadConfig({ cwd: testCwd, home: testHome });
    expect(cfg.privacy.extraPatterns).toHaveLength(2);
  });

  it('importance_keywords is UNION with case-insensitive dedupe', async () => {
    await writeGlobalConfig([
      'quality:',
      '  importance_keywords:',
      '    - Widget',
    ].join('\n'));
    await writeProjectConfig([
      'quality:',
      '  importance_keywords:',
      '    - widget',  // same word, different case → should dedupe
      '    - Ritual',
    ].join('\n'));
    const cfg = await loadConfig({ cwd: testCwd, home: testHome });
    expect(cfg.quality.importanceKeywords.length).toBe(2);
    expect(cfg.quality.importanceKeywords.map(k => k.toLowerCase()).sort()).toEqual(['ritual', 'widget']);
  });
});

// ---------------------------------------------------------------------------
// Error tolerance — a broken config never throws
// ---------------------------------------------------------------------------

describe('loadConfig — error tolerance', () => {
  it('tolerates malformed YAML (warn + fall back)', async () => {
    await writeProjectConfig('default_workspace: "[unclosed\n');
    const cfg = await loadConfig({ cwd: testCwd, home: testHome });
    expect(cfg.defaultWorkspace).toBeUndefined();
  });

  it('rejects non-object root (YAML list instead of map)', async () => {
    await writeProjectConfig('- one\n- two\n');
    const cfg = await loadConfig({ cwd: testCwd, home: testHome });
    expect(cfg.defaultWorkspace).toBeUndefined();
  });

  it('silently ignores unknown keys (forward-compat)', async () => {
    await writeProjectConfig([
      'default_workspace: /ws',
      'future_field:',
      '  nested: value',
      'another_future_thing: 42',
    ].join('\n'));
    const cfg = await loadConfig({ cwd: testCwd, home: testHome });
    expect(cfg.defaultWorkspace).toBe('/ws');
  });

  it('empty file is treated as empty config (no crash)', async () => {
    await writeProjectConfig('');
    const cfg = await loadConfig({ cwd: testCwd, home: testHome });
    expect(cfg.defaultWorkspace).toBeUndefined();
  });

  it('rejects non-array extra_patterns gracefully', async () => {
    await writeProjectConfig('privacy:\n  extra_patterns: "not-an-array"\n');
    const cfg = await loadConfig({ cwd: testCwd, home: testHome });
    expect(cfg.privacy.extraPatterns).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// default_workspace — path safety (P0-2)
//
// A malicious .memobridge.yaml could point default_workspace at a system
// directory and steer importers into writing ~/.ssh/CLAUDE.md etc.
// loadConfig must reject forbidden roots at load time — the importer
// layer is a defense-in-depth check, not the first line of defense.
// ---------------------------------------------------------------------------

describe('loadConfig — default_workspace path safety', () => {
  it('drops default_workspace pointing at a forbidden system directory', async () => {
    await writeProjectConfig('default_workspace: /etc/passwd\n');
    const cfg = await loadConfig({ cwd: testCwd, home: testHome });
    // Rejected outright — callers see undefined and fall back to CLI flags / cwd.
    expect(cfg.defaultWorkspace).toBeUndefined();
  });

  it('drops default_workspace containing a null byte', async () => {
    await writeProjectConfig('default_workspace: "/tmp/safe\\u0000/etc/shadow"\n');
    const cfg = await loadConfig({ cwd: testCwd, home: testHome });
    expect(cfg.defaultWorkspace).toBeUndefined();
  });

  it('accepts a workspace path under os.tmpdir() (known-safe subtree)', async () => {
    const safe = join(tmpdir(), `ws-${Date.now()}`);
    await writeProjectConfig(`default_workspace: ${safe}\n`);
    const cfg = await loadConfig({ cwd: testCwd, home: testHome });
    expect(cfg.defaultWorkspace).toBe(safe);
  });
});
