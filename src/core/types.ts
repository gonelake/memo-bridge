/**
 * MemoBridge — AI Memory Migration Tool
 * Core type definitions
 */

// ============================================================
// Tool identifiers
// ============================================================

export const TOOL_IDS = [
  'codebuddy',
  'openclaw',
  'hermes',
  'claude-code',
  'cursor',
  'chatgpt',
  'doubao',
  'kimi',
] as const;

export type ToolId = (typeof TOOL_IDS)[number];

export const TOOL_NAMES: Record<ToolId, string> = {
  codebuddy: 'CodeBuddy',
  openclaw: 'OpenClaw',
  hermes: 'Hermes Agent',
  'claude-code': 'Claude Code',
  cursor: 'Cursor',
  chatgpt: 'ChatGPT',
  doubao: '豆包',
  kimi: 'Kimi',
};

export type ExtractionMethod = 'file' | 'api' | 'prompt_guided' | 'chat_reverse';

// ============================================================
// memo-bridge.md data structure
// ============================================================

export interface MemoBridgeMeta {
  version: string;
  exported_at: string;
  source: {
    tool: ToolId;
    tool_version?: string;
    workspace?: string;
    extraction_method: ExtractionMethod;
  };
  owner?: {
    id?: string;
    locale?: string;
    timezone?: string;
  };
  stats: {
    total_memories: number;
    categories: number;
    earliest?: string;
    latest?: string;
  };
}

export interface UserProfile {
  identity: Record<string, string>;
  preferences: Record<string, string>;
  work_patterns: Record<string, string>;
}

export interface Memory {
  id: string;
  content: string;
  category: string;
  source: string;
  confidence: number;
  created_at?: string;
  updated_at?: string;
  tags?: string[];
}

export interface KnowledgeItem {
  topic: string;
  date?: string;
  summary?: string;
  mastery?: 'learned' | 'reviewed' | 'mastered';
}

export interface KnowledgeSection {
  title: string;
  description?: string;
  items: KnowledgeItem[];
}

export interface ProjectContext {
  name: string;
  status: 'active' | 'completed' | 'paused';
  description?: string;
  key_insights: string[];
  artifacts?: string[];
  updated_at?: string;
}

export interface InformationFeed {
  name: string;
  schedule?: string;
  description?: string;
  total_issues?: number;
  latest_date?: string;
}

export interface MemoBridgeData {
  meta: MemoBridgeMeta;
  profile: UserProfile;
  knowledge: KnowledgeSection[];
  projects: ProjectContext[];
  feeds: InformationFeed[];
  raw_memories: Memory[];
}

// ============================================================
// Extractor / Importer interfaces
// ============================================================

export interface ExtractOptions {
  workspace?: string;    // 指定单个工作区
  scanDir?: string;      // 指定扫描根目录（自动发现所有工作区）
  verbose?: boolean;
}

export interface WorkspaceInfo {
  path: string;
  tool: ToolId;
  hasAutomations: boolean;
  hasMemory: boolean;
  automationCount: number;
  memoryFileCount: number;
}

export interface ImportOptions {
  workspace?: string;
  overwrite?: boolean;
  dryRun?: boolean;
  maxChars?: number;
}

export interface ImportResult {
  success: boolean;
  method: 'file_write' | 'clipboard' | 'instruction';
  items_imported: number;
  items_skipped: number;
  output_path?: string;
  clipboard_content?: string;
  instructions?: string;
  warnings?: string[];
}

export interface DetectResult {
  tool: ToolId;
  name: string;
  detected: boolean;
  paths?: string[];
  details?: string;
}

export interface Extractor {
  readonly toolId: ToolId;
  readonly toolName: string;
  detect(): Promise<DetectResult>;
  extract(options: ExtractOptions): Promise<MemoBridgeData>;
}

export interface Importer {
  readonly toolId: ToolId;
  readonly toolName: string;
  import(data: MemoBridgeData, options: ImportOptions): Promise<ImportResult>;
}
