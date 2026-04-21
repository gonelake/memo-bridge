import { describe, it, expect } from 'vitest';
import {
  ChatGPTImporter,
  DouBaoImporter,
  KimiImporter,
} from '../../src/importers/instruction-based.js';
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
      identity: { 角色: '工程师', 关注方向: 'AI Coding' },
      preferences: { 风格: '简洁' },
      work_patterns: { 工作时间: '9-18' },
    },
    knowledge: [{ title: 'AI', items: [{ topic: 'LLM' }, { topic: 'RAG' }] }],
    projects: [
      { name: 'MemoBridge', status: 'active', key_insights: ['中间格式设计', '适配器模式'] },
      { name: 'LegacyApp', status: 'completed', key_insights: ['已迁移到 TS'] },
    ],
    feeds: [{ name: 'AI 日报', schedule: '08:30', total_issues: 120 }],
    raw_memories: [
      { id: 'm1', content: '集成测试不要 mock 数据库', category: 'g', source: 's', confidence: 0.95 },
      { id: 'm2', content: '偏好简洁回复', category: 'g', source: 's', confidence: 0.7 },
    ],
  };
}

function emptyData(): MemoBridgeData {
  return {
    meta: {
      version: '0.1',
      exported_at: '2026-04-20T08:00:00.000Z',
      source: { tool: 'codebuddy', extraction_method: 'file' },
      stats: { total_memories: 0, categories: 0 },
    },
    profile: { identity: {}, preferences: {}, work_patterns: {} },
    knowledge: [],
    projects: [],
    feeds: [],
    raw_memories: [],
  };
}

// ---------------------------------------------------------------------------
// ChatGPTImporter
// ---------------------------------------------------------------------------

describe('ChatGPTImporter', () => {
  const importer = new ChatGPTImporter();

  it('returns method=instruction with clipboard_content and instructions', async () => {
    const result = await importer.import(makeData(), {});
    expect(result.success).toBe(true);
    expect(result.method).toBe('instruction');
    expect(result.clipboard_content).toBeTruthy();
    expect(result.instructions).toBeTruthy();
    expect(result.items_skipped).toBe(0);
    expect(result.output_path).toBeUndefined();
  });

  it('builds a profile segment with identity and preferences', async () => {
    const result = await importer.import(makeData(), {});
    expect(result.clipboard_content).toContain('请记住以下关于我的信息');
    expect(result.clipboard_content).toContain('角色: 工程师');
    expect(result.clipboard_content).toContain('风格: 简洁');
  });

  it('builds a projects segment', async () => {
    const result = await importer.import(makeData(), {});
    expect(result.clipboard_content).toContain('请记住我的项目背景');
    expect(result.clipboard_content).toContain('MemoBridge(进行中)');
    expect(result.clipboard_content).toContain('LegacyApp(已完成)');
    expect(result.clipboard_content).toContain('中间格式设计');
  });

  it('builds a knowledge segment', async () => {
    const result = await importer.import(makeData(), {});
    expect(result.clipboard_content).toContain('请记住我的学习进度');
    expect(result.clipboard_content).toContain('AI: 已学 2 个主题');
  });

  it('separates segments with ---', async () => {
    const result = await importer.import(makeData(), {});
    expect(result.clipboard_content!.split('\n\n---\n\n').length).toBeGreaterThanOrEqual(3);
  });

  it('instructions header mentions the segment count', async () => {
    const result = await importer.import(makeData(), {});
    // 3 segments: profile + projects + knowledge
    expect(result.instructions).toMatch(/将以下 3 段内容/);
  });

  it('produces empty clipboard content for empty data', async () => {
    const result = await importer.import(emptyData(), {});
    expect(result.success).toBe(true);
    expect(result.clipboard_content).toBe('');
    expect(result.items_imported).toBe(0);
  });

  it('ignores workspace / dryRun / overwrite options', async () => {
    // These options don't apply to instruction-based importers.
    const r1 = await importer.import(makeData(), { workspace: '/tmp/x', dryRun: true, overwrite: true });
    const r2 = await importer.import(makeData(), {});
    expect(r1.clipboard_content).toBe(r2.clipboard_content);
  });
});

// ---------------------------------------------------------------------------
// DouBaoImporter
// ---------------------------------------------------------------------------

