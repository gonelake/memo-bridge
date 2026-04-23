<p align="center">
  <img src="./docs/logo.svg" alt="MemoBridge" width="360"/>
</p>

<p align="center">
  <b>Move your AI memories between tools freely</b><br/>
  <sub>One command to migrate memories between CodeBuddy, Claude Code, Cursor, Hermes, ChatGPT, Doubao, Kimi</sub>
</p>

<p align="center">
  <a href="https://github.com/gonelake/memo-bridge/actions/workflows/ci.yml">
    <img src="https://github.com/gonelake/memo-bridge/actions/workflows/ci.yml/badge.svg" alt="CI"/>
  </a>
  <a href="https://www.npmjs.com/package/memo-bridge">
    <img src="https://img.shields.io/npm/v/memo-bridge.svg?color=6366f1" alt="npm version"/>
  </a>
  <a href="./LICENSE">
    <img src="https://img.shields.io/npm/l/memo-bridge.svg?color=8b5cf6" alt="License: MIT"/>
  </a>
  <img src="https://img.shields.io/node/v/memo-bridge.svg?color=10b981" alt="Node >= 22"/>
  <a href="https://github.com/gonelake/memo-bridge/stargazers">
    <img src="https://img.shields.io/github/stars/gonelake/memo-bridge?style=social" alt="GitHub Stars"/>
  </a>
  <a href="https://github.com/gonelake/memo-bridge/network/members">
    <img src="https://img.shields.io/github/forks/gonelake/memo-bridge?style=social" alt="GitHub Forks"/>
  </a>
</p>

<p align="center">
  <a href="#-why-memobridge">Why</a> •
  <a href="#-quick-start">Quick Start</a> •
  <a href="#-supported-tools">Supported Tools</a> •
  <a href="#-commands">Commands</a> •
  <a href="#-whats-new-in-v02">v0.2 Features</a> •
  <a href="#-roadmap">Roadmap</a> •
  <a href="./README.md">中文</a>
</p>

---

## 🎬 Demo

> **One-command migration: CodeBuddy → Claude Code**

```
$ npx memo-bridge migrate --from codebuddy --to claude-code

🌉 MemoBridge v0.2.0

  ✔ Detected CodeBuddy (3 workspaces)
  ✔ Extracted 65 memories
  ✔ Privacy sanitized (2 secrets redacted)
  ✔ Quality scored (avg 0.74)
  ✔ Auto-backup ~/.claude/CLAUDE.md → .memobridge/backups/claude-code-20260423/
  ✔ Written to ~/.claude/CLAUDE.md (2,341 chars)

  🎉 Migration complete! To roll back:
     npx memo-bridge backup restore claude-code-20260423
```

<!-- 🎬 Run `vhs docs/demo.tape` to generate the GIF -->
![MemoBridge Demo](./docs/demo.gif)

---

## ❓ Why MemoBridge?

AI tools accumulate valuable context about you — preferences, project history, coding style, knowledge progress. But this memory is **locked inside each tool**:

| Pain | Reality |
|------|---------|
| 🔒 ChatGPT/Doubao memories can't be exported | Switch tools = start from zero |
| 🔄 Cursor and CodeBuddy are completely isolated | Same project, two separate contexts |
| 💻 New machine or reinstall | AI knows nothing about you |
| 🤖 Hermes can't inherit OpenClaw context | Retrain every time |

**MemoBridge fixes this with one command:**

