<p align="center">
  <h1 align="center">🌉 MemoBridge</h1>
  <p align="center">让你的 AI 记忆自由流动 | Move your AI memories between tools freely</p>
</p>

<p align="center">
  <a href="#why-memobridge--为什么需要-memobridge">Why / 为什么</a> •
  <a href="#installation--安装">Install / 安装</a> •
  <a href="#quick-start--快速开始">Quick Start / 快速开始</a> •
  <a href="#supported-tools--支持工具">Tools / 工具</a> •
  <a href="#commands--命令参考">Commands / 命令</a>
</p>

<p align="center">
  <a href="https://github.com/gonelake/memo-bridge/actions/workflows/ci.yml"><img src="https://github.com/gonelake/memo-bridge/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://www.npmjs.com/package/memo-bridge"><img src="https://img.shields.io/npm/v/memo-bridge.svg" alt="npm version"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/npm/l/memo-bridge.svg" alt="License"></a>
  <img src="https://img.shields.io/node/v/memo-bridge.svg" alt="Node version">
</p>

---

## Why MemoBridge / 为什么需要 MemoBridge？

AI tools accumulate valuable context about you — preferences, project history, coding style, knowledge progress. But this memory is **locked inside each tool**.

AI 工具会积累大量关于你的上下文——偏好、项目历史、编码风格、知识进度。但这些记忆**被锁在每个工具内部**。

- 🔒 Doubao memories can't be exported to Claude Code / 豆包的记忆无法迁移到 Claude Code
- 🔄 Cursor and CodeBuddy memories are completely isolated / Cursor 和 CodeBuddy 的记忆完全隔离
- 💻 New machine = AI knows nothing about you / 换电脑 = AI 对你一无所知
- 🤖 Hermes can't inherit your OpenClaw context / Hermes 无法继承你在 OpenClaw 的记忆

**MemoBridge fixes this.** One command to migrate your AI memories between any supported tools.

**MemoBridge 解决这一切。** 一条命令，让 AI 记忆在任意工具之间自由迁移。

```bash
npx memo-bridge migrate --from codebuddy --to claude-code
```

---

## Features / 核心特性

