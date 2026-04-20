/**
 * MemoBridge — Extractor base class
 */

import type { Extractor, ToolId, DetectResult, ExtractOptions, MemoBridgeData, MemoBridgeMeta } from '../core/types.js';
import { TOOL_NAMES } from '../core/types.js';

export abstract class BaseExtractor implements Extractor {
  abstract readonly toolId: ToolId;

  get toolName(): string {
    return TOOL_NAMES[this.toolId];
  }

  abstract detect(): Promise<DetectResult>;
  abstract extract(options: ExtractOptions): Promise<MemoBridgeData>;

  protected createMeta(
    method: MemoBridgeMeta['source']['extraction_method'],
    workspace?: string,
    totalMemories: number = 0,
    categories: number = 0,
    earliest?: string,
    latest?: string,
  ): MemoBridgeMeta {
    return {
      version: '0.1',
      exported_at: new Date().toISOString(),
      source: {
        tool: this.toolId,
        workspace,
        extraction_method: method,
      },
      stats: {
        total_memories: totalMemories,
        categories,
        earliest,
        latest,
      },
    };
  }

  protected createEmptyData(workspace?: string): MemoBridgeData {
    return {
      meta: this.createMeta('file', workspace),
      profile: { identity: {}, preferences: {}, work_patterns: {} },
      knowledge: [],
      projects: [],
      feeds: [],
      raw_memories: [],
    };
  }
}
