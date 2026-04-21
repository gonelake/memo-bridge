/**
 * MemoBridge — Default adapter registrations
 *
 * Importing this module registers all built-in Extractor and Importer
 * adapters into the shared registries as a side effect. Consumers
 * (CLI, library users) typically just `import 'memobridge/registry/defaults'`
 * once at startup. Advanced users can also call `registerDefaults()`
 * explicitly, e.g. after clearing a registry in tests.
 */

import { extractorRegistry, importerRegistry } from '../core/registry.js';

// Local extractors
import CodeBuddyExtractor from '../extractors/codebuddy.js';
import OpenClawExtractor from '../extractors/openclaw.js';
import HermesExtractor from '../extractors/hermes.js';
import ClaudeCodeExtractor from '../extractors/claude-code.js';
import CursorExtractor from '../extractors/cursor.js';

// Cloud extractors (detect-only, extract throws a friendly error)
import ChatGPTExtractor from '../extractors/chatgpt.js';
import DouBaoExtractor from '../extractors/doubao.js';
import KimiExtractor from '../extractors/kimi.js';

// Importers
import OpenClawImporter from '../importers/openclaw.js';
import HermesImporter from '../importers/hermes.js';
import ClaudeCodeImporter from '../importers/claude-code.js';
import CursorImporter from '../importers/cursor.js';
import {
  ChatGPTImporter,
  DouBaoImporter,
  KimiImporter,
  CodeBuddyImporter,
} from '../importers/instruction-based.js';

let registered = false;

export function registerDefaults(): void {
  // Extractors — order determines detect-all output order
  extractorRegistry.register('codebuddy',   () => new CodeBuddyExtractor());
  extractorRegistry.register('openclaw',    () => new OpenClawExtractor());
  extractorRegistry.register('hermes',      () => new HermesExtractor());
  extractorRegistry.register('claude-code', () => new ClaudeCodeExtractor());
  extractorRegistry.register('cursor',      () => new CursorExtractor());
  extractorRegistry.register('chatgpt',     () => new ChatGPTExtractor());
  extractorRegistry.register('doubao',      () => new DouBaoExtractor());
  extractorRegistry.register('kimi',        () => new KimiExtractor());

  // Importers
  importerRegistry.register('codebuddy',    () => new CodeBuddyImporter());
  importerRegistry.register('openclaw',     () => new OpenClawImporter());
  importerRegistry.register('hermes',       () => new HermesImporter());
  importerRegistry.register('claude-code',  () => new ClaudeCodeImporter());
  importerRegistry.register('cursor',       () => new CursorImporter());
  importerRegistry.register('chatgpt',      () => new ChatGPTImporter());
  importerRegistry.register('doubao',       () => new DouBaoImporter());
  importerRegistry.register('kimi',         () => new KimiImporter());

  registered = true;
}

// Auto-register on module load
if (!registered) {
  registerDefaults();
}
