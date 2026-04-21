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
  ExtensionsMap,
  ToolId,
  Extractor,
  Importer,
  ExtractOptions,
  ImportOptions,
  ImportResult,
  DetectResult,
  WorkspaceInfo,
} from './core/types.js';

export { TOOL_IDS, TOOL_NAMES, isToolId } from './core/types.js';

// Core functions
export { parseMemoBridge, serializeMemoBridge } from './core/schema.js';
export { mergeMemories } from './core/merger.js';
export { scanAndRedact, hasSensitiveInfo } from './core/privacy.js';
export { detectTool, detectAllTools, scanCodeBuddyWorkspaces, autoDiscoverCodeBuddyWorkspaces } from './core/detector.js';

// Registry — for custom adapter extension
export { AdapterRegistry, extractorRegistry, importerRegistry } from './core/registry.js';
export type { AdapterFactory } from './core/registry.js';

// Adapter base classes — for implementing custom adapters
export { BaseExtractor } from './extractors/base.js';
export type { DetectConfig } from './extractors/base.js';
export { CloudExtractor, ExtractionNotSupportedError } from './extractors/cloud.js';
export { BaseImporter } from './importers/base.js';

// Default registration — call this to register all built-in adapters
export { registerDefaults } from './registry/defaults.js';
