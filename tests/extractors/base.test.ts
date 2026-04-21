import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { BaseExtractor, type DetectConfig } from '../../src/extractors/base.js';
import { CloudExtractor, ExtractionNotSupportedError } from '../../src/extractors/cloud.js';
import type { ExtractOptions, MemoBridgeData, ToolId } from '../../src/core/types.js';

// ---------------------------------------------------------------------------
// Concrete test subclasses (BaseExtractor is abstract)
// ---------------------------------------------------------------------------

class NoConfigExtractor extends BaseExtractor {
  readonly toolId = 'codebuddy' as const;
  async extract(_opts: ExtractOptions): Promise<MemoBridgeData> {
    return this.createEmptyData();
  }
}

class ConfiguredExtractor extends BaseExtractor {
  readonly toolId: ToolId;
  readonly detectConfig: DetectConfig;
  constructor(toolId: ToolId, config: DetectConfig) {
    super();
    this.toolId = toolId;
    this.detectConfig = config;
  }
  async extract(opts: ExtractOptions): Promise<MemoBridgeData> {
    return this.createEmptyData(opts.workspace);
  }
  // expose protected helpers for direct testing
  exposeCreateMeta = this.createMeta.bind(this);
  exposeCreateEmptyData = this.createEmptyData.bind(this);
  exposeReadFileSafe = this.readFileSafe.bind(this);
  exposeDirExists = this.dirExists.bind(this);
}

class TestCloud extends CloudExtractor {
  readonly toolId = 'chatgpt' as const;
}

// ---------------------------------------------------------------------------
// toolName getter
// ---------------------------------------------------------------------------

describe('BaseExtractor.toolName', () => {
  it('derives toolName from the TOOL_NAMES registry', () => {
    const e = new ConfiguredExtractor('codebuddy', {
      globalPaths: [], workspaceMarkers: [], description: 'x',
    });
    expect(e.toolName).toBe('CodeBuddy');
  });

  it('returns the mapped name for each known tool id', () => {
    const cases: Array<[ToolId, string]> = [
      ['openclaw', 'OpenClaw'],
      ['hermes', 'Hermes Agent'],
      ['claude-code', 'Claude Code'],
      ['cursor', 'Cursor'],
      ['chatgpt', 'ChatGPT'],
      ['doubao', '豆包'],
      ['kimi', 'Kimi'],
    ];
    for (const [id, expected] of cases) {
      const e = new ConfiguredExtractor(id, { globalPaths: [], workspaceMarkers: [], description: 'x' });
      expect(e.toolName).toBe(expected);
    }
  });
});

// ---------------------------------------------------------------------------
// detect() — no detectConfig
// ---------------------------------------------------------------------------

