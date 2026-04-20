/**
 * MemoBridge — Public API entry point
 */

// Core types
export type {
  MemoBridgeData,
  MemoBridgeMeta,
  UserProfile,
  Memory,
  KnowledgeSection,
  KnowledgeItem,
  ProjectContext,
  InformationFeed,
  ToolId,
  Extractor,
  Importer,
  ExtractOptions,
  ImportOptions,
  ImportResult,
  DetectResult,
  WorkspaceInfo,
} from './core/types.js';

export { TOOL_IDS, TOOL_NAMES } from './core/types.js';

// Core functions
export { parseMemoBridge, serializeMemoBridge } from './core/schema.js';
export { mergeMemories } from './core/merger.js';
export { scanAndRedact, hasSensitiveInfo } from './core/privacy.js';
export { detectTool, detectAllTools, scanCodeBuddyWorkspaces, autoDiscoverCodeBuddyWorkspaces } from './core/detector.js';
