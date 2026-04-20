<p align="center">
  <h1 align="center">🌉 MemoBridge</h1>
  <p align="center">Move your AI memories between tools freely</p>
</p>

<p align="center">
  <a href="#installation">Installation</a> •
  <a href="#quick-start">Quick Start</a> •
  <a href="#supported-tools">Supported Tools</a> •
  <a href="#commands">Commands</a> •
  <a href="./README.md">中文</a>
</p>

---

## Why MemoBridge?

AI tools accumulate valuable context about you — your preferences, project history, coding style, knowledge progress. But this memory is **locked inside each tool**:

- ChatGPT memories can't be exported
- Claude Code's `CLAUDE.md` won't help Cursor
- 豆包 (Doubao) has zero export capability
- Switching tools means **starting from zero**

**MemoBridge fixes this.** One command to migrate your AI memories between any supported tools.

```bash
# Migrate memories from CodeBuddy to Claude Code
npx memo-bridge migrate --from codebuddy --to claude-code
```

## Features

- 🔍 **Auto-detect** — Scans your system for installed AI tools
- 📤 **One-click export** — Extract memories from any supported tool into a standard format
- 📥 **Smart import** — Auto-adapts to target tool's format (including Hermes' 2200-char limit)
- 📋 **Prompt templates** — Optimal extraction prompts for tools that don't support direct export
- 🔐 **Privacy sanitization** — Auto-detects and redacts API keys, passwords, tokens (10 patterns)
- 📁 **Multi-workspace** — Scans all workspaces, merges and deduplicates
- 🇨🇳 **China AI tools** — First migration tool supporting Doubao, Kimi, Tongyi Qianwen

## Installation

```bash
# Zero-install usage
npx memo-bridge

# Or install globally
npm install -g memo-bridge
```

**Requirements**: Node.js >= 22.0.0

## Quick Start

### 1. Detect installed tools

```bash
npx memo-bridge detect
```

### 2. Export memories

```bash
# From CodeBuddy (auto-scans all workspaces)
npx memo-bridge extract --from codebuddy

# From OpenClaw
npx memo-bridge extract --from openclaw

# From Claude Code
npx memo-bridge extract --from claude-code
```

### 3. Import memories

```bash
# To Claude Code (writes CLAUDE.md)
npx memo-bridge import --to claude-code --input ./memo-bridge.md

# To Hermes Agent (auto-trims to 2200 chars)
npx memo-bridge import --to hermes --input ./memo-bridge.md

# To Doubao (generates "please remember" instructions)
npx memo-bridge import --to doubao --input ./memo-bridge.md

# Dry-run (preview without writing)
npx memo-bridge import --to hermes --input ./memo-bridge.md --dry-run
```

### 4. One-step migration

```bash
npx memo-bridge migrate --from codebuddy --to claude-code
npx memo-bridge migrate --from openclaw --to hermes
```

### 5. Get export prompts

For tools that don't support direct export:

```bash
npx memo-bridge prompt --for doubao
npx memo-bridge prompt --for kimi
npx memo-bridge prompt --for chatgpt
```

## Supported Tools

### Local tools (direct file access)

| Tool | Export | Import | Memory Path |
|------|--------|--------|-------------|
| **CodeBuddy** | ✅ | ✅ | `.codebuddy/automations/*/memory.md` + `.memory/*.md` |
| **OpenClaw** | ✅ | ✅ | `~/.openclaw/workspace/MEMORY.md` + `memory/` |
| **Hermes Agent** | ✅ | ✅ | `~/.hermes/memories/MEMORY.md` + `USER.md` |
| **Claude Code** | ✅ | ✅ | `CLAUDE.md` + `~/.claude/CLAUDE.md` |
| **Cursor** | ✅ | ✅ | `.cursorrules` + `.cursor/rules/*.md` |

### Cloud tools (prompt-guided)

| Tool | Export | Import |
|------|--------|--------|
| **ChatGPT** | Prompt-guided | "Please remember..." instructions |
| **Doubao** | Prompt-guided | "请记住..." instructions |
| **Kimi** | Prompt-guided | Context injection text |

## Intermediate Format

MemoBridge uses **Markdown + YAML front matter** as the standard interchange format:

- 📖 **Human-readable** — Open with any text editor
- 🤖 **LLM-friendly** — Can be used directly as CLAUDE.md or .cursorrules
- 🔄 **Git-friendly** — Plain text, version-trackable
- 🔧 **Extensible** — YAML metadata supports custom fields

## Privacy & Security

- 🔐 **Local processing** — All data processed locally, nothing uploaded
- 🛡️ **Auto-sanitization** — Detects and redacts 10 types of sensitive information
- 👁️ **Transparent** — Output is plain text, fully auditable before sharing
- 📦 **Zero telemetry** — No usage data collected

## Commands

| Command | Description |
|---------|-------------|
| `detect` | Detect installed AI tools |
| `extract --from <tool>` | Export memories from a tool |
| `import --to <tool> --input <file>` | Import memories into a tool |
| `migrate --from <tool> --to <tool>` | One-step migration |
| `prompt --for <tool>` | Get export prompt for a tool |

## Contributing

Contributions welcome! Especially:

- 🔌 New tool adapters (Windsurf / Cline / Copilot / etc.)
- 🌐 Internationalization
- 🧪 Test cases
- 📖 Documentation

## License

[MIT](./LICENSE)

---

<p align="center">
  <b>MemoBridge</b> — Your AI memories shouldn't be held hostage by any tool.
</p>
