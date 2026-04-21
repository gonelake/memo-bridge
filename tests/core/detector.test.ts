import { describe, it, expect, beforeEach, afterEach, afterAll, beforeAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  detectTool,
  detectAllTools,
  scanCodeBuddyWorkspaces,
} from '../../src/core/detector.js';
import { extractorRegistry, AdapterRegistry } from '../../src/core/registry.js';
import type { Extractor, ToolId, DetectResult, MemoBridgeData, ExtractOptions } from '../../src/core/types.js';

// ---------------------------------------------------------------------------
// Helpers — fake Extractor that records calls
// ---------------------------------------------------------------------------

interface FakeExtractor extends Extractor {
  detectCalls: Array<string | undefined>;
  nextResult: DetectResult;
}

function makeFakeExtractor(toolId: ToolId, result?: Partial<DetectResult>): FakeExtractor {
  const detectCalls: Array<string | undefined> = [];
  const base: DetectResult = { tool: toolId, name: `Fake ${toolId}`, detected: false };
  const fake: FakeExtractor = {
    toolId,
    toolName: `Fake ${toolId}`,
    detectCalls,
    nextResult: { ...base, ...result },
    async detect(workspacePath?: string): Promise<DetectResult> {
      detectCalls.push(workspacePath);
      return fake.nextResult;
    },
    async extract(_options: ExtractOptions): Promise<MemoBridgeData> {
      throw new Error('extract not used in these tests');
    },
  };
  return fake;
}

// Save & restore registered factories so tests are isolated from
// default registrations (loaded by other test files).
function snapshotRegistry<T extends { toolId: ToolId }>(reg: AdapterRegistry<T>): () => void {
  const ids = reg.list();
  const factories = new Map<ToolId, () => T>();
  for (const id of ids) {
    // Record the factory indirectly by recreating via get(). We can't access
    // the private factories map, so we capture the returned instance and
    // replay it from a closure. This is fine because the registry uses
    // lazy factories — we need fresh instances on each `get()` call post-restore.
    const ext = reg.get(id);
    factories.set(id, () => ext);
  }
  // Clear everything
  for (const id of ids) reg.unregister(id);
  return () => {
    for (const id of reg.list()) reg.unregister(id);
    for (const [id, factory] of factories) {
      reg.register(id, factory);
    }
  };
}

// ---------------------------------------------------------------------------
// detectTool
// ---------------------------------------------------------------------------

describe('detectTool', () => {
  let restore: () => void;

  beforeEach(() => {
    restore = snapshotRegistry(extractorRegistry);
  });

  afterEach(() => restore?.());

  it('returns "not detected" for unregistered tools', async () => {
    const result = await detectTool('cursor');
    expect(result).toEqual({
      tool: 'cursor',
      name: expect.any(String),
      detected: false,
    });
  });

  it('delegates to the registered extractor', async () => {
    const fake = makeFakeExtractor('cursor', { detected: true, paths: ['/tmp/xyz'] });
    extractorRegistry.register('cursor', () => fake);

    const result = await detectTool('cursor');
    expect(result.detected).toBe(true);
    expect(result.paths).toEqual(['/tmp/xyz']);
    expect(fake.detectCalls).toHaveLength(1);
    expect(fake.detectCalls[0]).toBeUndefined();
  });

  it('forwards workspace path to the extractor', async () => {
    const fake = makeFakeExtractor('codebuddy');
    extractorRegistry.register('codebuddy', () => fake);

    await detectTool('codebuddy', '/home/alice/project');
    expect(fake.detectCalls).toEqual(['/home/alice/project']);
  });
});

// ---------------------------------------------------------------------------
// detectAllTools
// ---------------------------------------------------------------------------

describe('detectAllTools', () => {
  let restore: () => void;

  beforeEach(() => {
    restore = snapshotRegistry(extractorRegistry);
  });

  afterEach(() => restore?.());

  it('returns empty array when no extractors are registered', async () => {
    const results = await detectAllTools();
    expect(results).toEqual([]);
  });

  it('invokes every registered extractor and preserves registration order', async () => {
    const fakeCodebuddy = makeFakeExtractor('codebuddy', { detected: true });
    const fakeCursor = makeFakeExtractor('cursor', { detected: false });
    const fakeHermes = makeFakeExtractor('hermes', { detected: true });

    extractorRegistry.register('codebuddy', () => fakeCodebuddy);
    extractorRegistry.register('cursor', () => fakeCursor);
    extractorRegistry.register('hermes', () => fakeHermes);

    const results = await detectAllTools();
    expect(results.map(r => r.tool)).toEqual(['codebuddy', 'cursor', 'hermes']);
    expect(results.map(r => r.detected)).toEqual([true, false, true]);
  });

  it('propagates workspace path to every extractor', async () => {
    const a = makeFakeExtractor('codebuddy');
    const b = makeFakeExtractor('cursor');
    extractorRegistry.register('codebuddy', () => a);
    extractorRegistry.register('cursor', () => b);

    await detectAllTools('/tmp/work');

    expect(a.detectCalls).toEqual(['/tmp/work']);
    expect(b.detectCalls).toEqual(['/tmp/work']);
  });
});

