# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**MemoBridge** is an AI memory migration tool that enables users to freely move memories and context between AI tools (CodeBuddy, Claude Code, Cursor, Hermes, OpenClaw, ChatGPT, Doubao, Kimi, etc.). The tool provides extraction, transformation, import, and one-step migration capabilities with built-in privacy sanitization, quality scoring, incremental sync, and automatic backup/rollback.

**Language:** TypeScript (ESM, target ES2022)
**Runtime:** Node.js >= 22.0.0
**Package Manager:** npm

## Build, Test, and Development Commands

### Development
- `npm run dev` — Watch mode, rebuilds on file changes
- `npm run build` — Full build to `dist/` (tsup bundler)
- `npm run lint` — Type-check without emitting (tsc --noEmit)
- `npm test` — Run all tests (vitest)
- `npm run test:watch` — Watch test mode (vitest with reload)

### Running a Single Test
```bash
npm test -- tests/core/privacy.test.ts          # Single file
npm test -- privacy                              # Pattern match
npm test -- --reporter=verbose tests/core/privacy.test.ts
```

### CLI Usage (Local Development)
```bash
npm start                                        # Run CLI from dist/cli.js
node dist/cli.js detect                         # After building
npx memo-bridge detect                          # From npm registry (if published)
```

### Key npm Scripts
- `npm start` — Execute CLI entrypoint
- `npm run prepublishOnly` — Runs build before npm publish

## Code Architecture

### High-Level Overview

MemoBridge follows a **hub-and-spoke adapter pattern** with a shared **Markdown + YAML format** as the interchange layer:

```
┌─────────────────────────────────────────────────────────────────┐
│                           CLI (cli.ts)                          │
│  Commands: detect, extract, import, migrate, prompt, backup    │
└──────────────────────┬──────────────────────────────────────────┘
                       │
        ┌──────────────┼──────────────┐
        │              │              │
┌───────▼────┐  ┌─────▼─────┐  ┌────▼────────┐
│ Extractors │  │  Core     │  │  Importers  │
│            │  │  Modules  │  │             │
└────────────┘  └───────────┘  └─────────────┘
        │        ↓ ↑ ↓ ↑              │
        │     {Schema}               │
        │     {Merger}               │
        │     {Privacy}              │
        │     {Quality}              │
        │     {Diff}                 │
        │     {Config}               │
        │     {Backup}               │
        │     {Detector}             │
        └──────────────┬─────────────┘
                       │
            ┌──────────▼──────────┐
            │  memo-bridge.md     │
            │  (YAML front matter │
            │   + Markdown body)  │
            └─────────────────────┘
```

### Core Concepts

#### 1. **Tool Adapters (Extractor/Importer)**
- **Base classes** (`src/extractors/base.ts`, `src/importers/base.ts`) define the contract
- **Registry pattern** (`src/core/registry.ts`) enables lazy instantiation and runtime swapping
- **Extractors** (8 tools) read from tool-specific storage formats and normalize to `MemoBridgeData`
- **Importers** (8 tools) write from `MemoBridgeData` back to tool-specific formats
- New tools: extend `BaseExtractor`/`BaseImporter`, implement `extract()`/`import()`, register in `src/registry/defaults.ts`

#### 2. **memo-bridge.md Format**
The unified interchange format in `src/core/schema.ts`:
```yaml
---
version: "0.1"
exported_at: "2026-04-23T..."
source:
  tool: codebuddy
  extraction_method: file | api | prompt_guided | chat_reverse
  ...
stats:
  total_memories: N
  categories: M
---

# 用户画像
## 身份
- Name: Alice

## 沟通偏好
...

# 知识积累
...

# 项目上下文
...

# 关注的信息流
...

# 原始记忆
...

# 扩展数据
...
```

**Key trait:** Human-readable, LLM-friendly, Git-trackable. Supports v0.2 quality fields: `content_hash`, `importance`, `freshness`, `quality`, `origin`.

