/**
 * MemoBridge — memo-bridge.md format parser and serializer
 */

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { MemoBridgeData, MemoBridgeMeta, UserProfile, KnowledgeSection, ProjectContext, InformationFeed, Memory, ExtensionsMap, ToolId } from './types.js';
import { isToolId } from './types.js';

const FORMAT_VERSION = '0.1';
const YAML_DELIMITER = '---';
/** Max input size for parsing (10 MB) */
const MAX_PARSE_SIZE = 10 * 1024 * 1024;

/**
 * Parse a memo-bridge.md file content into structured data
 */
export function parseMemoBridge(content: string): MemoBridgeData {
  if (Buffer.byteLength(content, 'utf-8') > MAX_PARSE_SIZE) {
    throw new Error(`输入内容过大，超过 ${MAX_PARSE_SIZE / 1024 / 1024}MB 限制`);
  }

  const { frontMatter, body } = splitFrontMatter(content);
  const meta = parseMeta(frontMatter);
  const sections = splitSections(body);

  const data: MemoBridgeData = {
    meta,
    profile: parseProfile(sections['用户画像'] || sections['User Profile'] || ''),
    knowledge: parseKnowledge(sections['知识积累'] || sections['Knowledge'] || ''),
    projects: parseProjects(sections['项目上下文'] || sections['Projects'] || ''),
    feeds: parseFeeds(sections['关注的信息流'] || sections['Information Feeds'] || ''),
    raw_memories: parseRawMemories(sections['原始记忆'] || sections['Raw Memories'] || ''),
  };

  const extensions = parseExtensions(sections['扩展数据'] || sections['Extensions'] || '');
  if (extensions) data.extensions = extensions;

  return data;
}

/**
 * Serialize structured data into memo-bridge.md format
 */
export function serializeMemoBridge(data: MemoBridgeData): string {
  const lines: string[] = [];

  // YAML front matter
  lines.push(YAML_DELIMITER);
  lines.push(`# MemoBridge Format v${FORMAT_VERSION}`);
  lines.push(stringifyYaml(flattenMeta(data.meta)).trim());
  lines.push(YAML_DELIMITER);
  lines.push('');

  // User profile
  lines.push('# 用户画像');
  lines.push('');
  if (Object.keys(data.profile.identity).length > 0) {
    lines.push('## 身份');
    for (const [key, value] of Object.entries(data.profile.identity)) {
      lines.push(`- ${key}：${value}`);
    }
    lines.push('');
  }
  if (Object.keys(data.profile.preferences).length > 0) {
    lines.push('## 沟通偏好');
    for (const [key, value] of Object.entries(data.profile.preferences)) {
      lines.push(`- ${key}：${value}`);
    }
    lines.push('');
  }
  if (Object.keys(data.profile.work_patterns).length > 0) {
    lines.push('## 工作模式');
    for (const [key, value] of Object.entries(data.profile.work_patterns)) {
      lines.push(`- ${key}：${value}`);
    }
    lines.push('');
  }

  // Knowledge sections
  if (data.knowledge.length > 0) {
    lines.push('---');
    lines.push('');
    lines.push('# 知识积累');
    lines.push('');
    for (const section of data.knowledge) {
      const countInfo = section.items.length > 0 ? `（${section.items.length}条）` : '';
      lines.push(`## ${section.title}${countInfo}`);
      if (section.description) {
        lines.push(section.description);
      }
      if (section.items.length > 0) {
        lines.push('| # | 主题 | 日期 | 掌握度 |');
        lines.push('|---|------|------|--------|');
        section.items.forEach((item, i) => {
          lines.push(`| ${i + 1} | ${item.topic} | ${item.date || '-'} | ${item.mastery || '-'} |`);
        });
      }
      lines.push('');
    }
  }

  // Projects
  if (data.projects.length > 0) {
    lines.push('---');
    lines.push('');
    lines.push('# 项目上下文');
    lines.push('');
    for (const project of data.projects) {
      lines.push(`## ${project.name}（${project.status === 'active' ? '进行中' : project.status === 'completed' ? '已完成' : '暂停'}）`);
      if (project.description) {
        lines.push(project.description);
      }
      for (const insight of project.key_insights) {
        lines.push(`- ${insight}`);
      }
      if (project.artifacts && project.artifacts.length > 0) {
        lines.push(`- 产出文档：${project.artifacts.join(', ')}`);
      }
      lines.push('');
    }
  }

  // Information feeds
  if (data.feeds.length > 0) {
    lines.push('---');
    lines.push('');
    lines.push('# 关注的信息流');
    lines.push('');
    for (const feed of data.feeds) {
      const parts = [feed.name];
      if (feed.schedule) parts.push(`每日 ${feed.schedule}`);
      if (feed.total_issues) parts.push(`${feed.total_issues}期`);
      lines.push(`- ${parts.join(' | ')}`);
    }
    lines.push('');
  }

  // Raw memories
  if (data.raw_memories.length > 0) {
    lines.push('---');
    lines.push('');
    lines.push('# 原始记忆');
    lines.push('');
    for (const memory of data.raw_memories) {
      const parts: string[] = [
        `source: ${memory.source}`,
        `confidence: ${memory.confidence}`,
      ];
      if (memory.created_at) parts.push(`created: ${memory.created_at}`);
      if (memory.updated_at) parts.push(`updated: ${memory.updated_at}`);
      if (memory.content_hash) parts.push(`hash: ${memory.content_hash}`);
      if (typeof memory.importance === 'number') parts.push(`importance: ${memory.importance.toFixed(2)}`);
      if (typeof memory.freshness === 'number') parts.push(`freshness: ${memory.freshness.toFixed(2)}`);
      if (typeof memory.quality === 'number') parts.push(`quality: ${memory.quality.toFixed(2)}`);
      if (memory.origin?.tool) parts.push(`origin: ${memory.origin.tool}`);
      if (memory.origin?.imported_from) parts.push(`origin_from: ${memory.origin.imported_from}`);
      if (memory.origin?.first_seen_at) parts.push(`first_seen: ${memory.origin.first_seen_at}`);
      const meta = `<!-- ${parts.join(' | ')} -->`;
      lines.push(meta);
      lines.push(`- ${memory.content}`);
    }
    lines.push('');
  }

  // Extensions (tool-specific data)
  if (hasNonEmptyExtensions(data.extensions)) {
    lines.push('---');
    lines.push('');
    lines.push('# 扩展数据');
    lines.push('');
    lines.push('```yaml');
    lines.push(stringifyYaml(data.extensions).trim());
    lines.push('```');
    lines.push('');
  }

  return lines.join('\n');
}