// ---------------------------------------------------------------------------
// scanCodeBuddyWorkspaces — uses real tmp filesystem
// ---------------------------------------------------------------------------

describe('scanCodeBuddyWorkspaces', () => {
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'memobridge-scan-'));

    // Layout:
    //   root/
    //     projA/.codebuddy/automations/{a1,a2}/memory.md
    //     projA/.memory/2026-04-01.md, 2026-04-02.md, ignored.txt
    //     projB/.memory/one.md                   (memory-only workspace)
    //     nested/projC/.codebuddy/               (depth 2)
    //     node_modules/ignored-marker/.codebuddy/ (under SCAN_IGNORE)
    //     too/deep/down/here/projD/.codebuddy/   (depth 5 — beyond maxDepth=4)

    await mkdir(join(root, 'projA', '.codebuddy', 'automations', 'a1'), { recursive: true });
    await mkdir(join(root, 'projA', '.codebuddy', 'automations', 'a2'), { recursive: true });
    await writeFile(join(root, 'projA', '.codebuddy', 'automations', 'a1', 'memory.md'), 'a1');
    await writeFile(join(root, 'projA', '.codebuddy', 'automations', 'a2', 'memory.md'), 'a2');
    await mkdir(join(root, 'projA', '.memory'), { recursive: true });
    await writeFile(join(root, 'projA', '.memory', '2026-04-01.md'), 'x');
    await writeFile(join(root, 'projA', '.memory', '2026-04-02.md'), 'y');
    await writeFile(join(root, 'projA', '.memory', 'ignored.txt'), 'not md');

    await mkdir(join(root, 'projB', '.memory'), { recursive: true });
    await writeFile(join(root, 'projB', '.memory', 'one.md'), 'one');

    await mkdir(join(root, 'nested', 'projC', '.codebuddy'), { recursive: true });

    await mkdir(join(root, 'node_modules', 'ignored-marker', '.codebuddy'), { recursive: true });

    await mkdir(
      join(root, 'too', 'deep', 'down', 'here', 'projD', '.codebuddy'),
      { recursive: true },
    );
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('discovers workspaces with .codebuddy or .memory markers', async () => {
    const found = await scanCodeBuddyWorkspaces(root);
    const paths = found.map(w => w.path).sort();
    expect(paths).toContain(join(root, 'projA'));
    expect(paths).toContain(join(root, 'projB'));
    expect(paths).toContain(join(root, 'nested', 'projC'));
  });

  it('counts automations and md memory files correctly', async () => {
    const found = await scanCodeBuddyWorkspaces(root);
    const projA = found.find(w => w.path === join(root, 'projA'));
    expect(projA).toMatchObject({
      tool: 'codebuddy',
      hasAutomations: true,
      hasMemory: true,
      automationCount: 2,
      memoryFileCount: 2, // ignored.txt not counted
    });
  });

  it('reports memory-only workspace correctly', async () => {
    const found = await scanCodeBuddyWorkspaces(root);
    const projB = found.find(w => w.path === join(root, 'projB'));
    expect(projB).toMatchObject({
      hasAutomations: false,
      hasMemory: true,
      automationCount: 0,
      memoryFileCount: 1,
    });
  });

  it('skips directories in SCAN_IGNORE (e.g. node_modules)', async () => {
    const found = await scanCodeBuddyWorkspaces(root);
    const paths = found.map(w => w.path);
    expect(paths).not.toContain(join(root, 'node_modules', 'ignored-marker'));
  });

  it('respects maxDepth', async () => {
    // maxDepth=2 should reach projA/projB (depth 1) and nested/projC (depth 2)
    // but NOT too/deep/down/here/projD (depth 5).
    const shallow = await scanCodeBuddyWorkspaces(root, 2);
    const paths = shallow.map(w => w.path);
    expect(paths).toContain(join(root, 'projA'));
    expect(paths).toContain(join(root, 'nested', 'projC'));
    expect(paths).not.toContain(
      join(root, 'too', 'deep', 'down', 'here', 'projD'),
    );
  });

  it('does not recurse into the .codebuddy or .memory marker directories themselves', async () => {
    // If it did, we'd see duplicate entries for marker subdirs.
    const found = await scanCodeBuddyWorkspaces(root);
    const projAEntries = found.filter(w => w.path.startsWith(join(root, 'projA')));
    expect(projAEntries).toHaveLength(1);
  });

  it('returns empty list for a non-existent root', async () => {
    const found = await scanCodeBuddyWorkspaces(join(root, 'does-not-exist'));
    expect(found).toEqual([]);
  });

  it('returns empty list for a directory with no markers', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'memobridge-empty-'));
    try {
      const found = await scanCodeBuddyWorkspaces(empty);
      expect(found).toEqual([]);
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });
});