#### 3. **Core Modules** (src/core/)
- **schema.ts** — YAML ↔ Markdown parser/serializer
- **types.ts** — All TypeScript interfaces; registry of tool IDs
- **privacy.ts** — Detects 18+ patterns (API keys, passwords, tokens, emails, IPs) and redacts in-place
- **quality.ts** — Content hash (SHA256-12), importance heuristics (keywords + length), freshness decay, composite scores
- **merger.ts** — Deduplicates and merges multiple `MemoBridgeData` (multi-workspace support)
- **diff.ts** — Incremental sync: computes delta (new/changed/deleted), ledger (content hashes imported into each tool)
- **backup.ts** — Snapshots files before import, stores in `.memobridge/backups/<tool>-<ts>/`, supports rollback
- **config.ts** — Loads `.memobridge.yaml` (project + global), validates paths/regex, applies ReDoS guard on user patterns
- **detector.ts** — Detects installed tools, scans workspaces (e.g., auto-discover CodeBuddy across `~/projects/*`)
- **registry.ts** — Generic adapter registry (factory pattern, lazy instantiation)

#### 4. **Command Flow**
- **extract**: Tool → extractor.extract() → MemoBridgeData → quality.scoreMemories() → privacy scan → serialize → .md
- **import**: .md → parse → quality.scoreMemories() → (incremental: filter via ledger) → importer.import() → Tool
- **migrate**: extract() → import() (same MemoBridgeData in-memory)
- **detect**: Run all extractors' detect() methods, report available tools
- **prompt**: Template-based export guidance for cloud tools (ChatGPT, Doubao, Kimi)
- **backup**: Snapshot targets before write; list/restore snapshots

### Directory Structure

```
src/
├── cli.ts                 # Entry point; command dispatch (detect, extract, import, migrate, prompt, backup)
├── index.ts               # Public API exports for library consumers
├── core/                  # Core business logic (no tool-specific code)
│   ├── types.ts           # ToolId, MemoBridgeData, Extractor/Importer interfaces
│   ├── schema.ts          # memo-bridge.md parse/serialize
│   ├── registry.ts        # AdapterRegistry<T> (lazy factory pattern)
│   ├── privacy.ts         # Regex-based sensitive-info redaction
│   ├── quality.ts         # Hash, importance, freshness, quality scoring
│   ├── merger.ts          # Multi-source deduplication
│   ├── diff.ts            # Incremental sync: content-addressable delta + import ledger
│   ├── backup.ts          # File snapshots + rollback
│   ├── config.ts          # .memobridge.yaml loader (project + global, path/regex validation)
│   └── detector.ts        # Tool detection & workspace scanning
├── extractors/            # Tool-specific: read from tool storage
│   ├── base.ts            # BaseExtractor (declarative detection, YAML serialization helpers)
│   ├── codebuddy.ts       # .codebuddy/, .memory/ multi-workspace scanning
│   ├── openclaw.ts        # ~/.openclaw/ + workspace MEMORY.md
│   ├── hermes.ts          # ~/.hermes/memories/ + skill extensions
│   ├── claude-code.ts     # CLAUDE.md detection (project + global)
│   ├── cursor.ts          # .cursorrules + .cursor/rules/
│   ├── cloud.ts           # Base for prompt-guided cloud tools (throws unsupported)
│   ├── chatgpt.ts         # Cloud tool
│   ├── doubao.ts          # Cloud tool (Chinese)
│   └── kimi.ts            # Cloud tool (Chinese)
├── importers/             # Tool-specific: write to tool storage
│   ├── base.ts            # BaseImporter (flatten, helpers, listTargets)
│   ├── claude-code.ts     # Write CLAUDE.md (project or ~/.claude/)
│   ├── cursor.ts          # Write .cursorrules or .cursor/rules/
│   ├── openclaw.ts        # Write ~/.openclaw/ + extensions (SOUL.md, DREAMS.md)
│   ├── hermes.ts          # Write ~/.hermes/memories/ + skill stubs
│   ├── instruction-based.ts # Cloud tools: return clipboard text or instructions
│   └── file-write.ts      # Shared file-write logic (overwrite/append, symlink guard)
├── prompts/               # Export templates for cloud tools
│   ├── chatgpt.ts
│   ├── doubao.ts
│   ├── kimi.ts
│   ├── universal.ts
│   └── index.ts           # getExportPromptForTool()
├── registry/
│   └── defaults.ts        # registerDefaults() — registers all 8 extractors & importers
└── utils/
    ├── logger.ts          # chalk-based colored output (header, info, warn, error, table, etc.)
    ├── fs.ts              # File I/O helpers (read, dir listing, path detection)
    └── security.ts        # Path validation (forbidden dirs, null bytes), symlink guard, size limits
```