// ============================================================
// Internal helpers
// ============================================================

function splitFrontMatter(content: string): { frontMatter: string; body: string } {
  const lines = content.split('\n');
  let start = -1;
  let end = -1;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === YAML_DELIMITER) {
      if (start === -1) {
        start = i;
      } else {
        end = i;
        break;
      }
    }
  }

  if (start === -1 || end === -1) {
    return { frontMatter: '', body: content };
  }

  const frontMatter = lines.slice(start + 1, end).join('\n');
  const body = lines.slice(end + 1).join('\n');
  return { frontMatter, body };
}

function parseMeta(yamlContent: string): MemoBridgeMeta {
  if (!yamlContent.trim()) {
    return createDefaultMeta();
  }

  // Limit YAML front matter size (prevent excessive parsing)
  if (yamlContent.length > 10000) {
    return createDefaultMeta();
  }

  try {
    const parsed = parseYaml(yamlContent, { maxAliasCount: 10 });
    return {
      version: parsed.version || FORMAT_VERSION,
      exported_at: parsed.exported_at || new Date().toISOString(),
      source: normalizeSource(parsed.source),
      owner: parsed.owner,
      stats: parsed.stats || { total_memories: 0, categories: 0 },
      previous_export: parsed.previous_export,
    };
  } catch {
    return createDefaultMeta();
  }
}

/**
 * Coerce `parsed.source` into the canonical object shape.
 *
 * v0.1 fixtures in the wild sometimes encode `source` as a bare scalar
 * (`source: hermes`) rather than the documented object. Left as-is,
 * downstream importers read `data.meta.source.tool` → `undefined` and
 * emit things like "Imported via MemoBridge from undefined".
 *
 * If the scalar value matches a known ToolId, upgrade it; otherwise
 * fall back to the default object. Anything that is already an object
 * passes through untouched.
 */
function normalizeSource(raw: unknown): MemoBridgeMeta['source'] {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as MemoBridgeMeta['source'];
  }
  if (typeof raw === 'string' && isToolId(raw)) {
    return { tool: raw, extraction_method: 'file' };
  }
  return { tool: 'codebuddy', extraction_method: 'file' };
}

function createDefaultMeta(): MemoBridgeMeta {
  return {
    version: FORMAT_VERSION,
    exported_at: new Date().toISOString(),
    source: { tool: 'codebuddy', extraction_method: 'file' },
    stats: { total_memories: 0, categories: 0 },
  };
}

