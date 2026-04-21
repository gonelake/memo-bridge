import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import CodeBuddyExtractor from '../../src/extractors/codebuddy.js';

// CodeBuddy extractor supports:
//   options.workspace — single workspace (tested directly)
//   options.scanDir   — scan a root for .codebuddy/.memory markers
//   (default)         — autoDiscoverCodeBuddyWorkspaces() hits real homedir,
//                       not exercised here to keep tests hermetic.

let ws: string;

beforeEach(async () => {
  ws = await mkdtemp(join(tmpdir(), 'memobridge-cb-'));
});

afterEach(async () => {
  await rm(ws, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Workspace resolution
// ---------------------------------------------------------------------------

describe('CodeBuddyExtractor — workspace resolution', () => {
  const extractor = new CodeBuddyExtractor();

  it('throws when no workspace can be resolved (bare dir, no markers)', async () => {
    // ws is empty tmp dir — no .codebuddy / .memory markers
    await expect(extractor.extract({ workspace: ws }))
      .rejects.toThrowError(/未检测到任何 CodeBuddy 工作区/);
  });

  it('accepts a workspace that has only .memory/', async () => {
    await mkdir(join(ws, '.memory'), { recursive: true });
    await writeFile(join(ws, '.memory', '2026-04-20.md'), '# Work log');
    const data = await extractor.extract({ workspace: ws });
    expect(data.meta.source.tool).toBe('codebuddy');
  });

  it('accepts a workspace that has only .codebuddy/', async () => {
    await mkdir(join(ws, '.codebuddy', 'automations'), { recursive: true });
    const data = await extractor.extract({ workspace: ws });
    expect(data.meta.source.tool).toBe('codebuddy');
  });

  it('merges multiple workspaces when using --scan-dir', async () => {
    // Two workspaces under ws/
    await mkdir(join(ws, 'projA', '.memory'), { recursive: true });
    await writeFile(join(ws, 'projA', '.memory', '2026-04-01.md'), '# ProjA work');
    await mkdir(join(ws, 'projB', '.memory'), { recursive: true });
    await writeFile(join(ws, 'projB', '.memory', '2026-04-02.md'), '# ProjB work');

    const data = await extractor.extract({ scanDir: ws });
    // meta.source.workspace is a pipe-joined string when multiple workspaces
    expect(data.meta.source.workspace).toContain('projA');
    expect(data.meta.source.workspace).toContain('projB');
    expect(data.meta.source.workspace).toContain(' | ');
  });
});

// ---------------------------------------------------------------------------
// Automation classification
// ---------------------------------------------------------------------------

describe('CodeBuddyExtractor — automation classification', () => {
  const extractor = new CodeBuddyExtractor();

  async function seedAutomation(dirName: string, body: string) {
    const dir = join(ws, '.codebuddy', 'automations', dirName);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'memory.md'), body);
  }

  it('classifies by dir name "ai" -> ai-daily feed', async () => {
    await seedAutomation('ai', '## 2026-04-20 08:27\nSome content');
    const data = await extractor.extract({ workspace: ws });
    const feed = data.feeds.find(f => f.name.includes('AI 日报'));
    expect(feed).toBeTruthy();
    expect(feed!.schedule).toBe('08:30');
    expect(feed!.total_issues).toBe(1);
  });

  it('classifies by content "AI Coding" -> ai-daily', async () => {
    await seedAutomation('foo', 'About AI Coding developments\n## 2026-04-20');
    const data = await extractor.extract({ workspace: ws });
    expect(data.feeds.some(f => f.name.includes('AI 日报'))).toBe(true);
  });

  it('classifies by dir name "ai-2" -> ai-knowledge', async () => {
    await seedAutomation('ai-2', [
      '1. 2026-03-26 — Transformer（变换器架构）：核心架构',
      '2. 2026-03-27 — Attention（注意力机制）：关键概念',
    ].join('\n'));
    const data = await extractor.extract({ workspace: ws });
    const section = data.knowledge.find(k => k.title === 'AI 大模型基础知识');
    expect(section).toBeTruthy();
    expect(section!.items.map(i => i.topic)).toEqual(['Transformer（变换器架构）', 'Attention（注意力机制）']);
    expect(section!.items[0].date).toBe('2026-03-26');
    expect(section!.items[0].mastery).toBe('learned');
  });

  it('classifies by dir name "5" -> english-words', async () => {
    // Per implementation, date backfill happens when a `## YYYY-MM-DD` header
    // is seen *after* the word list: it tags previously-parsed words. So the
    // fixture must list words first, then the date header.
    await seedAutomation('5', [
      '- **输出**：5个实用英语单词（leverage, commute, genuine, deadline, procrastinate）',
      '## 2026-04-01',
    ].join('\n'));
    const data = await extractor.extract({ workspace: ws });
    const section = data.knowledge.find(k => k.title === '英语词汇积累');
    expect(section).toBeTruthy();
    expect(section!.items.map(i => i.topic))
      .toEqual(['leverage', 'commute', 'genuine', 'deadline', 'procrastinate']);
    // Date propagates to previously-parsed words
    expect(section!.items[0].date).toBe('2026-04-01');
  });

  it('classifies by dir name "ai-3" -> ai-products', async () => {
    await seedAutomation('ai-3', '## 2026-04-01\nproduct news\n## 2026-04-02\nmore news');
    const data = await extractor.extract({ workspace: ws });
    const feed = data.feeds.find(f => f.name === 'AI 创新产品日推');
    expect(feed).toBeTruthy();
    expect(feed!.total_issues).toBe(2);
  });

  it('falls back to generic when no keyword matches', async () => {
    await seedAutomation('custom-tool', '# Custom Automation Name\n## 2026-04-01\ncontent');
    const data = await extractor.extract({ workspace: ws });
    const feed = data.feeds.find(f => f.name === 'Custom Automation Name');
    expect(feed).toBeTruthy();
  });

  it('uses dir name as generic feed title when no H1 header', async () => {
    await seedAutomation('random-thing', 'just some prose\n## 2026-04-01');
    const data = await extractor.extract({ workspace: ws });
    const feed = data.feeds.find(f => f.name === 'random-thing');
    expect(feed).toBeTruthy();
  });

  it('handles empty memory.md without throwing', async () => {
    await seedAutomation('empty-auto', '');
    const data = await extractor.extract({ workspace: ws });
    // Empty content produces no automation entries; the workspace is still
    // valid because .codebuddy exists
    expect(data.feeds).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Memory file extraction
// ---------------------------------------------------------------------------

describe('CodeBuddyExtractor — memory file extraction', () => {
  const extractor = new CodeBuddyExtractor();

  async function seedMemory(fileName: string, body: string) {
    const dir = join(ws, '.memory');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, fileName), body);
  }

  it('parses work log dated files into projects and raw memories', async () => {
    await seedMemory('2026-04-20.md', [
      '# 2026-04-20 工作日志',
      '',
      '## MemoBridge 项目',
      '- 推荐：把 switch 改成注册表',
      '- 核心决策：使用中间格式',
      '- 普通说明（不含关键字，不入库）',
      '',
      '## 英语学习',
      '- 完成 5 个单词',
    ].join('\n'));

    const data = await extractor.extract({ workspace: ws });

    // Projects detected from H2 titles (with key insights = bullets with keywords)
    const proj = data.projects.find(p => p.name.includes('MemoBridge'));
    expect(proj).toBeTruthy();
    expect(proj!.status).toBe('active');
    expect(proj!.updated_at).toBe('2026-04-20');
    expect(proj!.key_insights.length).toBeGreaterThan(0);
    expect(proj!.key_insights[0]).toContain('推荐');

    // Raw memories for bullets containing keywords
    const logMems = data.raw_memories.filter(m => m.category === 'work_log');
    expect(logMems.length).toBeGreaterThanOrEqual(3); // 推荐 / 核心 / 完成
    expect(logMems.every(m => m.created_at === '2026-04-20')).toBe(true);
    expect(logMems[0].source).toBe('.memory/2026-04-20.md');
    expect(logMems[0].confidence).toBe(0.8);
  });

  it('skips work log bullets without trigger keywords', async () => {
    await seedMemory('2026-04-20.md', [
      '## Some section',
      '- plain bullet without any trigger keyword',
      '- another plain bullet',
    ].join('\n'));
    const data = await extractor.extract({ workspace: ws });
    const logMems = data.raw_memories.filter(m => m.category === 'work_log');
    expect(logMems).toEqual([]);
  });

  it('skips ai-knowledge-*.md file content (already captured via automation)', async () => {
    await seedMemory(
      'ai-knowledge-2026-04-08.md',
      '# AI Knowledge\n- some heavy content here\n- more content',
    );
    const data = await extractor.extract({ workspace: ws });
    // The file content is NOT added as raw memory (skipped), but the date
    // is picked up into the stats
    expect(data.raw_memories.map(m => m.source))
      .not.toContain('.memory/ai-knowledge-2026-04-08.md');
    expect(data.meta.stats.earliest).toBe('2026-04-08');
  });

  it('skips words-*.md and english-words-*.md content', async () => {
    await seedMemory('words-2026-04-08.md', 'skipped content');
    await seedMemory('english-words-2026-04-09.md', 'skipped content');
    const data = await extractor.extract({ workspace: ws });
    const raw = data.raw_memories.filter(m => m.source.includes('words'));
    expect(raw).toEqual([]);
    // But dates propagate into stats
    expect(data.meta.stats.earliest).toBe('2026-04-08');
    expect(data.meta.stats.latest).toBe('2026-04-09');
  });

  it('treats arbitrary .md files as raw "note" memories', async () => {
    await seedMemory(
      'random-note.md',
      [
        '# Random Note',
        '- point a',
        '- point b',
        'some prose after the bullets',
      ].join('\n'),
    );
    const data = await extractor.extract({ workspace: ws });
    const mem = data.raw_memories.find(m => m.source === '.memory/random-note.md');
    expect(mem).toBeTruthy();
    expect(mem!.id).toBe('mem-random-note.md');
    expect(mem!.category).toBe('note');
    expect(mem!.confidence).toBe(0.7);
  });

  it('dedupes repeated project names across days by exact match', async () => {
    await seedMemory('2026-04-01.md', [
      '## MemoBridge',
      '- 推荐：中间格式',
    ].join('\n'));
    await seedMemory('2026-04-02.md', [
      '## MemoBridge',  // exact duplicate
      '- 核心：注册表',
    ].join('\n'));
    const data = await extractor.extract({ workspace: ws });
    const memoProjects = data.projects.filter(p => p.name === 'MemoBridge');
    expect(memoProjects).toHaveLength(1);
  });

  it('treats distinct names as separate projects even when one is a substring of another', async () => {
    // Regression: previously "Memo" (shorter, seen first) caused "MemoBridge"
    // (seen later) to be dropped via `.includes()` substring check. Now both
    // are kept as distinct projects.
    await seedMemory('2026-04-01.md', [
      '## Memo',
      '- 推荐：短名字',
    ].join('\n'));
    await seedMemory('2026-04-02.md', [
      '## MemoBridge',
      '- 推荐：长名字',
    ].join('\n'));
    const data = await extractor.extract({ workspace: ws });
    const names = data.projects.map(p => p.name).sort();
    expect(names).toEqual(['Memo', 'MemoBridge']);
  });

  it('skips project names shorter than 3 chars or longer than 49 chars', async () => {
    await seedMemory('2026-04-01.md', [
      '## X',  // too short
      '- 推荐：something',
      '## ' + 'Y'.repeat(60),  // too long
      '- 核心：insight',
    ].join('\n'));
    const data = await extractor.extract({ workspace: ws });
    expect(data.projects).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Profile inference
// ---------------------------------------------------------------------------

describe('CodeBuddyExtractor — profile inference', () => {
  const extractor = new CodeBuddyExtractor();

  it('always sets default CodeBuddy preferences', async () => {
    await mkdir(join(ws, '.memory'), { recursive: true });
    await writeFile(join(ws, '.memory', '2026-04-01.md'), '# empty log');
    const data = await extractor.extract({ workspace: ws });
    expect(data.profile.preferences['工具']).toBe('CodeBuddy IDE');
    expect(data.profile.preferences['输出语言']).toBe('中文为主');
  });

  it('infers AI focus when knowledge has "AI" section', async () => {
    const dir = join(ws, '.codebuddy', 'automations', 'ai-2');
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'memory.md'),
      '1. 2026-04-01 — Transformer（架构）：x',
    );
    const data = await extractor.extract({ workspace: ws });
    expect(data.profile.identity['关注方向']).toContain('AI');
  });

  it('infers English learning target when 英语 section exists', async () => {
    const dir = join(ws, '.codebuddy', 'automations', '5');
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'memory.md'),
      '## 2026-04-01\n- **输出**：5个实用英语单词（a, b, c, d, e)',
    );
    const data = await extractor.extract({ workspace: ws });
    expect(data.profile.identity['学习目标']).toContain('英语');
  });

  it('aggregates feed schedules into work_patterns.每日推送', async () => {
    const dir = join(ws, '.codebuddy', 'automations', 'ai');
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'memory.md'),
      '## 2026-04-01\ndaily content',
    );
    const data = await extractor.extract({ workspace: ws });
    expect(data.profile.work_patterns['每日推送']).toContain('AI 日报');
    expect(data.profile.work_patterns['每日推送']).toContain('08:30');
  });

  it('records project names in identity.项目经历 when projects exist', async () => {
    await mkdir(join(ws, '.memory'), { recursive: true });
    await writeFile(
      join(ws, '.memory', '2026-04-01.md'),
      '## MemoBridge\n- 推荐：X\n\n## AnotherProj\n- 核心：Y',
    );
    const data = await extractor.extract({ workspace: ws });
    expect(data.profile.identity['项目经历']).toContain('MemoBridge');
    expect(data.profile.identity['项目经历']).toContain('AnotherProj');
  });
});

// ---------------------------------------------------------------------------
// Privacy integration
// ---------------------------------------------------------------------------

describe('CodeBuddyExtractor — privacy integration', () => {
  const extractor = new CodeBuddyExtractor();

  it('redacts secrets in automation memory.md', async () => {
    const dir = join(ws, '.codebuddy', 'automations', 'ai');
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'memory.md'),
      '## 2026-04-01\nDeployed with ghp_abcdefghijklmnopqrstuvwxyz0123456789',
    );
    // Should not throw; feeds created; content seen by classifier is redacted
    const data = await extractor.extract({ workspace: ws });
    expect(data.feeds.length).toBeGreaterThan(0);
  });

  it('redacts secrets in .memory/ files before storing', async () => {
    const dir = join(ws, '.memory');
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'random.md'),
      'Token: ghp_abcdefghijklmnopqrstuvwxyz0123456789 used for deploy',
    );
    const data = await extractor.extract({ workspace: ws });
    const mem = data.raw_memories.find(m => m.source === '.memory/random.md');
    expect(mem?.content).toContain('ghp_***REDACTED***');
    expect(mem?.content).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz0123456789');
  });
});