- 🔍 **Auto-detect / 自动检测** — Scans your system for installed AI tools / 扫描系统发现所有已安装的 AI 工具
- 📤 **One-click export / 一键导出** — Extract memories into a standard format / 从任意工具提取记忆，输出标准格式
- 📥 **Smart import / 智能导入** — Auto-adapts to target format (including Hermes' 2200-char limit) / 自动适配目标格式
- 📋 **Prompt templates / 提示词模板** — Optimal prompts for tools without direct export / 为不支持导出的工具提供引导提示词
- 🔐 **Privacy sanitization / 隐私脱敏** — Auto-redacts API keys, passwords, tokens (15 patterns) / 自动脱敏敏感信息
- 📁 **Multi-workspace / 多工作区** — Scans all workspaces, merges and deduplicates / 自动扫描所有工作区，合并去重
- 🇨🇳 **China AI tools / 国内工具** — First tool supporting Doubao, Kimi, Tongyi / 首个覆盖豆包、Kimi、通义千问的迁移工具

---

## Installation / 安装

```bash
# Zero-install / 无需安装，直接使用
npx memo-bridge

# Or install globally / 或全局安装
npm install -g memo-bridge
```

**Requirements / 环境要求**：Node.js >= 22.0.0

---

## Quick Start / 快速开始

### 1. Detect installed tools / 检测已安装的 AI 工具

```bash
npx memo-bridge detect
```

Output / 输出示例：

```
🌉 MemoBridge — Tool Detection

  📂 Local tools:
     ● CodeBuddy    ~/.codebuddy/
     ● Claude Code  ~/.claude/
     ● Cursor       ~/.cursor/

  ☁️  Cloud tools (prompt-guided):
     ● ChatGPT
     ● Doubao (豆包)
     ● Kimi
```

### 2. Export memories / 导出记忆

```bash
# From CodeBuddy (auto-scans all workspaces)
# 从 CodeBuddy 导出（自动扫描所有工作区）
npx memo-bridge extract --from codebuddy

# Specify a single workspace / 指定单个工作区
npx memo-bridge extract --from codebuddy --workspace ~/projects/my-app

# Specify scan root / 指定扫描根目录
npx memo-bridge extract --from codebuddy --scan-dir ~/projects

# From OpenClaw / Claude Code
npx memo-bridge extract --from openclaw
npx memo-bridge extract --from claude-code
```

### 3. Import memories / 导入记忆

```bash
# To Claude Code (writes CLAUDE.md)
npx memo-bridge import --to claude-code --input ./memo-bridge.md

# To Hermes Agent (auto-trims to 2200 chars / 自动裁剪到 2200 字符)
npx memo-bridge import --to hermes --input ./memo-bridge.md

# To Cursor (writes .cursorrules)
npx memo-bridge import --to cursor --input ./memo-bridge.md --workspace ~/projects/my-app

# To Doubao / 导入到豆包 (generates instructions / 生成"请记住"指令)
npx memo-bridge import --to doubao --input ./memo-bridge.md

# Dry-run / 预览模式
npx memo-bridge import --to hermes --input ./memo-bridge.md --dry-run
```

### 4. One-step migration / 一键迁移

```bash
npx memo-bridge migrate --from codebuddy --to claude-code
npx memo-bridge migrate --from openclaw --to hermes
npx memo-bridge migrate --from codebuddy --to cursor --workspace ~/projects/my-app
```

### 5. Get export prompts / 获取导出提示词

For tools without direct export / 对于不支持直接导出的工具：

```bash
npx memo-bridge prompt --for doubao
npx memo-bridge prompt --for kimi
npx memo-bridge prompt --for chatgpt
```

Copy the prompt into the AI tool's chat / 将提示词复制到对应工具的对话中发送。

---

## Supported Tools / 支持工具

### Local tools (direct file access) / 本地工具（文件直读）

| Tool / 工具 | Export / 导出 | Import / 导入 | Memory Path / 记忆路径 |
|------|--------|--------|-------------|
| **CodeBuddy** | ✅ | ✅ | `.codebuddy/automations/*/memory.md` + `.memory/*.md` |
| **OpenClaw** | ✅ | ✅ | `~/.openclaw/workspace/MEMORY.md` + `memory/` |
| **Hermes Agent** | ✅ | ✅ | `~/.hermes/memories/MEMORY.md` + `USER.md` |
| **Claude Code** | ✅ | ✅ | `CLAUDE.md` + `~/.claude/CLAUDE.md` |
| **Cursor** | ✅ | ✅ | `.cursorrules` + `.cursor/rules/*.md` |

### Cloud tools (prompt-guided) / 云端工具（Prompt 引导）

| Tool / 工具 | Export / 导出 | Import / 导入 |
|------|--------|--------|
| **ChatGPT** | Prompt-guided | "Please remember..." instructions |
| **Doubao / 豆包** | Prompt 引导 | "请记住..." 指令 |
| **Kimi** | Prompt 引导 | Context injection text / 上下文注入 |

---

## Commands / 命令参考

### `detect`

Detect installed AI tools / 检测已安装的 AI 工具

```bash
memo-bridge detect
```

### `extract`

Export memories / 导出记忆

```bash
memo-bridge extract --from <tool> [options]

Options / 选项:
  -f, --from <tool>       Source tool (required) / 来源工具（必填）
  -w, --workspace <path>  Single workspace path / 指定单个工作区路径
  -s, --scan-dir <path>   Scan root directory / 指定扫描根目录
  -o, --output <path>     Output file (default: ./memo-bridge.md) / 输出文件路径
  -v, --verbose           Verbose output / 详细输出
```

### `import`

Import memories / 导入记忆

```bash
memo-bridge import --to <tool> --input <file> [options]

Options / 选项:
  -t, --to <tool>          Target tool (required) / 目标工具（必填）
  -i, --input <file>       Input file / 输入文件路径
  -w, --workspace <path>   Target workspace / 目标工作区路径
  --dry-run                Preview mode / 预览模式，不实际写入
```

### `migrate`

One-step migration / 一键迁移

```bash
memo-bridge migrate --from <tool> --to <tool> [options]

Options / 选项:
  -f, --from <tool>        Source tool / 来源工具
  -t, --to <tool>          Target tool / 目标工具
  -w, --workspace <path>   Workspace path / 工作区路径
```

### `prompt`

Get export prompt / 获取导出提示词

```bash
memo-bridge prompt --for <tool>
```

---

## Intermediate Format / 中间格式

MemoBridge uses **Markdown + YAML front matter** as the standard interchange format.

MemoBridge 使用 **Markdown + YAML front matter** 作为标准中间格式。

- 📖 **Human-readable / 人类可读** — Open with any text editor / 任何编辑器可读
- 🤖 **LLM-friendly / LLM 友好** — Can be used directly as CLAUDE.md / 可直接当 CLAUDE.md 用
- 🔄 **Git-friendly / Git 友好** — Plain text, version-trackable / 纯文本可版本管理
- 🔧 **Extensible / 可扩展** — YAML metadata supports custom fields / 支持自定义字段

```markdown
---
version: "0.1"
exported_at: "2026-04-20T20:00:00+08:00"
source:
  tool: codebuddy
  extraction_method: file
stats:
  total_memories: 65
  categories: 4
---

# MemoBridge Export

## User Profile
...

## Knowledge
...
```

---

## Privacy & Security / 隐私与安全

- 🔐 **Local processing / 本地处理** — All data processed locally, nothing uploaded / 不上传任何数据
- 🛡️ **Auto-sanitization / 自动脱敏** — Detects and redacts 15 types of sensitive info / 检测 15 种敏感信息
- 👁️ **Transparent / 透明可审** — Output is plain text, fully auditable / 纯文本可审查
- 📦 **Zero telemetry / 零遥测** — No usage data collected / 不收集使用数据

---

## Common Migration Scenarios / 常见迁移场景

```bash
# CodeBuddy → Claude Code
npx memo-bridge migrate --from codebuddy --to claude-code

# OpenClaw → Hermes Agent
npx memo-bridge migrate --from openclaw --to hermes

# Doubao → Cursor / 豆包 → Cursor
npx memo-bridge prompt --for doubao          # Step 1: Get prompt / 获取提示词
# Step 2: Send prompt in Doubao, copy response / 在豆包中发送提示词，复制回答
npx memo-bridge import --to cursor --input ./doubao-export.md  # Step 3: Import / 导入
```

---

## Development / 开发

```bash
git clone https://github.com/gonelake/memo-bridge.git
cd memo-bridge
npm install
npm run dev       # Watch mode / 开发模式
npm run build     # Build / 构建
npm run lint      # Type check / 类型检查
npm test          # Test / 测试
```

### Adding a new tool adapter / 添加新工具适配器

1. Create extractor in `src/extractors/`, extending `BaseExtractor` / 创建提取器
2. Create importer in `src/importers/`, extending `BaseImporter` / 创建导入器
3. Register in `src/cli.ts` (`getExtractor()` / `getImporter()`) / 注册到 CLI
4. Add tool ID in `src/core/types.ts` (`ToolId` / `TOOL_NAMES`) / 添加工具标识

---

## Roadmap / 路线图

- [x] **v0.1** — MVP: 8 tools + Prompt templates + Privacy sanitization
- [ ] **v0.2** — Coze API + Memory quality assessment + Incremental updates
- [ ] **v0.3** — MCP Server (cross-tool real-time memory sharing)
- [ ] **v0.4** — Web UI + Browser extension (ChatGPT/Doubao visual export)
- [ ] **v1.0** — Cloud backup + Team sharing + Tongyi/Zhipu/Windsurf adapters

---

## Contributing / 贡献

Contributions welcome! / 欢迎贡献！

- 🔌 New tool adapters / 新工具适配器 (Windsurf / Cline / Copilot / Tongyi / Zhipu)
- 🌐 Internationalization / 国际化
- 🧪 Test cases / 测试用例
- 📖 Documentation / 文档改进

---

## License / 许可证

[MIT](./LICENSE)

---

<p align="center">
  <b>MemoBridge</b> — Your AI memories shouldn't be held hostage by any tool.<br/>
  你的 AI 记忆，不该被任何工具绑架。
</p>