### Test Structure

```
tests/
├── core/
│   ├── privacy.test.ts       # 44 tests: redaction patterns (API keys, passwords, tokens, emails, IPs)
│   ├── quality.test.ts       # 30 tests: hashing, importance, freshness, composite scoring
│   ├── schema.test.ts        # 49 tests: YAML parse/serialize round-trip, section splitting
│   ├── merger.test.ts        # 24 tests: deduplication, multi-source merge
│   ├── diff.test.ts          # 33 tests: delta computation, ledger recording/filtering
│   ├── backup.test.ts        # 23 tests: snapshot, list, restore, retention pruning
│   ├── config.test.ts        # 26 tests: .memobridge.yaml load, path/regex validation, ReDoS guard
│   ├── registry.test.ts      # 20 tests: adapter registration/resolution
│   ├── detector.test.ts      # 14 tests: tool detection, workspace scanning
│   └── types.test.ts         # 4 tests: ToolId guards
├── extractors/
│   ├── codebuddy.test.ts     # 29 tests: multi-workspace, privacy redaction, memory parsing
│   ├── openclaw.test.ts      # 23 tests: MEMORY.md + extensions (SOUL, DREAMS)
│   ├── hermes.test.ts        # 25 tests: skills, MEMORY.md, USER.md
│   ├── claude-code.test.ts   # 23 tests: CLAUDE.md detection (project + global)
│   ├── cursor.test.ts        # 22 tests: .cursorrules + .cursor/rules/
│   └── base.test.ts          # 31 tests: file reading, MAX_READ_SIZE handling
├── importers/
│   ├── file-write.test.ts    # 49 tests: Claude Code, Cursor, OpenClaw, Hermes (file writes)
│   └── instruction.test.ts   # 32 tests: ChatGPT, Doubao, Kimi, CodeBuddy (instructions)
├── utils/
│   └── security.test.ts      # 38 tests: path validation, symlink guard, size limits
└── fixtures/                 # Test data

**Total: 539 tests across 19 files. All passing.**
```

### Key Design Decisions

1. **Content-Addressable Identities (v0.2)**: Memories use `content_hash` (SHA256-12) as the sync key, not tool-local IDs. Enables bidirectional/multi-tool sync without ID collisions.

2. **Registry + Lazy Instantiation**: Adapters are registered as factories, not singletons. Enables test isolation, custom adapter swapping, and minimal startup overhead.

3. **Declarative Detection**: `BaseExtractor.detectConfig` (paths + markers) eliminates repetitive path checking; custom logic can override `detect()`.

4. **Privacy at Extraction**: Privacy scan applied inside each extractor (18+ patterns built-in) + user-supplied regex via config. No separate sanitization step.

5. **Quality Scoring (v0.2)**: Heuristic-only (keywords, length, recency, confidence). Zero dependencies on embeddings/LLM. Scores included in export for downstream use.

6. **Incremental Sync (v0.2)**: Two mechanisms:
   - `extract --since <prev.md>`: Computes diff and exports only new/changed memories
   - `import --mode=incremental`: Filters via per-tool ledger (`.memobridge/imported/<tool>.hashes`) using O_APPEND atomicity

7. **Automatic Backup (v0.2)**: Importers declare targets via `listTargets()`; CLI snapshots before write. Enables one-cmd rollback.

8. **Extensions Closure (v0.2)**: Tool-specific data (Hermes skills, OpenClaw SOUL, DREAMS) preserved in `extensions` map. Partial support for round-trip; full interop deferred to v0.3.

9. **Config Hierarchy**: CLI flags > project `.memobridge.yaml` (walk-upward search) > global `~/.config/memobridge/config.yaml` > hardcoded defaults. List fields union + dedupe.

10. **ReDoS Guard (v0.2)**: User regex patterns tested for catastrophic backtracking before registration. Drops problematic patterns with warning.

## v0.2 Feature Set (Released)