function flattenMeta(meta: MemoBridgeMeta): Record<string, unknown> {
  return {
    version: meta.version,
    exported_at: meta.exported_at,
    source: meta.source,
    ...(meta.owner ? { owner: meta.owner } : {}),
    stats: meta.stats,
    ...(meta.previous_export ? { previous_export: meta.previous_export } : {}),
  };
}

function splitSections(body: string): Record<string, string> {
  const sections: Record<string, string> = {};
  const lines = body.split('\n');
  let currentTitle = '';
  let currentLines: string[] = [];

  for (const line of lines) {
    const h1Match = line.match(/^# (.+)/);
    if (h1Match) {
      if (currentTitle) {
        sections[currentTitle] = currentLines.join('\n').trim();
      }
      currentTitle = h1Match[1].trim();
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }

  if (currentTitle) {
    sections[currentTitle] = currentLines.join('\n').trim();
  }

  return sections;
}

function parseProfile(content: string): UserProfile {
  const profile: UserProfile = { identity: {}, preferences: {}, work_patterns: {} };
  if (!content) return profile;

  let currentSection: 'identity' | 'preferences' | 'work_patterns' = 'identity';
  for (const line of content.split('\n')) {
    if (line.startsWith('## 身份') || line.startsWith('## Identity')) currentSection = 'identity';
    else if (line.startsWith('## 沟通偏好') || line.startsWith('## Preferences')) currentSection = 'preferences';
    else if (line.startsWith('## 工作模式') || line.startsWith('## Work')) currentSection = 'work_patterns';
    else if (line.startsWith('- ')) {
      const match = line.match(/^- (.+?)[:：](.+)/);
      if (match) {
        profile[currentSection][match[1].trim()] = match[2].trim();
      }
    }
  }
  return profile;
}

function parseKnowledge(content: string): KnowledgeSection[] {
  if (!content) return [];
  const sections: KnowledgeSection[] = [];
  let current: KnowledgeSection | null = null;

  for (const line of content.split('\n')) {
    const h2Match = line.match(/^## (.+?)(?:[（(](\d+).*?[）)])?$/);
    if (h2Match) {
      if (current) sections.push(current);
      current = { title: h2Match[1].trim(), items: [] };
      continue;
    }
    if (current && line.startsWith('|') && !line.startsWith('|---') && !line.startsWith('| #')) {
      const cells = line.split('|').map(c => c.trim()).filter(Boolean);
      if (cells.length >= 2 && cells[0] !== '#') {
        current.items.push({
          topic: cells[1] || '',
          date: cells[2] || undefined,
          mastery: (cells[3] as 'learned' | 'reviewed' | 'mastered') || undefined,
        });
      }
    }
  }
  if (current) sections.push(current);
  return sections;
}

function parseProjects(content: string): ProjectContext[] {
  if (!content) return [];
  const projects: ProjectContext[] = [];
  let current: ProjectContext | null = null;

  for (const line of content.split('\n')) {
    // Match H2 title with optional trailing status in Chinese or English parentheses.
    // The status group is anchored to the end of the line to avoid greedy-vs-lazy
    // pitfalls that would otherwise truncate the name (e.g. `## MemoBridge（进行中）`
    // would match name="M" with a lazy `.+?` followed by an optional group).
    const h2Match = line.match(/^## (.+?)(?:\s*[（(](进行中|已完成|暂停|active|completed|paused)[）)]\s*)?$/i);
    if (h2Match) {
      if (current) projects.push(current);
      const statusMap: Record<string, 'active' | 'completed' | 'paused'> = {
        '进行中': 'active', 'active': 'active',
        '已完成': 'completed', 'completed': 'completed',
        '暂停': 'paused', 'paused': 'paused',
      };
      current = {
        name: h2Match[1].trim(),
        status: statusMap[h2Match[2]?.toLowerCase() || ''] || 'active',
        key_insights: [],
      };
      continue;
    }
    if (current && line.startsWith('- ')) {
      current.key_insights.push(line.slice(2).trim());
    }
  }
  if (current) projects.push(current);
  return projects;
}

function parseFeeds(content: string): InformationFeed[] {
  if (!content) return [];
  return content
    .split('\n')
    .filter(line => line.startsWith('- '))
    .map(line => {
      const parts = line.slice(2).split('|').map(p => p.trim());
      // serialize emits "每日 <schedule>" / "<issues>期"; strip those prefixes/suffixes
      // so round-tripping yields the original scalar values.
      const scheduleRaw = parts[1];
      const schedule = scheduleRaw
        ? scheduleRaw.replace(/^每日\s+/, '')
        : undefined;
      const issuesRaw = parts[2];
      const total_issues = issuesRaw
        ? parseInt(issuesRaw.replace(/期$/, '')) || undefined
        : undefined;
      return {
        name: parts[0] || '',
        schedule,
        total_issues,
      };
    });
}

function parseRawMemories(content: string): Memory[] {
  if (!content) return [];
  const memories: Memory[] = [];
  const lines = content.split('\n');
  let pendingMeta: {
    source: string;
    confidence: number;
    created_at?: string;
    updated_at?: string;
    content_hash?: string;
    importance?: number;
    freshness?: number;
    quality?: number;
    origin_tool?: ToolId;
    origin_from?: ToolId;
    origin_first_seen?: string;
  } | null = null;

  const numOrUndef = (s?: string): number | undefined => {
    if (s === undefined) return undefined;
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : undefined;
  };

  for (const line of lines) {
    // Match `<!-- key1: value1 | key2: value2 | ... -->` and parse each k:v pair.
    // Falls back to the legacy format `<!-- source: X | confidence: Y | DATE -->`
    // where the trailing bare value is taken as created_at for backward compat.
    const commentMatch = line.match(/<!--\s*(.+?)\s*-->/);
    if (commentMatch) {
      const raw = commentMatch[1];
      const fields: Record<string, string> = {};
      let legacyDate: string | undefined;
      for (const segment of raw.split('|').map(s => s.trim())) {
        const kv = segment.match(/^([a-zA-Z_]+):\s*(.+)$/);
        if (kv) fields[kv[1].toLowerCase()] = kv[2].trim();
        else if (segment) legacyDate = segment; // bare value (old format)
      }
      if (fields.source && fields.confidence) {
        pendingMeta = {
          source: fields.source,
          confidence: parseFloat(fields.confidence),
          created_at: fields.created || legacyDate,
          updated_at: fields.updated,
          content_hash: fields.hash,
          importance: numOrUndef(fields.importance),
          freshness: numOrUndef(fields.freshness),
          quality: numOrUndef(fields.quality),
          origin_tool: isToolId(fields.origin) ? fields.origin : undefined,
          origin_from: isToolId(fields.origin_from) ? fields.origin_from : undefined,
          origin_first_seen: fields.first_seen,
        };
        continue;
      }
    }
    if (line.startsWith('- ') && pendingMeta) {
      const memory: Memory = {
        id: `mem-${memories.length + 1}`,
        content: line.slice(2).trim(),
        category: 'general',
        source: pendingMeta.source,
        confidence: pendingMeta.confidence,
        created_at: pendingMeta.created_at,
        updated_at: pendingMeta.updated_at,
      };
      if (pendingMeta.content_hash) memory.content_hash = pendingMeta.content_hash;
      if (pendingMeta.importance !== undefined) memory.importance = pendingMeta.importance;
      if (pendingMeta.freshness !== undefined) memory.freshness = pendingMeta.freshness;
      if (pendingMeta.quality !== undefined) memory.quality = pendingMeta.quality;
      if (pendingMeta.origin_tool) {
        memory.origin = {
          tool: pendingMeta.origin_tool,
          ...(pendingMeta.origin_from ? { imported_from: pendingMeta.origin_from } : {}),
          ...(pendingMeta.origin_first_seen ? { first_seen_at: pendingMeta.origin_first_seen } : {}),
        };
      }
      memories.push(memory);
      pendingMeta = null;
    }
  }
  return memories;
}

/**
 * Parse the `# 扩展数据` section content. The section body is expected to
 * contain a fenced ```yaml ... ``` block. Returns undefined if the section
 * is absent, empty, or the YAML is malformed.
 */
function parseExtensions(content: string): ExtensionsMap | undefined {
  if (!content.trim()) return undefined;

  // Extract the yaml-fenced block body. Be forgiving about the fence style
  // — accept ```yaml or ```yml, and also bare ``` fences.
  const fenceMatch = content.match(/```(?:yaml|yml)?\s*\n([\s\S]*?)\n```/);
  const yamlBody = fenceMatch ? fenceMatch[1] : content;

  if (yamlBody.length > 100_000) return undefined; // guard against huge inputs

  try {
    const parsed = parseYaml(yamlBody, { maxAliasCount: 10 });
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
    // Coerce to ExtensionsMap shape; only keep values that are objects
    const out: ExtensionsMap = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        out[key] = value as Record<string, unknown>;
      }
    }
    return Object.keys(out).length > 0 ? out : undefined;
  } catch {
    return undefined;
  }
}

function hasNonEmptyExtensions(ext: ExtensionsMap | undefined): boolean {
  if (!ext) return false;
  for (const value of Object.values(ext)) {
    if (value && typeof value === 'object' && Object.keys(value).length > 0) {
      return true;
    }
  }
  return false;
}
