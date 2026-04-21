import { describe, it, expect } from 'vitest';
import { parseMemoBridge, serializeMemoBridge } from '../../src/core/schema.js';
import type { MemoBridgeData } from '../../src/core/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFullData(): MemoBridgeData {
  return {
    meta: {
      version: '0.1',
      exported_at: '2026-04-20T08:00:00.000Z',
      source: {
        tool: 'codebuddy',
        workspace: '/Users/alice/project',
        extraction_method: 'file',
      },
      owner: { id: 'alice', locale: 'zh-CN', timezone: 'Asia/Shanghai' },
      stats: {
        total_memories: 5,
        categories: 3,
        earliest: '2025-01-01',
        latest: '2026-04-20',
      },
    },
    profile: {
      identity: { 角色: '工程师', 关注方向: 'AI Coding' },
      preferences: { 沟通风格: '简洁直接' },
      work_patterns: { 工作时间: '9-18' },
    },
    knowledge: [
      {
        title: 'AI 大模型基础',
        items: [
          { topic: 'LLM 原理', date: '2025-03-01', mastery: 'mastered' },
          { topic: 'RAG', date: '2025-04-01', mastery: 'learned' },
        ],
      },
      {
        title: '英语词汇',
        items: [
          { topic: 'serendipity', date: '2025-05-01', mastery: 'reviewed' },
        ],
      },
    ],
    projects: [
      {
        name: 'MemoBridge',
        status: 'active',
        key_insights: ['中间格式设计', '适配器模式'],
      },
      {
        name: 'LegacyApp',
        status: 'completed',
        key_insights: ['迁移到 TypeScript'],
      },
    ],
    feeds: [
      { name: 'AI 日报', schedule: '08:30', total_issues: 120 },
      { name: '英语词汇推送', schedule: '07:00' },
    ],
    raw_memories: [
      {
        id: 'm1',
        content: '测试集成时不要 mock 数据库',
        category: 'general',
        source: '.memory/2026-04-15.md',
        confidence: 0.9,
        created_at: '2026-04-15',
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Front matter parsing
// ---------------------------------------------------------------------------

describe('parseMemoBridge — front matter', () => {
  it('parses valid YAML front matter', () => {
    const content = `---
version: "0.1"
exported_at: "2026-04-20T08:00:00.000Z"
source:
  tool: codebuddy
  extraction_method: file
stats:
  total_memories: 10
  categories: 3
---

# 用户画像
`;
    const data = parseMemoBridge(content);
    expect(data.meta.version).toBe('0.1');
    expect(data.meta.exported_at).toBe('2026-04-20T08:00:00.000Z');
    expect(data.meta.source.tool).toBe('codebuddy');
    expect(data.meta.stats.total_memories).toBe(10);
  });

  it('falls back to defaults when front matter is missing', () => {
    const content = '# 用户画像\n\n## 身份\n- 角色：工程师';
    const data = parseMemoBridge(content);
    expect(data.meta.version).toBe('0.1');
    expect(data.meta.source.tool).toBe('codebuddy');
    expect(data.profile.identity['角色']).toBe('工程师');
  });

  it('falls back to defaults when YAML is malformed', () => {
    const content = `---
version: "0.1
source: {tool: broken
---

# 用户画像
`;
    const data = parseMemoBridge(content);
    expect(data.meta.version).toBe('0.1');
    expect(data.meta.source.tool).toBe('codebuddy');
  });

  it('preserves optional owner field', () => {
    const content = `---
version: "0.1"
source:
  tool: cursor
  extraction_method: file
owner:
  id: alice
  locale: zh-CN
stats:
  total_memories: 0
  categories: 0
---
`;
    const data = parseMemoBridge(content);
    expect(data.meta.owner?.id).toBe('alice');
    expect(data.meta.owner?.locale).toBe('zh-CN');
  });

  it('upgrades a bare scalar source (v0.1 legacy) into the canonical object', () => {
    // Regression: some v0.1 fixtures wrote `source: hermes` instead of a
    // nested object. Left raw, downstream importers read
    // data.meta.source.tool as undefined and produced "from undefined"
    // in the generated CLAUDE.md header.
    const content = `---
version: "0.1"
source: hermes
stats:
  total_memories: 0
  categories: 0
---
`;
    const data = parseMemoBridge(content);
    expect(data.meta.source.tool).toBe('hermes');
    expect(data.meta.source.extraction_method).toBe('file');
  });

  it('falls back to default source object when scalar is not a valid ToolId', () => {
    const content = `---
version: "0.1"
source: something-unknown
stats:
  total_memories: 0
  categories: 0
---
`;
    const data = parseMemoBridge(content);
    expect(data.meta.source.tool).toBe('codebuddy');
    expect(data.meta.source.extraction_method).toBe('file');
  });
});

// ---------------------------------------------------------------------------
// Profile section
// ---------------------------------------------------------------------------

describe('parseMemoBridge — profile', () => {
  it('parses identity / preferences / work_patterns under Chinese headings', () => {
    const content = `---
---

# 用户画像

## 身份
- 角色：工程师
- 关注方向：AI Coding

## 沟通偏好
- 沟通风格：简洁直接

## 工作模式
- 工作时间：9-18
`;
    const data = parseMemoBridge(content);
    expect(data.profile.identity).toEqual({
      角色: '工程师',
      关注方向: 'AI Coding',
    });
    expect(data.profile.preferences['沟通风格']).toBe('简洁直接');
    expect(data.profile.work_patterns['工作时间']).toBe('9-18');
  });

  it('accepts English section headings', () => {
    const content = `---
---

# User Profile

## Identity
- role: engineer

## Preferences
- style: terse

## Work Patterns
- hours: 9-18
`;
    const data = parseMemoBridge(content);
    expect(data.profile.identity['role']).toBe('engineer');
    expect(data.profile.preferences['style']).toBe('terse');
    expect(data.profile.work_patterns['hours']).toBe('9-18');
  });

  it('tolerates both Chinese colon (：) and ASCII colon (:) in bullet lines', () => {
    const content = `# 用户画像

## 身份
- 角色：工程师
- role: architect
`;
    const data = parseMemoBridge(content);
    expect(data.profile.identity['角色']).toBe('工程师');
    expect(data.profile.identity['role']).toBe('architect');
  });

  it('returns empty profile when section is absent', () => {
    const content = '# 知识积累\n\n## AI\n';
    const data = parseMemoBridge(content);
    expect(data.profile).toEqual({ identity: {}, preferences: {}, work_patterns: {} });
  });
});

// ---------------------------------------------------------------------------
// Knowledge section
// ---------------------------------------------------------------------------

describe('parseMemoBridge — knowledge', () => {
  it('parses multiple knowledge sections with table items', () => {
    const content = `# 知识积累

## AI 基础（2条）
| # | 主题 | 日期 | 掌握度 |
|---|------|------|--------|
| 1 | LLM 原理 | 2025-03-01 | mastered |
| 2 | RAG | 2025-04-01 | learned |

## 英语词汇（1条）
| # | 主题 | 日期 | 掌握度 |
|---|------|------|--------|
| 1 | serendipity | 2025-05-01 | reviewed |
`;
    const data = parseMemoBridge(content);
    expect(data.knowledge).toHaveLength(2);
    expect(data.knowledge[0].title).toBe('AI 基础');
    expect(data.knowledge[0].items).toHaveLength(2);
    expect(data.knowledge[0].items[0]).toEqual({
      topic: 'LLM 原理',
      date: '2025-03-01',
      mastery: 'mastered',
    });
    expect(data.knowledge[1].items[0].topic).toBe('serendipity');
  });

  it('returns empty knowledge when section has no tables', () => {
    const content = '# 知识积累\n\n无内容\n';
    const data = parseMemoBridge(content);
    expect(data.knowledge).toEqual([]);
  });

  it('returns empty knowledge when section is absent', () => {
    const data = parseMemoBridge('# 用户画像\n');
    expect(data.knowledge).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Projects section
// ---------------------------------------------------------------------------

describe('parseMemoBridge — projects', () => {
  it('parses projects with Chinese status labels', () => {
    const content = `# 项目上下文

## MemoBridge（进行中）
- 中间格式设计
- 适配器模式

## LegacyApp（已完成）
- 迁移到 TypeScript

## ArchivedPilot（暂停）
- 资源回收
`;
    const data = parseMemoBridge(content);
    expect(data.projects).toHaveLength(3);
    expect(data.projects[0]).toMatchObject({
      name: 'MemoBridge',
      status: 'active',
      key_insights: ['中间格式设计', '适配器模式'],
    });
    expect(data.projects[1].status).toBe('completed');
    expect(data.projects[2].status).toBe('paused');
  });

  it('parses English status labels', () => {
    const content = `# 项目上下文

## ProjectA (active)
- insight 1

## ProjectB (completed)
- insight 2
`;
    const data = parseMemoBridge(content);
    expect(data.projects[0].status).toBe('active');
    expect(data.projects[1].status).toBe('completed');
  });

  it('defaults status to "active" when absent', () => {
    const content = `# 项目上下文

## UnknownStatus
- something
`;
    const data = parseMemoBridge(content);
    expect(data.projects[0].status).toBe('active');
  });
});

// ---------------------------------------------------------------------------
// Feeds section
// ---------------------------------------------------------------------------

describe('parseMemoBridge — feeds', () => {
  it('parses pipe-delimited feed entries', () => {
    const content = `# 关注的信息流

- AI 日报 | 08:30 | 120
- 英语词汇推送 | 07:00
- 极简条目
`;
    const data = parseMemoBridge(content);
    expect(data.feeds).toHaveLength(3);
    expect(data.feeds[0]).toEqual({
      name: 'AI 日报',
      schedule: '08:30',
      total_issues: 120,
    });
    expect(data.feeds[1]).toEqual({
      name: '英语词汇推送',
      schedule: '07:00',
      total_issues: undefined,
    });
    expect(data.feeds[2].name).toBe('极简条目');
  });
});

// ---------------------------------------------------------------------------
// Raw memories section
// ---------------------------------------------------------------------------

describe('parseMemoBridge — raw_memories', () => {
  it('pairs HTML-comment metadata with the following bullet line', () => {
    const content = `# 原始记忆

<!-- source: .memory/2026-04-15.md | confidence: 0.9 | 2026-04-15 -->
- 测试集成时不要 mock 数据库

<!-- source: CLAUDE.md | confidence: 0.7 -->
- 偏好简洁回复
`;
    const data = parseMemoBridge(content);
    expect(data.raw_memories).toHaveLength(2);
    expect(data.raw_memories[0]).toMatchObject({
      content: '测试集成时不要 mock 数据库',
      source: '.memory/2026-04-15.md',
      confidence: 0.9,
      created_at: '2026-04-15',
    });
    expect(data.raw_memories[1].created_at).toBeUndefined();
  });

  it('skips bullet lines without a preceding metadata comment', () => {
    const content = `# 原始记忆

- 这条没有 meta
<!-- source: a.md | confidence: 0.5 -->
- 这条有 meta
`;
    const data = parseMemoBridge(content);
    expect(data.raw_memories).toHaveLength(1);
    expect(data.raw_memories[0].content).toBe('这条有 meta');
  });

  it('assigns sequential ids', () => {
    const content = `# 原始记忆

<!-- source: a.md | confidence: 0.5 -->
- one
<!-- source: b.md | confidence: 0.6 -->
- two
`;
    const data = parseMemoBridge(content);
    expect(data.raw_memories.map(m => m.id)).toEqual(['mem-1', 'mem-2']);
  });
});

// ---------------------------------------------------------------------------
// Size limit
// ---------------------------------------------------------------------------

describe('parseMemoBridge — size guard', () => {
  it('throws when content exceeds 10MB', () => {
    const huge = 'a'.repeat(10 * 1024 * 1024 + 1);
    expect(() => parseMemoBridge(huge)).toThrowError(/输入内容过大/);
  });
});

// ---------------------------------------------------------------------------
// Serializer
// ---------------------------------------------------------------------------

describe('serializeMemoBridge', () => {
  it('produces a YAML front-matter block with source + stats', () => {
    const data = makeFullData();
    const out = serializeMemoBridge(data);
    expect(out.startsWith('---')).toBe(true);
    expect(out).toContain('version: "0.1"');
    expect(out).toContain('tool: codebuddy');
    expect(out).toContain('total_memories: 5');
  });

  it('emits Chinese section headings for each populated section', () => {
    const out = serializeMemoBridge(makeFullData());
    expect(out).toContain('# 用户画像');
    expect(out).toContain('## 身份');
    expect(out).toContain('## 沟通偏好');
    expect(out).toContain('## 工作模式');
    expect(out).toContain('# 知识积累');
    expect(out).toContain('# 项目上下文');
    expect(out).toContain('# 关注的信息流');
    expect(out).toContain('# 原始记忆');
  });

  it('translates project status to Chinese label', () => {
    const out = serializeMemoBridge(makeFullData());
    expect(out).toContain('## MemoBridge（进行中）');
    expect(out).toContain('## LegacyApp（已完成）');
  });

  it('emits Markdown table for knowledge items', () => {
    const out = serializeMemoBridge(makeFullData());
    expect(out).toContain('| # | 主题 | 日期 | 掌握度 |');
    expect(out).toContain('| 1 | LLM 原理 | 2025-03-01 | mastered |');
  });

  it('emits HTML comment metadata before each raw memory bullet', () => {
    const out = serializeMemoBridge(makeFullData());
    expect(out).toMatch(
      /<!-- source: \.memory\/2026-04-15\.md \| confidence: 0\.9 \| created: 2026-04-15 -->\n- 测试集成时不要 mock 数据库/,
    );
  });

  it('round-trips both created_at and updated_at on raw memories', () => {
    const data = makeFullData();
    data.raw_memories = [{
      id: 'm1',
      content: '有时间戳的记忆',
      category: 'general',
      source: 'test.md',
      confidence: 0.8,
      created_at: '2026-04-15',
      updated_at: '2026-04-20',
    }];
    const restored = parseMemoBridge(serializeMemoBridge(data));
    expect(restored.raw_memories[0].created_at).toBe('2026-04-15');
    expect(restored.raw_memories[0].updated_at).toBe('2026-04-20');
  });

  it('parses legacy format (bare date after confidence) as created_at', () => {
    const legacy = `---
---

# 原始记忆

<!-- source: legacy.md | confidence: 0.7 | 2025-01-01 -->
- 旧格式记忆
`;
    const data = parseMemoBridge(legacy);
    expect(data.raw_memories).toHaveLength(1);
    expect(data.raw_memories[0].created_at).toBe('2025-01-01');
    expect(data.raw_memories[0].updated_at).toBeUndefined();
  });

  it('omits empty profile subsections', () => {
    const data = makeFullData();
    data.profile = { identity: {}, preferences: {}, work_patterns: {} };
    const out = serializeMemoBridge(data);
    expect(out).not.toContain('## 身份');
    expect(out).not.toContain('## 沟通偏好');
    expect(out).not.toContain('## 工作模式');
  });

  it('omits entire knowledge / projects / feeds / raw_memories blocks when empty', () => {
    const data = makeFullData();
    data.knowledge = [];
    data.projects = [];
    data.feeds = [];
    data.raw_memories = [];
    const out = serializeMemoBridge(data);
    expect(out).not.toContain('# 知识积累');
    expect(out).not.toContain('# 项目上下文');
    expect(out).not.toContain('# 关注的信息流');
    expect(out).not.toContain('# 原始记忆');
  });

  it('does not include owner key when absent', () => {
    const data = makeFullData();
    delete data.meta.owner;
    const out = serializeMemoBridge(data);
    expect(out).not.toContain('owner:');
  });
});

// ---------------------------------------------------------------------------
// Round-trip
// ---------------------------------------------------------------------------

describe('round-trip (serialize → parse)', () => {
  it('preserves meta.source and stats', () => {
    const data = makeFullData();
    const restored = parseMemoBridge(serializeMemoBridge(data));
    expect(restored.meta.source.tool).toBe('codebuddy');
    expect(restored.meta.source.workspace).toBe('/Users/alice/project');
    expect(restored.meta.stats.total_memories).toBe(5);
  });

  it('preserves profile entries', () => {
    const data = makeFullData();
    const restored = parseMemoBridge(serializeMemoBridge(data));
    expect(restored.profile.identity).toEqual(data.profile.identity);
    expect(restored.profile.preferences).toEqual(data.profile.preferences);
    expect(restored.profile.work_patterns).toEqual(data.profile.work_patterns);
  });

  it('preserves knowledge sections and items', () => {
    const data = makeFullData();
    const restored = parseMemoBridge(serializeMemoBridge(data));
    expect(restored.knowledge).toHaveLength(data.knowledge.length);
    expect(restored.knowledge[0].title).toBe(data.knowledge[0].title);
    expect(restored.knowledge[0].items.map(i => i.topic))
      .toEqual(data.knowledge[0].items.map(i => i.topic));
    expect(restored.knowledge[0].items[0].mastery).toBe('mastered');
  });

  it('preserves projects with status and insights', () => {
    const data = makeFullData();
    const restored = parseMemoBridge(serializeMemoBridge(data));
    expect(restored.projects).toHaveLength(2);
    expect(restored.projects[0]).toMatchObject({
      name: 'MemoBridge',
      status: 'active',
      key_insights: ['中间格式设计', '适配器模式'],
    });
    expect(restored.projects[1].status).toBe('completed');
  });

  it('preserves feeds and raw_memories content/source/confidence', () => {
    const data = makeFullData();
    const restored = parseMemoBridge(serializeMemoBridge(data));
    expect(restored.feeds[0]).toMatchObject({
      name: 'AI 日报',
      schedule: '08:30',
      total_issues: 120,
    });
    expect(restored.raw_memories[0]).toMatchObject({
      content: '测试集成时不要 mock 数据库',
      source: '.memory/2026-04-15.md',
      confidence: 0.9,
      created_at: '2026-04-15',
    });
  });
});

// ---------------------------------------------------------------------------
// Extensions
// ---------------------------------------------------------------------------

describe('extensions field', () => {
  it('serializes extensions as a fenced YAML block in a dedicated section', () => {
    const data = makeFullData();
    data.extensions = {
      hermes: { skills: ['code-review', 'doc-writer'] },
      openclaw: { soul: 'brief personality', dreams: { chars: 1234 } },
    };
    const out = serializeMemoBridge(data);
    expect(out).toContain('# 扩展数据');
    expect(out).toContain('```yaml');
    expect(out).toContain('hermes:');
    expect(out).toContain('skills:');
    expect(out).toContain('- code-review');
    expect(out).toContain('openclaw:');
    expect(out).toContain('soul: brief personality');
  });

  it('omits the extensions section when extensions is undefined', () => {
    const data = makeFullData();
    delete data.extensions;
    const out = serializeMemoBridge(data);
    expect(out).not.toContain('# 扩展数据');
  });

  it('omits the extensions section when extensions contains only empty namespaces', () => {
    const data = makeFullData();
    data.extensions = { hermes: {}, openclaw: {} };
    const out = serializeMemoBridge(data);
    expect(out).not.toContain('# 扩展数据');
  });

  it('parses the extensions section back into data.extensions', () => {
    const data = makeFullData();
    data.extensions = {
      hermes: { skills: ['a', 'b'] },
      openclaw: { soul: 'text', dreams: { chars: 100 } },
    };
    const restored = parseMemoBridge(serializeMemoBridge(data));
    expect(restored.extensions).toEqual(data.extensions);
  });

  it('returns extensions=undefined when section is absent', () => {
    const content = `---
version: "0.1"
source:
  tool: codebuddy
  extraction_method: file
stats:
  total_memories: 0
  categories: 0
---

# 用户画像
`;
    const data = parseMemoBridge(content);
    expect(data.extensions).toBeUndefined();
  });

  it('gracefully returns undefined when the YAML block is malformed', () => {
    const content = `---
---

# 扩展数据

\`\`\`yaml
hermes: [unbalanced bracket
openclaw:
  soul: "unterminated
\`\`\`
`;
    const data = parseMemoBridge(content);
    expect(data.extensions).toBeUndefined();
  });

  it('accepts the English section heading "# Extensions"', () => {
    const content = `---
---

# Extensions

\`\`\`yaml
hermes:
  skills:
    - one
\`\`\`
`;
    const data = parseMemoBridge(content);
    expect(data.extensions?.hermes).toEqual({ skills: ['one'] });
  });

  it('round-trips empty round (no extensions) cleanly', () => {
    const data = makeFullData();
    delete data.extensions;
    const restored = parseMemoBridge(serializeMemoBridge(data));
    expect(restored.extensions).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// v0.2 — quality / origin / previous_export fields
// ---------------------------------------------------------------------------

describe('v0.2 quality & sync fields', () => {
  it('round-trips Memory.content_hash / importance / freshness / quality', () => {
    const data = makeFullData();
    data.raw_memories = [
      {
        id: 'm1',
        content: '用 hash 做增量的唯一身份',
        category: 'general',
        source: '.memory/2026-04-20.md',
        confidence: 0.8,
        content_hash: 'abc123def456',
        importance: 0.75,
        freshness: 0.9,
        quality: 0.54,
      },
    ];
    const restored = parseMemoBridge(serializeMemoBridge(data));
    const [m] = restored.raw_memories;
    expect(m.content_hash).toBe('abc123def456');
    expect(m.importance).toBeCloseTo(0.75, 2);
    expect(m.freshness).toBeCloseTo(0.9, 2);
    expect(m.quality).toBeCloseTo(0.54, 2);
  });

  it('round-trips Memory.origin (tool + imported_from + first_seen_at)', () => {
    const data = makeFullData();
    data.raw_memories = [
      {
        id: 'm1',
        content: 'A→B→C 迁移链',
        category: 'general',
        source: 'MEMORY.md',
        confidence: 0.7,
        origin: {
          tool: 'codebuddy',
          imported_from: 'hermes',
          first_seen_at: '2026-04-01',
        },
      },
    ];
    const restored = parseMemoBridge(serializeMemoBridge(data));
    const [m] = restored.raw_memories;
    expect(m.origin?.tool).toBe('codebuddy');
    expect(m.origin?.imported_from).toBe('hermes');
    expect(m.origin?.first_seen_at).toBe('2026-04-01');
  });

  it('round-trips Meta.previous_export for incremental sync', () => {
    const data = makeFullData();
    data.meta.previous_export = {
      exported_at: '2026-04-15T00:00:00.000Z',
      snapshot_hash: 'def789abc012',
      total_memories: 42,
    };
    const restored = parseMemoBridge(serializeMemoBridge(data));
    expect(restored.meta.previous_export).toEqual({
      exported_at: '2026-04-15T00:00:00.000Z',
      snapshot_hash: 'def789abc012',
      total_memories: 42,
    });
  });

  it('parses v0.1 files (without quality fields) without error — back-compat', () => {
    // Simulate a v0.1 export that has no content_hash / importance / origin
    const legacy = [
      '---',
      '# MemoBridge Format v0.1',
      'version: "0.1"',
      'exported_at: "2026-01-01T00:00:00.000Z"',
      'source:',
      '  tool: codebuddy',
      '  extraction_method: file',
      'stats:',
      '  total_memories: 1',
      '  categories: 1',
      '---',
      '',
      '# 原始记忆',
      '',
      '<!-- source: foo.md | confidence: 0.9 | created: 2026-01-01 -->',
      '- 老格式记忆',
      '',
    ].join('\n');
    const data = parseMemoBridge(legacy);
    expect(data.raw_memories).toHaveLength(1);
    expect(data.raw_memories[0].content).toBe('老格式记忆');
    expect(data.raw_memories[0].content_hash).toBeUndefined();
    expect(data.raw_memories[0].importance).toBeUndefined();
    expect(data.raw_memories[0].origin).toBeUndefined();
    expect(data.meta.previous_export).toBeUndefined();
  });

  it('ignores malformed origin tool id gracefully', () => {
    // If origin tool is not a valid ToolId, we silently drop origin (don't crash)
    const content = [
      '---',
      'version: "0.1"',
      'exported_at: "2026-04-20T00:00:00.000Z"',
      'source:',
      '  tool: codebuddy',
      '  extraction_method: file',
      'stats:',
      '  total_memories: 1',
      '  categories: 1',
      '---',
      '',
      '# 原始记忆',
      '',
      '<!-- source: foo.md | confidence: 0.8 | origin: not-a-real-tool -->',
      '- bad origin',
      '',
    ].join('\n');
    const data = parseMemoBridge(content);
    expect(data.raw_memories).toHaveLength(1);
    expect(data.raw_memories[0].origin).toBeUndefined();
  });
});