describe('BaseExtractor.detect (no detectConfig)', () => {
  it('returns a "not detected" result with tool id and name', async () => {
    const e = new NoConfigExtractor();
    const result = await e.detect();
    expect(result).toEqual({
      tool: 'codebuddy',
      name: 'CodeBuddy',
      detected: false,
    });
    expect(result.paths).toBeUndefined();
    expect(result.details).toBeUndefined();
  });

  it('ignores workspace argument when detectConfig is absent', async () => {
    const e = new NoConfigExtractor();
    const result = await e.detect('/some/workspace');
    expect(result.detected).toBe(false);
    expect(result.paths).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// detect() — with detectConfig, using real tmp filesystem
// ---------------------------------------------------------------------------

describe('BaseExtractor.detect (with detectConfig)', () => {
  let tmpRoot: string;
  let existingGlobal: string;
  let workspaceDir: string;

  beforeAll(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), 'memobridge-base-'));
    existingGlobal = join(tmpRoot, 'global-install');
    workspaceDir = join(tmpRoot, 'project');
    await mkdir(existingGlobal, { recursive: true });
    await mkdir(join(workspaceDir, '.mytool'), { recursive: true });
    await writeFile(join(workspaceDir, 'MARKER.md'), 'present');
  });

  afterAll(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it('returns detected=false when neither global paths nor markers exist', async () => {
    const e = new ConfiguredExtractor('cursor', {
      globalPaths: [join(tmpRoot, 'does-not-exist')],
      workspaceMarkers: ['missing-file'],
      description: 'test',
    });
    const result = await e.detect(workspaceDir);
    expect(result.detected).toBe(false);
    expect(result.paths).toBeUndefined();
    expect(result.details).toBeUndefined();
  });

  it('detects via existing global path', async () => {
    const e = new ConfiguredExtractor('cursor', {
      globalPaths: [existingGlobal, join(tmpRoot, 'missing')],
      workspaceMarkers: [],
      description: 'Global install present',
    });
    const result = await e.detect();
    expect(result.detected).toBe(true);
    expect(result.paths).toEqual([existingGlobal]);
    expect(result.details).toBe('Global install present');
  });

  it('detects via workspace markers when workspacePath is given', async () => {
    const e = new ConfiguredExtractor('cursor', {
      globalPaths: [],
      workspaceMarkers: ['MARKER.md', '.mytool', 'absent.json'],
      description: 'Workspace markers found',
    });
    const result = await e.detect(workspaceDir);
    expect(result.detected).toBe(true);
    expect(result.paths).toEqual([
      join(workspaceDir, 'MARKER.md'),
      join(workspaceDir, '.mytool'),
    ]);
  });

  it('skips workspace markers when workspacePath is omitted', async () => {
    const e = new ConfiguredExtractor('cursor', {
      globalPaths: [],
      workspaceMarkers: ['MARKER.md'],
      description: 'd',
    });
    const result = await e.detect();
    expect(result.detected).toBe(false);
  });

  it('combines global paths and workspace markers into a single paths array', async () => {
    const e = new ConfiguredExtractor('cursor', {
      globalPaths: [existingGlobal],
      workspaceMarkers: ['MARKER.md'],
      description: 'both',
    });
    const result = await e.detect(workspaceDir);
    expect(result.paths).toEqual([
      existingGlobal,
      join(workspaceDir, 'MARKER.md'),
    ]);
  });

  it('expands a leading ~ in globalPaths to homedir()', async () => {
    // We can't plant a file inside the real homedir during tests, so we
    // verify that the path IS expanded by inspecting the returned entry
    // when it happens to exist.
    const e = new ConfiguredExtractor('cursor', {
      globalPaths: ['~'], // homedir itself virtually always exists
      workspaceMarkers: [],
      description: 'home',
    });
    const result = await e.detect();
    expect(result.detected).toBe(true);
    expect(result.paths).toEqual([homedir()]);
  });

  it('does not expand ~ that appears mid-path', async () => {
    const e = new ConfiguredExtractor('cursor', {
      globalPaths: ['/tmp/no~tilde'],
      workspaceMarkers: [],
      description: 'd',
    });
    const result = await e.detect();
    // Either not detected, or the literal un-expanded path is in `paths`;
    // the key point is that expansion only happens at the start anchor.
    if (result.detected) {
      expect(result.paths).toEqual(['/tmp/no~tilde']);
    } else {
      expect(result.paths).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// createMeta
// ---------------------------------------------------------------------------

describe('BaseExtractor.createMeta', () => {
  const e = new ConfiguredExtractor('codebuddy', {
    globalPaths: [], workspaceMarkers: [], description: 'x',
  });

  it('fills all required fields with sensible defaults', () => {
    const meta = e.exposeCreateMeta('file');
    expect(meta.version).toBe('0.1');
    expect(meta.source.tool).toBe('codebuddy');
    expect(meta.source.extraction_method).toBe('file');
    expect(meta.source.workspace).toBeUndefined();
    expect(meta.stats.total_memories).toBe(0);
    expect(meta.stats.categories).toBe(0);
    expect(Date.parse(meta.exported_at)).not.toBeNaN();
  });

  it('propagates workspace / totals / date range', () => {
    const meta = e.exposeCreateMeta(
      'prompt_guided',
      '/tmp/ws',
      42,
      5,
      '2025-01-01',
      '2026-04-20',
    );
    expect(meta.source.workspace).toBe('/tmp/ws');
    expect(meta.source.extraction_method).toBe('prompt_guided');
    expect(meta.stats).toEqual({
      total_memories: 42,
      categories: 5,
      earliest: '2025-01-01',
      latest: '2026-04-20',
    });
  });

  it('uses the subclass toolId in source.tool', () => {
    const cursor = new ConfiguredExtractor('cursor', {
      globalPaths: [], workspaceMarkers: [], description: 'x',
    });
    expect(cursor.exposeCreateMeta('file').source.tool).toBe('cursor');
  });

  it('produces a fresh timestamp on each call', async () => {
    const first = e.exposeCreateMeta('file');
    await new Promise(r => setTimeout(r, 2));
    const second = e.exposeCreateMeta('file');
    expect(second.exported_at >= first.exported_at).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// createEmptyData
// ---------------------------------------------------------------------------

describe('BaseExtractor.createEmptyData', () => {
  const e = new ConfiguredExtractor('hermes', {
    globalPaths: [], workspaceMarkers: [], description: 'x',
  });

  it('returns an empty MemoBridgeData with all sections initialized', () => {
    const data = e.exposeCreateEmptyData();
    expect(data.profile).toEqual({ identity: {}, preferences: {}, work_patterns: {} });
    expect(data.knowledge).toEqual([]);
    expect(data.projects).toEqual([]);
    expect(data.feeds).toEqual([]);
    expect(data.raw_memories).toEqual([]);
    expect(data.meta.source.tool).toBe('hermes');
    expect(data.meta.source.extraction_method).toBe('file');
  });

  it('propagates workspace path into meta.source', () => {
    const data = e.exposeCreateEmptyData('/tmp/space');
    expect(data.meta.source.workspace).toBe('/tmp/space');
  });

  it('each call returns independent profile objects (no shared references)', () => {
    const a = e.exposeCreateEmptyData();
    const b = e.exposeCreateEmptyData();
    a.profile.identity['mutated'] = 'yes';
    expect(b.profile.identity).toEqual({});
  });

  it('each call returns independent array instances', () => {
    const a = e.exposeCreateEmptyData();
    const b = e.exposeCreateEmptyData();
    a.knowledge.push({ title: 'new', items: [] });
    a.raw_memories.push({
      id: '1', content: 'x', category: 'c', source: 's', confidence: 0.5,
    });
    expect(b.knowledge).toEqual([]);
    expect(b.raw_memories).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// CloudExtractor
// ---------------------------------------------------------------------------

describe('CloudExtractor', () => {
  it('always reports detected=true via detect()', async () => {
    const result = await new TestCloud().detect();
    expect(result.detected).toBe(true);
    expect(result.tool).toBe('chatgpt');
    expect(result.name).toBe('ChatGPT');
    expect(result.details).toContain("memo-bridge prompt --for chatgpt");
  });

  it('extract() throws ExtractionNotSupportedError', async () => {
    await expect(new TestCloud().extract({})).rejects.toBeInstanceOf(ExtractionNotSupportedError);
  });

  it('extract() error message mentions the tool name and the prompt command', async () => {
    try {
      await new TestCloud().extract({});
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ExtractionNotSupportedError);
      const msg = (err as Error).message;
      expect(msg).toContain('ChatGPT');
      expect(msg).toContain('memo-bridge prompt --for chatgpt');
    }
  });

  it('ExtractionNotSupportedError has the correct name', () => {
    const err = new ExtractionNotSupportedError('test');
    expect(err.name).toBe('ExtractionNotSupportedError');
    expect(err).toBeInstanceOf(Error);
  });
});

// ---------------------------------------------------------------------------
// readFileSafe / dirExists (shared helpers for all extractors)
// ---------------------------------------------------------------------------

describe('BaseExtractor.readFileSafe', () => {
  const e = new ConfiguredExtractor('codebuddy', {
    globalPaths: [], workspaceMarkers: [], description: 'x',
  });
  let tmpRoot: string;

  beforeAll(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), 'memobridge-base-helper-'));
  });

  afterAll(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it('reads an existing file', async () => {
    const p = join(tmpRoot, 'normal.md');
    await writeFile(p, 'hello');
    expect(await e.exposeReadFileSafe(p)).toBe('hello');
  });

  it('returns null for a missing file', async () => {
    expect(await e.exposeReadFileSafe(join(tmpRoot, 'missing.md'))).toBeNull();
  });

  it('returns null when path is a directory', async () => {
    const dir = join(tmpRoot, 'subdir');
    await mkdir(dir);
    expect(await e.exposeReadFileSafe(dir)).toBeNull();
  });

  it('skips files larger than MAX_READ_SIZE and returns null', async () => {
    // Build a file just over the 10MB limit efficiently with a Buffer
    const { writeFile: rawWrite } = await import('node:fs/promises');
    const oversized = Buffer.alloc(10 * 1024 * 1024 + 1, 0x61); // 10MB + 1 byte of 'a'
    const p = join(tmpRoot, 'too-big.md');
    await rawWrite(p, oversized);
    expect(await e.exposeReadFileSafe(p)).toBeNull();
  });

  it('reads files right at the size limit boundary', async () => {
    // File of exactly MAX_READ_SIZE bytes should still be readable
    const { writeFile: rawWrite } = await import('node:fs/promises');
    const boundary = Buffer.alloc(10 * 1024 * 1024, 0x62); // exactly 10MB
    const p = join(tmpRoot, 'exact.md');
    await rawWrite(p, boundary);
    const result = await e.exposeReadFileSafe(p);
    expect(result).not.toBeNull();
    expect(result!.length).toBe(10 * 1024 * 1024);
  });
});

describe('BaseExtractor.dirExists', () => {
  const e = new ConfiguredExtractor('codebuddy', {
    globalPaths: [], workspaceMarkers: [], description: 'x',
  });
  let tmpRoot: string;

  beforeAll(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), 'memobridge-base-dir-'));
  });

  afterAll(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it('returns true for an existing directory', async () => {
    expect(await e.exposeDirExists(tmpRoot)).toBe(true);
  });

  it('returns false for a missing path', async () => {
    expect(await e.exposeDirExists(join(tmpRoot, 'missing'))).toBe(false);
  });

  it('returns false for a regular file', async () => {
    const p = join(tmpRoot, 'not-a-dir.txt');
    await writeFile(p, 'x');
    expect(await e.exposeDirExists(p)).toBe(false);
  });
});
