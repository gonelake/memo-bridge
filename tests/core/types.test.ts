import { describe, it, expect } from 'vitest';
import { isToolId, TOOL_IDS } from '../../src/core/types.js';

describe('isToolId', () => {
  it('returns true for every known tool id', () => {
    for (const id of TOOL_IDS) {
      expect(isToolId(id)).toBe(true);
    }
  });

  it('returns false for unknown strings', () => {
    expect(isToolId('unknown-tool')).toBe(false);
    expect(isToolId('CODEBUDDY')).toBe(false); // case-sensitive
    expect(isToolId('')).toBe(false);
    expect(isToolId('claude')).toBe(false); // partial match
  });

  it('returns false for non-string values', () => {
    expect(isToolId(null)).toBe(false);
    expect(isToolId(undefined)).toBe(false);
    expect(isToolId(42)).toBe(false);
    expect(isToolId({})).toBe(false);
    expect(isToolId(['codebuddy'])).toBe(false);
  });

  it('narrows type correctly when used as a guard', () => {
    const value: unknown = 'codebuddy';
    if (isToolId(value)) {
      // TS should narrow value to ToolId here
      const narrowed: 'codebuddy' | 'openclaw' | 'hermes' | 'claude-code' | 'cursor' | 'chatgpt' | 'doubao' | 'kimi' = value;
      expect(narrowed).toBe('codebuddy');
    } else {
      throw new Error('isToolId narrowing failed');
    }
  });
});
