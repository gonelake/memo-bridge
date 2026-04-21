import { describe, it, expect, beforeEach } from 'vitest';
import { AdapterRegistry, extractorRegistry, importerRegistry } from '../../src/core/registry.js';
import type { Extractor, Importer, ToolId, DetectResult, MemoBridgeData, ImportResult } from '../../src/core/types.js';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

function makeFakeExtractor(toolId: ToolId, tag = 'fake'): Extractor & { tag: string } {
  return {
    toolId,
    toolName: `Fake ${toolId}`,
    tag,
    async detect(): Promise<DetectResult> {
      return { tool: toolId, name: `Fake ${toolId}`, detected: false };
    },
    async extract(): Promise<MemoBridgeData> {
      return {
        meta: {
          version: '0.1',
          exported_at: new Date().toISOString(),
          source: { tool: toolId, extraction_method: 'file' },
          stats: { total_memories: 0, categories: 0 },
        },
        profile: { identity: {}, preferences: {}, work_patterns: {} },
        knowledge: [],
        projects: [],
        feeds: [],
        raw_memories: [],
      };
    },
  };
}

function makeFakeImporter(toolId: ToolId): Importer {
  return {
    toolId,
    toolName: `Fake ${toolId}`,
    async import(): Promise<ImportResult> {
      return {
        success: true,
        method: 'file_write',
        items_imported: 0,
        items_skipped: 0,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// AdapterRegistry behavior
// ---------------------------------------------------------------------------

describe('AdapterRegistry', () => {
  let registry: AdapterRegistry<Extractor>;

  beforeEach(() => {
    registry = new AdapterRegistry<Extractor>();
  });

  describe('register + get', () => {
    it('resolves a registered factory', () => {
      const extractor = makeFakeExtractor('codebuddy');
      registry.register('codebuddy', () => extractor);

      const resolved = registry.get('codebuddy');
      expect(resolved).toBe(extractor);
      expect(resolved.toolId).toBe('codebuddy');
    });

    it('invokes the factory lazily on each get() call', () => {
      let callCount = 0;
      registry.register('cursor', () => {
        callCount++;
        return makeFakeExtractor('cursor');
      });

      expect(callCount).toBe(0);
      registry.get('cursor');
      expect(callCount).toBe(1);
      registry.get('cursor');
      expect(callCount).toBe(2);
    });

    it('returns fresh instances across successive get() calls', () => {
      registry.register('hermes', () => makeFakeExtractor('hermes'));

      const first = registry.get('hermes');
      const second = registry.get('hermes');
      expect(first).not.toBe(second); // different instances
      expect(first.toolId).toBe(second.toolId);
    });

    it('overwrites existing registration (last-write-wins)', () => {
      registry.register('cursor', () => makeFakeExtractor('cursor', 'v1'));
      registry.register('cursor', () => makeFakeExtractor('cursor', 'v2'));

      const resolved = registry.get('cursor') as Extractor & { tag: string };
      expect(resolved.tag).toBe('v2');
    });
  });

  describe('get() on missing tool', () => {
    it('throws a descriptive error', () => {
      expect(() => registry.get('openclaw')).toThrowError(/未注册的工具: openclaw/);
    });

    it('lists registered tools in the error message', () => {
      registry.register('codebuddy', () => makeFakeExtractor('codebuddy'));
      registry.register('cursor', () => makeFakeExtractor('cursor'));

      expect(() => registry.get('kimi')).toThrowError(/codebuddy, cursor/);
    });

    it('shows "(none)" when the registry is empty', () => {
      expect(() => registry.get('kimi')).toThrowError(/\(none\)/);
    });
  });

  describe('has', () => {
    it('returns true for registered tools', () => {
      registry.register('codebuddy', () => makeFakeExtractor('codebuddy'));
      expect(registry.has('codebuddy')).toBe(true);
    });

    it('returns false for unregistered tools', () => {
      expect(registry.has('doubao')).toBe(false);
    });
  });

  describe('list', () => {
    it('returns an empty array for a fresh registry', () => {
      expect(registry.list()).toEqual([]);
    });

    it('preserves registration order', () => {
      registry.register('cursor', () => makeFakeExtractor('cursor'));
      registry.register('codebuddy', () => makeFakeExtractor('codebuddy'));
      registry.register('hermes', () => makeFakeExtractor('hermes'));

      expect(registry.list()).toEqual(['cursor', 'codebuddy', 'hermes']);
    });

    it('does not duplicate entries when a tool is re-registered', () => {
      registry.register('cursor', () => makeFakeExtractor('cursor', 'a'));
      registry.register('cursor', () => makeFakeExtractor('cursor', 'b'));

      expect(registry.list()).toEqual(['cursor']);
    });
  });

  describe('unregister', () => {
    it('removes a registration and returns true', () => {
      registry.register('cursor', () => makeFakeExtractor('cursor'));

      expect(registry.unregister('cursor')).toBe(true);
      expect(registry.has('cursor')).toBe(false);
      expect(() => registry.get('cursor')).toThrow();
    });

    it('returns false when removing a non-existent tool', () => {
      expect(registry.unregister('cursor')).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// Importer registry uses the same generic class — smoke test the typing path
// ---------------------------------------------------------------------------

describe('AdapterRegistry<Importer>', () => {
  it('works with importers', () => {
    const registry = new AdapterRegistry<Importer>();
    const imp = makeFakeImporter('chatgpt');
    registry.register('chatgpt', () => imp);

    const resolved = registry.get('chatgpt');
    expect(resolved.toolId).toBe('chatgpt');
    expect(resolved).toBe(imp);
  });
});

// ---------------------------------------------------------------------------
// Default registries: imported with built-in adapters pre-registered
// These tests exercise the side-effect from `registry/defaults.ts`.
// ---------------------------------------------------------------------------

describe('default registries (after registerDefaults)', () => {
  beforeEach(async () => {
    // Trigger default registration (idempotent thanks to re-register semantics)
    await import('../../src/registry/defaults.js');
  });

  it('registers all 8 extractors', () => {
    const ids = extractorRegistry.list();
    expect(ids).toContain('codebuddy');
    expect(ids).toContain('openclaw');
    expect(ids).toContain('hermes');
    expect(ids).toContain('claude-code');
    expect(ids).toContain('cursor');
    expect(ids).toContain('chatgpt');
    expect(ids).toContain('doubao');
    expect(ids).toContain('kimi');
    expect(ids.length).toBeGreaterThanOrEqual(8);
  });

  it('registers all 8 importers', () => {
    const ids = importerRegistry.list();
    expect(ids).toContain('codebuddy');
    expect(ids).toContain('openclaw');
    expect(ids).toContain('hermes');
    expect(ids).toContain('claude-code');
    expect(ids).toContain('cursor');
    expect(ids).toContain('chatgpt');
    expect(ids).toContain('doubao');
    expect(ids).toContain('kimi');
    expect(ids.length).toBeGreaterThanOrEqual(8);
  });

  it('resolved extractors carry the correct toolId', () => {
    for (const id of extractorRegistry.list()) {
      expect(extractorRegistry.get(id).toolId).toBe(id);
    }
  });

  it('resolved importers carry the correct toolId', () => {
    for (const id of importerRegistry.list()) {
      expect(importerRegistry.get(id).toolId).toBe(id);
    }
  });

  it('allows user overrides of built-in adapters', () => {
    const custom = makeFakeExtractor('cursor', 'user-override');
    extractorRegistry.register('cursor', () => custom);

    const resolved = extractorRegistry.get('cursor') as Extractor & { tag?: string };
    expect(resolved).toBe(custom);
    expect(resolved.tag).toBe('user-override');
  });
});