### Quality & Sync
- Content hash (`content_hash`), importance score, freshness decay, composite `quality` score
- Incremental extraction (`--since`) and incremental import (`--mode=incremental`)
- Import ledger (per-tool tracking of imported content hashes)

### Reliability
- Automatic backup before import/migrate with rollback support (`backup list`, `backup restore`)
- Privacy sanitization (18+ patterns: API keys, passwords, tokens, IPs, emails)
- Config file support (`.memobridge.yaml`, ReDoS guard on user regex)

### Safety
- Path validation (forbidden dirs, null bytes, symlink guards)
- Content size limits (MAX_READ_SIZE = 10MB per file, MAX_WRITE = 50MB total)
- Ledger O_APPEND atomicity for concurrent safety

## v0.3 Roadmap

- MCP Server for cross-tool real-time memory sharing
- Cross-tool skill/automation interop (Hermes ↔ CodeBuddy ↔ Claude)
- Three-way merge and deletion propagation
- Semantic deduplication (optional embedding dependency)

## Common Workflows

### Extract from CodeBuddy with Auto-Discovery
```bash
npm run build
npm start extract --from codebuddy --verbose
# Outputs: ./memo-bridge.md
```

### Incremental Extract (Only New/Changed)
```bash
npm start extract --from codebuddy --since ./previous-export.md --output ./new-export.md
```

### Import to Claude Code
```bash
npm start import --to claude-code --input ./memo-bridge.md
# Writes to: CLAUDE.md (project or ~/.claude/)
```

### One-Step Migration with Backup
```bash
npm start migrate --from codebuddy --to claude-code
# Auto-creates backup; on success, shows restore ID if needed
```

### Dry-Run Before Import
```bash
npm start import --to cursor --input ./memo-bridge.md --dry-run
```

### List and Restore Backups
```bash
npm start backup list --tool claude-code
npm start backup restore <id>
```

### Get Export Prompt for Cloud Tools
```bash
npm start prompt --for doubao
# Copies prompt; paste in Doubao chat and export response
```

## Configuration

### `.memobridge.yaml` (Project or Global)
```yaml
# Project level: .memobridge.yaml (git walk-upward discovery)
# Global level: ~/.config/memobridge/config.yaml

default_workspace: ~/projects/my-app

privacy:
  extra_patterns:
    - 'my-secret-\w+'
    - 'INTERNAL_\w+'

quality:
  importance_keywords:
    - 'critical'
    - '关键'

backup:
  retention: 10  # Keep last 10 backups per tool
```

**Validation:**
- `default_workspace`: checked against forbidden dirs (`/etc`, `~/.ssh`, system paths)
- `privacy.extra_patterns`: tested for ReDoS (50ms timeout on test string); invalid patterns dropped
- `backup.retention`: must be positive integer

## Security Notes

- **Privacy Redaction**: 18 patterns covering OpenAI/Anthropic/GitHub/AWS keys, bearer tokens, passwords, DB strings, SSH keys, emails, private IPs. Applied at extraction + optional user patterns.
- **Path Sanitization**: Null-byte rejection, forbidden-dir blocklist, symlink guards, size limits.
- **Ledger Atomicity**: Import ledger uses O_APPEND to avoid race conditions.
- **Backup Integrity**: Symlink-following protection; `.memobridge/` added to `.gitignore`.

## Dependencies

**Runtime:**
- `chalk` — Terminal colors
- `commander` — CLI argument parsing
- `inquirer` — Interactive prompts (future use)
- `ora` — Spinner animations
- `yaml` — YAML parse/stringify

**Dev:**
- `typescript` — Type checking
- `vitest` — Test runner
- `tsup` — Bundler (ESM)
- `@types/node` — Node types

**Zero new dependencies in v0.2; privacy/quality/backup/diff implemented in-house.**

## Notes for Future Work

- **Test Coverage**: 539 tests; prioritize privacy, diff, and backup modules when adding features
- **Extractor Extension**: Copy pattern from `src/extractors/codebuddy.ts` (multi-workspace, deduplication)
- **Importer Extension**: Copy pattern from `src/importers/claude-code.ts` (overwrite/append, symlink safety)
- **Incremental Sync**: Use `content_hash` as the identity key, not tool-local IDs
- **Config Defaults**: In `src/core/config.ts` and tests; update if adding new config fields
