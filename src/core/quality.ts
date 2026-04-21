/**
 * MemoBridge — Memory quality scoring (v0.2)
 *
 * Pure, dependency-free heuristic scoring of Memory objects. Runs at the
 * tail end of every extract() to populate content_hash + importance +
 * freshness + quality fields. Idempotent: re-running on already-scored
 * data yields the same scores (hash is stable; importance/freshness are
 * pure functions of content + timestamps).
 *
 * Design notes:
 * - No embedding, no LLM, no network. Rule-based only.
 * - Scores are best-effort signals, not ground truth. Downstream consumers
 *   (incremental diff, importer truncation) use them as tiebreakers.
 * - All inputs are tolerated: missing timestamps → freshness falls back to
 *   1 (treat as fresh); missing content → skipped.
 */

import { createHash } from 'node:crypto';
import type { Memory, MemoBridgeData } from './types.js';

// ============================================================
// Hashing
// ============================================================

/**
 * Stable short content hash. Used as the content-addressable identity of
 * a memory for incremental diff across extracts/imports.
 *
 * We hash the NORMALIZED content (trim + collapse inner whitespace) so
 * cosmetic edits don't change identity.
 */
export function computeHash(content: string): string {
  const normalized = content.trim().replace(/\s+/g, ' ');
  return createHash('sha256').update(normalized).digest('hex').slice(0, 12);
}

// ============================================================
// Freshness (recency decay)
// ============================================================

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Freshness in [0, 1]. Piecewise linear decay:
 *   - ≤ 30d   → 1.0 .. 0.8
 *   - 30-90d  → 0.8 .. 0.5
 *   - 90-365d → 0.5 .. 0.2
 *   - > 365d  → 0.1
 *
 * Missing `dateStr` returns 1.0 (we have no reason to discount).
 * Malformed date strings return 0.5 (neutral; don't silently lose data).
 */
export function computeFreshness(dateStr: string | undefined, now: Date = new Date()): number {
  if (!dateStr) return 1;
  const t = Date.parse(dateStr);
  if (Number.isNaN(t)) return 0.5;

  const ageDays = (now.getTime() - t) / DAY_MS;
  if (ageDays < 0) return 1;                       // future date → treat as fresh
  if (ageDays <= 30)  return round(1 - (ageDays / 30) * 0.2);        // 1.0 → 0.8
  if (ageDays <= 90)  return round(0.8 - ((ageDays - 30) / 60) * 0.3); // 0.8 → 0.5
  if (ageDays <= 365) return round(0.5 - ((ageDays - 90) / 275) * 0.3); // 0.5 → 0.2
  return 0.1;
}

// ============================================================
// Importance (content + category heuristics)
// ============================================================

/**
 * Category weights. Tuned to reflect the "keep this in long-term memory?"
 * intuition — long_term > decision > knowledge > work_log > note.
 * Unknown categories default to 0.5.
 */
const CATEGORY_WEIGHTS: Record<string, number> = {
  long_term: 0.9,
  decision: 0.85,
  identity: 0.85,
  preference: 0.8,
  knowledge: 0.7,
  project: 0.7,
  feedback: 0.7,
  work_log: 0.5,
  daily_note: 0.5,
  note: 0.4,
  general: 0.5,
};

/**
 * Keywords that typically signal a durable, high-value memory. Matched
 * case-insensitively against content. Each hit adds a small bonus (capped).
 *
 * Mix of Chinese and English because the tool is bilingual.
 */
const IMPORTANCE_KEYWORDS = [
  // Chinese
  '决定', '决策', '约定', '规则', '偏好', '坚持', '不要', '必须', '禁止',
  '核心', '重要', '关键', '永远', '始终', '从不',
  // English
  'always', 'never', 'must', 'decided', 'agreed', 'rule', 'preference',
  'important', 'critical', 'key', 'remember',
];

/**
 * Importance in [0, 1]. Compound signal:
 *   - base: category weight
 *   - +keyword hits (up to +0.2)
 *   - +confidence bump (up to +0.1 at confidence=1.0)
 *   - -short-content penalty (content < 20 chars often = noise)
 *
 * Callers may extend IMPORTANCE_KEYWORDS via the optional `extraKeywords`
 * argument (e.g. loaded from .memobridge.yaml in v0.2 M6).
 */
export function computeImportance(
  memory: Pick<Memory, 'content' | 'category' | 'confidence'>,
  extraKeywords: readonly string[] = [],
): number {
  const base = CATEGORY_WEIGHTS[memory.category] ?? 0.5;

  const content = memory.content ?? '';
  const haystack = content.toLowerCase();
  const allKw = [...IMPORTANCE_KEYWORDS, ...extraKeywords];
  let hits = 0;
  for (const kw of allKw) {
    if (haystack.includes(kw.toLowerCase())) hits++;
    if (hits >= 4) break; // cap hits early
  }
  const keywordBonus = Math.min(hits * 0.05, 0.2);

  const confBonus = Math.max(0, (memory.confidence ?? 0.5) - 0.5) * 0.2;

  const shortPenalty = content.trim().length < 20 ? 0.1 : 0;

  return clamp01(round(base + keywordBonus + confBonus - shortPenalty));
}

// ============================================================
// Composite quality
// ============================================================

/**
 * Composite quality score. Geometric-ish: we take a weighted mix that
 * rewards memories which are simultaneously important, fresh, and
 * high-confidence — one weak axis drags the score down proportionally.
 *
 * Formula: 0.5 × importance + 0.3 × freshness + 0.2 × confidence
 *
 * (Not a product — a pure product would collapse to 0 if any field is 0,
 * which is too harsh when freshness is unknown.)
 */
export function computeQuality(
  importance: number,
  freshness: number,
  confidence: number,
): number {
  return clamp01(round(0.5 * importance + 0.3 * freshness + 0.2 * confidence));
}

// ============================================================
// Batch entry point
// ============================================================

export interface ScoreOptions {
  /** Additional keywords to treat as importance signals. */
  importanceKeywords?: readonly string[];
  /** Override "now" for freshness computation — used in tests. */
  now?: Date;
}

/**
 * Populate content_hash / importance / freshness / quality on every memory
 * in `data.raw_memories`. Returns the SAME object (mutated) for convenience.
 *
 * Idempotent: re-running over already-scored data is a no-op (deterministic
 * inputs → identical outputs).
 *
 * Never throws — invalid/missing fields fall back to neutral values.
 */
export function scoreMemories(data: MemoBridgeData, options: ScoreOptions = {}): MemoBridgeData {
  const { importanceKeywords = [], now = new Date() } = options;

  for (const memory of data.raw_memories) {
    if (!memory.content) continue;

    // Respect an existing content_hash if one is already set. Overwriting
    // here would break incremental dedup: full-mode writes the parsed hash
    // (from the v0.2 comment meta) into the ledger, while incremental-mode
    // runs scoreMemories first; if we rewrote the hash in-place, the two
    // paths could diverge for the same physical memory content.
    memory.content_hash ??= computeHash(memory.content);

    const importance = computeImportance(memory, importanceKeywords);
    // Freshness prefers updated_at (most recent touch) over created_at.
    const freshness = computeFreshness(memory.updated_at ?? memory.created_at, now);
    const quality = computeQuality(importance, freshness, memory.confidence ?? 0.5);

    memory.importance = importance;
    memory.freshness = freshness;
    memory.quality = quality;
  }

  return data;
}

// ============================================================
// Internal helpers
// ============================================================

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

function clamp01(n: number): number {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