```bash
npx memo-bridge migrate --from codebuddy --to claude-code
```

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| 🔍 **Auto-detect** | Scans your system for installed AI tools |
| 📤 **One-click export** | Extract memories into a standard Markdown + YAML format |
| 📥 **Smart import** | Auto-adapts to target format (including Hermes' 2200-char limit) |
| 📋 **Prompt templates** | Optimal export prompts for tools without direct API access |
| 🔐 **Privacy sanitization** | 18+ patterns auto-redact API keys, passwords, tokens |
| 📁 **Multi-workspace** | Auto-scans all workspaces, merges and deduplicates |
| 🔄 **Incremental sync** | Only import new/changed content — safe to run repeatedly |
| 💾 **Auto-backup** | Snapshot before every import, one-command rollback |
| 🇨🇳 **China AI tools** | First migration tool supporting Doubao and Kimi |

---

## 🚀 Quick Start

```bash
# Zero-install
npx memo-bridge

# Or install globally
npm install -g memo-bridge
```

**Requirements**: Node.js >= 22.0.0

### Step 1: Detect installed tools

```bash
npx memo-bridge detect
```

```
🌉 MemoBridge — Tool Detection

  📂 Local tools (direct file access):
     ✅ CodeBuddy    ~/.codebuddy/  (3 workspaces)
     ✅ Claude Code  ~/.claude/CLAUDE.md
     ✅ Cursor       .cursorrules

  ☁️  Cloud tools (prompt-guided):
     📋 ChatGPT
     📋 Doubao (豆包)
     📋 Kimi
```

### Step 2: Export memories

```bash
# From CodeBuddy (auto-scans all workspaces)
npx memo-bridge extract --from codebuddy

# Single workspace
npx memo-bridge extract --from codebuddy --workspace ~/projects/my-app

# Incremental export (only new/changed since last run)
npx memo-bridge extract --from codebuddy --since ./previous-export.md
```

### Step 3: Import memories

```bash
# To Claude Code (writes CLAUDE.md)
npx memo-bridge import --to claude-code --input ./memo-bridge.md

# To Hermes Agent (auto-trims to 2200 chars)
npx memo-bridge import --to hermes --input ./memo-bridge.md

# Incremental import (skips already-imported content)
npx memo-bridge import --to cursor --input ./memo-bridge.md --mode=incremental

# Dry-run (preview without writing)
npx memo-bridge import --to hermes --input ./memo-bridge.md --dry-run
```

### One-step migration

```bash
npx memo-bridge migrate --from codebuddy --to claude-code
npx memo-bridge migrate --from openclaw --to hermes
npx memo-bridge migrate --from codebuddy --to cursor --workspace ~/projects/my-app
```

### Cloud tools (Doubao / Kimi / ChatGPT)

```bash
# Step 1: Get the optimal export prompt
npx memo-bridge prompt --for doubao

# Step 2: Paste the prompt into Doubao chat, copy the AI's response and save as .md

# Step 3: Import into your target tool
npx memo-bridge import --to claude-code --input ./doubao-export.md
```

### Backup & rollback

```bash
npx memo-bridge backup list                     # List all backups
npx memo-bridge backup list --tool claude-code  # Filter by tool
npx memo-bridge backup restore <id>             # Restore a backup
```

---

## 🛠 Supported Tools

### Local tools — fully automated, direct file read/write

| Tool | Export | Import | Memory Path | Multi-workspace |
|------|:------:|:------:|-------------|:---------------:|
| **CodeBuddy** | ✅ Auto | ✅ Auto | `.codebuddy/automations/*/memory.md` + `.memory/*.md` | ✅ |
| **OpenClaw** | ✅ Auto | ✅ Auto | `~/.openclaw/workspace/MEMORY.md` + `memory/` | ✅ |
| **Hermes Agent** | ✅ Auto | ✅ Auto | `~/.hermes/memories/MEMORY.md` + `USER.md` | — |
| **Claude Code** | ✅ Auto | ✅ Auto | `CLAUDE.md` + `~/.claude/CLAUDE.md` | — |
| **Cursor** | ✅ Auto | ✅ Auto | `.cursorrules` + `.cursor/rules/*.md` | ✅ |

### Cloud tools — prompt-guided (one manual copy-paste step)

| Tool | Export | Import | Notes |
|------|:------:|:------:|-------|
| **ChatGPT** | 📋 Prompt-guided | 📋 "Please remember…" instructions | No direct API |
| **Doubao (豆包)** | 📋 Prompt-guided | 📋 "请记住…" instructions | First-class CN support |
| **Kimi** | 📋 Prompt-guided | 📋 Context injection text | First-class CN support |

> **Legend:** ✅ Fully automated · 📋 Prompt-guided (one human step required)

---

## 📖 Commands

### `detect` — Discover installed AI tools

```bash
memo-bridge detect
```

### `extract` — Export memories

```bash
memo-bridge extract --from <tool> [options]

  -f, --from <tool>         Source tool (required)
  -w, --workspace <path>    Single workspace path
  -s, --scan-dir <path>     Workspace scan root (default: ~/projects)
  -o, --output <path>       Output file (default: ./memo-bridge.md)
      --since <prev.md>     Incremental: only export new/changed memories
  -v, --verbose             Verbose output
```

### `import` — Import memories

```bash
memo-bridge import --to <tool> --input <file> [options]

  -t, --to <tool>           Target tool (required)
  -i, --input <file>        Input file path
  -w, --workspace <path>    Target workspace path
      --mode=incremental    Skip already-imported content (ledger-based)
      --dry-run             Preview — no files written
```

### `migrate` — One-step migration

```bash
memo-bridge migrate --from <tool> --to <tool> [options]

  -f, --from <tool>         Source tool
  -t, --to <tool>           Target tool
  -w, --workspace <path>    Workspace path
```

### `prompt` — Get export prompt for cloud tools

```bash
memo-bridge prompt --for <tool>    # doubao | kimi | chatgpt
```

### `backup` — Manage snapshots

```bash
memo-bridge backup list [--tool <tool>]    # List backups
memo-bridge backup restore <id>            # Restore a snapshot
```

---

## 🆕 What's New in v0.2

> v0.1 got memories moving. v0.2 makes it production-safe.

### 📊 Quality Scoring
Every exported memory now carries quality signals:
- `content_hash` — SHA-256 first 12 chars, used as the incremental sync identity
- `importance` — keyword weights + content-length heuristics (bilingual)
- `freshness` — time-decay based on `updated_at` (30/90/365-day buckets)
- `quality` — `0.5·importance + 0.3·freshness + 0.2·confidence` composite

Zero new dependencies — pure rule-based heuristics, no embeddings or LLM calls.

### 💾 Auto-backup + Rollback
- Every `import` / `migrate` automatically snapshots target files first
- Snapshot path: `.memobridge/backups/<tool>-<timestamp>/`
- Configurable retention via `backup.retention` (default: 10)

### 🔄 Incremental Sync
- `--since <prev.md>`: export only memories added/changed since last run
- `--mode=incremental`: per-tool import ledger filters already-imported hashes
- Ledger uses O_APPEND atomicity for concurrent-write safety

### ⚙️ Config File
```yaml
# .memobridge.yaml (project) or ~/.config/memobridge/config.yaml (global)
default_workspace: ~/projects/my-app
privacy:
  extra_patterns:
    - 'my-secret-\w+'
quality:
  importance_keywords:
    - 'critical'
    - 'always'
backup:
  retention: 10
```

Priority: CLI flags > project config > global config > built-in defaults.

---

## 🔒 Privacy & Security

- 🔐 **Local processing** — All data stays on your machine, nothing is uploaded
- 🛡️ **Auto-sanitization** — 18+ patterns cover OpenAI / Anthropic / GitHub / AWS keys, Bearer tokens, DB connection strings, SSH keys, emails, private IPs
- 📏 **Path safety** — Forbidden-directory blocklist (`/etc`, `~/.ssh`), null-byte rejection, symlink guards, 10 MB per-file size limit
- 📦 **Zero telemetry** — No usage data collected

---

## 📄 Interchange Format

MemoBridge uses **Markdown + YAML front matter** as the standard format:

```markdown
---
version: "0.1"
exported_at: "2026-04-23T10:00:00+08:00"
source:
  tool: codebuddy
  extraction_method: file
stats:
  total_memories: 65
  categories: 4
---

# User Profile
## Identity
- Name: Alice

## Communication Preferences
- Concise and direct, minimal explanation needed

# Knowledge
...
```

- 📖 **Human-readable** — Open in any text editor
- 🤖 **LLM-friendly** — Drop it directly into `CLAUDE.md` or `.cursorrules`
- 🔄 **Git-friendly** — Plain text, fully version-trackable
- 🔧 **Extensible** — YAML metadata supports any custom fields

---

## 🗺 Roadmap

| Version | Theme | Status |
|---------|-------|--------|
| **v0.1** | MVP: 8 tools + prompt templates + privacy | ✅ Released |
| **v0.2** | Quality scoring + auto-backup + incremental sync + config | ✅ Released |
| **v0.3** | MCP Server (cross-tool real-time sharing) + three-way merge | 🚧 Planned |
| **v0.4** | Web UI + browser extension (visual ChatGPT/Doubao export) | 📌 Backlog |
| **v1.0** | Cloud backup + team sharing + Tongyi / Zhipu / Windsurf adapters | 📌 Backlog |

---

## 🛠 Development

```bash
git clone https://github.com/gonelake/memo-bridge.git
cd memo-bridge
npm install
npm run dev       # Watch mode
npm run build     # Build
npm run lint      # Type check
npm test          # All tests (539)
npm test -- privacy           # Single test pattern
```

### Adding a new tool adapter

1. `src/extractors/<tool>.ts` — extend `BaseExtractor`, implement `extract()`
2. `src/importers/<tool>.ts` — extend `BaseImporter`, implement `import()`
3. `src/registry/defaults.ts` — register in `registerDefaults()`
4. `src/core/types.ts` — add tool ID to `ToolId` and `TOOL_NAMES`

---

## 🤝 Contributing

Contributions are very welcome!

- 🔌 New tool adapters (Windsurf / Cline / Copilot / Tongyi / Zhipu)
- 🎬 Asciinema demo recording
- 🌐 Internationalization
- 🧪 Additional test cases
- 📖 Documentation improvements

---

## License

[MIT](./LICENSE)

---

<p align="center">
  <b>MemoBridge</b> — Your AI memories shouldn't be held hostage by any tool.<br/>
  <sub><a href="./README.md">中文 README →</a></sub>
</p>
