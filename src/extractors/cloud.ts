/**
 * MemoBridge — Cloud-based tool extractor
 *
 * Cloud-based AI tools (ChatGPT, Doubao, Kimi) do not expose their memory
 * via files or APIs that can be read locally. Users must export memories
 * through a prompt-guided conversation and save the response as a
 * memo-bridge.md file manually.
 *
 * CloudExtractor reports the tool as "detected" (always available in the
 * cloud) and raises a clear error if someone attempts to `extract` it.
 */

import { BaseExtractor } from './base.js';
import type { DetectResult, ExtractOptions, MemoBridgeData } from '../core/types.js';

export class ExtractionNotSupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExtractionNotSupportedError';
  }
}

export abstract class CloudExtractor extends BaseExtractor {
  async detect(): Promise<DetectResult> {
    return {
      tool: this.toolId,
      name: this.toolName,
      detected: true, // cloud tools are always "available" via prompt export
      details: `${this.toolName} — use 'memo-bridge prompt --for ${this.toolId}' to export`,
    };
  }

  async extract(_options: ExtractOptions): Promise<MemoBridgeData> {
    throw new ExtractionNotSupportedError(
      `${this.toolName} 不支持直接导出（云端工具）。请运行: memo-bridge prompt --for ${this.toolId}`,
    );
  }
}
