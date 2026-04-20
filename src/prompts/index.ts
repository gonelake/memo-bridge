/**
 * MemoBridge — Prompt template index
 */

import { getExportPrompt as getDouBaoPrompt } from './doubao.js';
import { getExportPrompt as getKimiPrompt } from './kimi.js';
import { getExportPrompt as getChatGPTPrompt } from './chatgpt.js';
import { getUniversalExportPrompt } from './universal.js';
import type { ToolId } from '../core/types.js';

const PROMPT_MAP: Partial<Record<ToolId, () => string>> = {
  doubao: getDouBaoPrompt,
  kimi: getKimiPrompt,
  chatgpt: getChatGPTPrompt,
};

export function getExportPromptForTool(toolId: ToolId, toolName?: string): string {
  const getter = PROMPT_MAP[toolId];
  if (getter) return getter();
  return getUniversalExportPrompt(toolName);
}

export { getUniversalExportPrompt } from './universal.js';