// ---------------------------------------------------------------------------
// Meta and stats
// ---------------------------------------------------------------------------

describe('CodeBuddyExtractor — meta and stats', () => {
  const extractor = new CodeBuddyExtractor();

  it('sets meta.source.tool=codebuddy and extraction_method=file', async () => {
    await mkdir(join(ws, '.memory'), { recursive: true });
    await writeFile(join(ws, '.memory', '2026-04-01.md'), '# x');
    const data = await extractor.extract({ workspace: ws });
    expect(data.meta.source.tool).toBe('codebuddy');
    expect(data.meta.source.extraction_method).toBe('file');
    expect(data.meta.source.workspace).toBe(ws);
  });

  it('computes earliest/latest date range from all date sources', async () => {
    const autoDir = join(ws, '.codebuddy', 'automations', 'ai');
    await mkdir(autoDir, { recursive: true });
    await writeFile(join(autoDir, 'memory.md'), '## 2025-01-05\n## 2026-04-20');

    await mkdir(join(ws, '.memory'), { recursive: true });
    await writeFile(join(ws, '.memory', '2025-11-15.md'), '# mid log');

    const data = await extractor.extract({ workspace: ws });
    expect(data.meta.stats.earliest).toBe('2025-01-05');
    expect(data.meta.stats.latest).toBe('2026-04-20');
  });
});
