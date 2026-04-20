/**
 * MemoBridge — Multi-source memory merger
 */

import type { MemoBridgeData, Memory } from './types.js';

/**
 * Merge multiple MemoBridgeData into one, deduplicating by content similarity
 */
export function mergeMemories(...sources: MemoBridgeData[]): MemoBridgeData {
  if (sources.length === 0) throw new Error('At least one source required');
  if (sources.length === 1) return sources[0];

  const base = structuredClone(sources[0]);

  for (let i = 1; i < sources.length; i++) {
    const other = sources[i];

    // Merge profile (later source wins on conflicts)
    Object.assign(base.profile.identity, other.profile.identity);
    Object.assign(base.profile.preferences, other.profile.preferences);
    Object.assign(base.profile.work_patterns, other.profile.work_patterns);

    // Merge knowledge (deduplicate by topic name)
    for (const section of other.knowledge) {
      const existing = base.knowledge.find(s => s.title === section.title);
      if (existing) {
        for (const item of section.items) {
          if (!existing.items.some(e => e.topic === item.topic)) {
            existing.items.push(item);
          }
        }
      } else {
        base.knowledge.push(section);
      }
    }

    // Merge projects (deduplicate by name)
    for (const project of other.projects) {
      if (!base.projects.some(p => p.name === project.name)) {
        base.projects.push(project);
      }
    }

    // Merge feeds (deduplicate by name)
    for (const feed of other.feeds) {
      if (!base.feeds.some(f => f.name === feed.name)) {
        base.feeds.push(feed);
      }
    }

    // Merge raw memories (deduplicate by content similarity)
    for (const memory of other.raw_memories) {
      if (!isDuplicate(memory, base.raw_memories)) {
        base.raw_memories.push(memory);
      }
    }
  }

  // Update stats
  base.meta.stats.total_memories = countAllMemories(base);
  base.meta.stats.categories = countCategories(base);
  base.meta.exported_at = new Date().toISOString();

  return base;
}

function isDuplicate(memory: Memory, existing: Memory[]): boolean {
  return existing.some(e => {
    const contentA = e.content.toLowerCase().trim();
    const contentB = memory.content.toLowerCase().trim();
    return contentA === contentB || jaccardSimilarity(contentA, contentB) > 0.8;
  });
}

function jaccardSimilarity(a: string, b: string): number {
  const setA = new Set(a.split(/\s+/));
  const setB = new Set(b.split(/\s+/));
  const intersection = new Set([...setA].filter(x => setB.has(x)));
  const union = new Set([...setA, ...setB]);
  return union.size === 0 ? 0 : intersection.size / union.size;
}

function countAllMemories(data: MemoBridgeData): number {
  let count = data.raw_memories.length;
  for (const section of data.knowledge) {
    count += section.items.length;
  }
  count += data.projects.length;
  count += data.feeds.length;
  count += Object.keys(data.profile.identity).length;
  count += Object.keys(data.profile.preferences).length;
  count += Object.keys(data.profile.work_patterns).length;
  return count;
}

function countCategories(data: MemoBridgeData): number {
  const categories = new Set<string>();
  if (Object.keys(data.profile.identity).length) categories.add('profile');
  if (Object.keys(data.profile.preferences).length) categories.add('preferences');
  if (Object.keys(data.profile.work_patterns).length) categories.add('work_patterns');
  for (const s of data.knowledge) categories.add(`knowledge:${s.title}`);
  if (data.projects.length) categories.add('projects');
  if (data.feeds.length) categories.add('feeds');
  if (data.raw_memories.length) categories.add('raw_memories');
  return categories.size;
}