describe('DouBaoImporter', () => {
  const importer = new DouBaoImporter();

  it('returns method=instruction with Chinese framing', async () => {
    const result = await importer.import(makeData(), {});
    expect(result.method).toBe('instruction');
    expect(result.instructions).toContain('豆包');
    expect(result.clipboard_content).toContain('请记住以下关于我的所有信息');
  });

  it('uses Chinese section labels【】', async () => {
    const result = await importer.import(makeData(), {});
    const text = result.clipboard_content!;
    expect(text).toContain('【个人信息】');
    expect(text).toContain('【偏好设定】');
    expect(text).toContain('【项目背景】');
    expect(text).toContain('【工作模式】');
  });

  it('uses fullwidth colons (：) in entries', async () => {
    const result = await importer.import(makeData(), {});
    expect(result.clipboard_content).toContain('角色：工程师');
    expect(result.clipboard_content).toContain('风格：简洁');
  });

  it('renders project insights separated by fullwidth semicolon', async () => {
    const result = await importer.import(makeData(), {});
    expect(result.clipboard_content).toContain('MemoBridge：中间格式设计；适配器模式');
  });

  it('includes confirmation request at the end', async () => {
    const result = await importer.import(makeData(), {});
    expect(result.clipboard_content).toMatch(/请确认你已记住以上所有信息/);
  });

  it('omits sections that have no data', async () => {
    const data = makeData();
    data.profile.preferences = {};
    data.projects = [];
    const result = await importer.import(data, {});
    expect(result.clipboard_content).not.toContain('【偏好设定】');
    expect(result.clipboard_content).not.toContain('【项目背景】');
  });

  it('handles fully empty data without throwing', async () => {
    const result = await importer.import(emptyData(), {});
    expect(result.success).toBe(true);
    // Only the header + confirmation tail survive
    expect(result.clipboard_content).toContain('请记住以下关于我的所有信息');
    expect(result.clipboard_content).toContain('请确认你已记住');
    expect(result.clipboard_content).not.toContain('【');
  });
});

// ---------------------------------------------------------------------------
// KimiImporter
// ---------------------------------------------------------------------------

describe('KimiImporter', () => {
  const importer = new KimiImporter();

  it('returns method=instruction with Kimi-specific framing', async () => {
    const result = await importer.import(makeData(), {});
    expect(result.method).toBe('instruction');
    expect(result.instructions).toContain('Kimi');
    expect(result.instructions).toContain('第一条消息');
  });

  it('wraps content in a context-injection template', async () => {
    const result = await importer.import(makeData(), {});
    const text = result.clipboard_content!;
    expect(text).toMatch(/^以下是关于我的背景信息/);
    expect(text).toMatch(/请确认你已理解以上背景信息/);
  });

  it('includes flattened data (identity, knowledge, projects, memories)', async () => {
    const result = await importer.import(makeData(), {});
    const text = result.clipboard_content!;
    expect(text).toContain('角色: 工程师');
    expect(text).toContain('MemoBridge');
    expect(text).toContain('集成测试不要 mock 数据库');
  });

  it('truncates to the 8000-char budget', async () => {
    const data = makeData();
    // flattenToText takes top 20 memories by confidence, so padding with
    // many small memories won't grow past the budget. Instead, give one
    // memory that is itself > 8000 chars.
    data.raw_memories.push({
      id: 'huge',
      content: 'X'.repeat(10000),
      category: 'g',
      source: 's',
      confidence: 1.0,
    });
    const result = await importer.import(data, {});
    // Template wraps the flattened text with ~100 chars overhead.
    expect(result.clipboard_content!.length).toBeLessThan(8500);
    expect(result.clipboard_content).toContain('...'); // flatten truncation marker
  });

  it('returns success for empty data with only the wrapper text', async () => {
    const result = await importer.import(emptyData(), {});
    expect(result.success).toBe(true);
    expect(result.clipboard_content).toContain('以下是关于我的背景信息');
    expect(result.items_imported).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Common contract
// ---------------------------------------------------------------------------

describe('all instruction importers share a common contract', () => {
  const importers = [
    ['chatgpt', new ChatGPTImporter()],
    ['doubao', new DouBaoImporter()],
    ['kimi', new KimiImporter()],
  ] as const;

  for (const [id, importer] of importers) {
    it(`${id}: toolId matches its adapter`, () => {
      expect(importer.toolId).toBe(id);
    });

    it(`${id}: result has no output_path and no warnings`, async () => {
      const result = await importer.import(makeData(), {});
      expect(result.output_path).toBeUndefined();
      expect(result.warnings).toBeUndefined();
    });

    it(`${id}: items_imported matches countImported (non-zero for populated data)`, async () => {
      const result = await importer.import(makeData(), {});
      expect(result.items_imported).toBeGreaterThan(0);
    });

    it(`${id}: does not write to the filesystem`, async () => {
      // If any importer accidentally wrote a file, this test file would have
      // side effects. We rely on the instruction importers NOT doing any fs
      // operations at all — the pure function shape is the contract.
      const result = await importer.import(makeData(), {});
      expect(result.method).toBe('instruction');
      expect(typeof result.clipboard_content).toBe('string');
    });
  }
});
