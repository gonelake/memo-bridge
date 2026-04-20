<p align="center">
  <h1 align="center">🌉 MemoBridge</h1>
  <p align="center">让你的 AI 记忆自由流动 | Move your AI memories between tools freely</p>
</p>

<p align="center">
  <a href="#安装">安装</a> •
  <a href="#快速开始">快速开始</a> •
  <a href="#支持工具">支持工具</a> •
  <a href="#命令参考">命令参考</a> •
  <a href="./README.en.md">English</a>
</p>

---

## 为什么需要 MemoBridge？

你是否遇到过这些问题：

- 🔒 在豆包积累了半年的对话偏好，想迁移到 Claude Code？—— **做不到**
- 🔄 同时用 Cursor 和 CodeBuddy，两边记忆完全隔离？—— **很痛苦**
- 💻 换了新电脑，AI 助手对你一无所知？—— **从零开始**
- 🤖 想让 Hermes Agent 继承你在 OpenClaw 中的记忆？—— **手动搬运**

**MemoBridge 解决这一切。** 一条命令，让你的 AI 记忆在任意工具之间自由迁移。

```bash
# 从 CodeBuddy 导出记忆，导入到 Claude Code
npx memo-bridge migrate --from codebuddy --to claude-code
```

## 核心特性

- 🔍 **自动检测** — 扫描你的系统，发现所有已安装的 AI 工具
- 📤 **一键导出** — 从任意支持的工具中提取记忆，输出标准格式
- 📥 **智能导入** — 自动适配目标工具的格式要求（包括 Hermes 的 2200 字符限制）
- 📋 **Prompt 模板** — 为不支持直接导出的工具（豆包/Kimi/ChatGPT）提供最优引导提示词
- 🔐 **隐私脱敏** — 自动检测并脱敏 API Key、密码、Token 等 10 种敏感信息
- 📁 **多工作区汇集** — 自动扫描所有工作区，合并去重后统一导出
- 🇨🇳 **国内工具适配** — 首个覆盖豆包、Kimi、通义千问的记忆迁移工具

## 安装

```bash
# 无需安装，直接使用
npx memo-bridge

# 或全局安装
npm install -g memo-bridge
```

**环境要求**：Node.js >= 22.0.0

## 快速开始

### 1. 检测已安装的 AI 工具

```bash
npx memo-bridge detect
```

输出示例：

```
🌉 MemoBridge — 检测 AI 工具

已检测到的工具:
  ✅ CodeBuddy    ~/.codebuddy/
  ✅ Claude Code  ~/.claude/
  ✅ Cursor       ~/.cursor/
  ⚡ ChatGPT     需要 Prompt 引导导出
  ⚡ 豆包         需要 Prompt 引导导出
  ⚡ Kimi         需要 Prompt 引导导出
```

### 2. 导出记忆

```bash
# 从 CodeBuddy 导出（自动扫描所有工作区）
npx memo-bridge extract --from codebuddy

# 指定单个工作区
npx memo-bridge extract --from codebuddy --workspace ~/projects/my-app

# 指定扫描根目录
npx memo-bridge extract --from codebuddy --scan-dir ~/projects

# 从 OpenClaw 导出
npx memo-bridge extract --from openclaw

# 从 Claude Code 导出
npx memo-bridge extract --from claude-code
```

导出结果为标准的 `memo-bridge.md` 文件，包含结构化的记忆数据。

### 3. 导入记忆

```bash
# 导入到 Claude Code（写入 CLAUDE.md）
npx memo-bridge import --to claude-code --input ./memo-bridge.md

# 导入到 Hermes Agent（自动裁剪到 2200 字符）
npx memo-bridge import --to hermes --input ./memo-bridge.md

# 导入到 Cursor（写入 .cursorrules）
npx memo-bridge import --to cursor --input ./memo-bridge.md --workspace ~/projects/my-app

# 导入到豆包（生成"请记住"指令）
npx memo-bridge import --to doubao --input ./memo-bridge.md

# 预览模式（不实际写入）
npx memo-bridge import --to hermes --input ./memo-bridge.md --dry-run
```

### 4. 一键迁移

```bash
# CodeBuddy → Claude Code
npx memo-bridge migrate --from codebuddy --to claude-code

# OpenClaw → Hermes
npx memo-bridge migrate --from openclaw --to hermes

# CodeBuddy → Cursor
npx memo-bridge migrate --from codebuddy --to cursor --workspace ~/projects/my-app
```

### 5. 获取导出提示词

对于不支持直接导出的工具，获取最优的引导提示词：

```bash
# 获取豆包的导出提示词
npx memo-bridge prompt --for doubao

# 获取 Kimi 的导出提示词
npx memo-bridge prompt --for kimi

# 获取 ChatGPT 的导出提示词
npx memo-bridge prompt --for chatgpt
```

将提示词复制到对应工具的对话中发送，AI 会列出它记住的所有内容。

## 支持工具

### 本地工具（文件直读）

| 工具 | 导出 | 导入 | 记忆路径 |
|------|------|------|---------|
| **CodeBuddy** | ✅ | ✅ | `.codebuddy/automations/*/memory.md` + `.memory/*.md` |
| **OpenClaw** | ✅ | ✅ | `~/.openclaw/workspace/MEMORY.md` + `memory/` |
| **Hermes Agent** | ✅ | ✅ | `~/.hermes/memories/MEMORY.md` + `USER.md` |
| **Claude Code** | ✅ | ✅ | `CLAUDE.md` + `~/.claude/CLAUDE.md` |
| **Cursor** | ✅ | ✅ | `.cursorrules` + `.cursor/rules/*.md` |

### 云端工具（Prompt 引导）

| 工具 | 导出方式 | 导入方式 |
|------|---------|---------|
| **ChatGPT** | Prompt 引导 AI 口述记忆 | 生成"Please remember..."指令 |
| **豆包** | Prompt 引导 AI 口述记忆 | 生成"请记住..."指令 |
| **Kimi** | Prompt 引导 AI 口述记忆 | 生成上下文注入文本 |

## 命令参考

### `detect` — 检测已安装的 AI 工具

```bash
memo-bridge detect
```

### `extract` — 导出记忆

```bash
memo-bridge extract --from <tool> [options]

选项:
  -f, --from <tool>       来源工具 (必填)
  -w, --workspace <path>  指定单个工作区路径
  -s, --scan-dir <path>   指定扫描根目录
  -o, --output <path>     输出文件路径 (默认: ./memo-bridge.md)
  -v, --verbose           详细输出
```

### `import` — 导入记忆

```bash
memo-bridge import --to <tool> --input <file> [options]

选项:
  -t, --to <tool>          目标工具 (必填)
  -i, --input <file>       输入文件路径 (默认: ./memo-bridge.md)
  -w, --workspace <path>   目标工作区路径
  --dry-run                预览模式，不实际写入
```

### `migrate` — 一键迁移

```bash
memo-bridge migrate --from <tool> --to <tool> [options]

选项:
  -f, --from <tool>        来源工具 (必填)
  -t, --to <tool>          目标工具 (必填)
  -w, --workspace <path>   工作区路径
```

### `prompt` — 获取导出提示词

```bash
memo-bridge prompt --for <tool>

选项:
  --for <tool>  目标工具 (必填)
```

## 中间格式 (memo-bridge.md)

MemoBridge 使用 **Markdown + YAML front matter** 作为标准中间格式，确保：

- 📖 **人类可读** — 用任何文本编辑器打开即可阅读
- 🤖 **LLM 友好** — 可直接作为 CLAUDE.md 或 .cursorrules 使用
- 🔄 **Git 友好** — 纯文本，可版本管理记忆的变化历史
- 🔧 **可扩展** — YAML 元数据支持自定义字段

示例结构：

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

## Projects
...
```

## 隐私与安全

- 🔐 **本地处理** — 所有数据在本地处理，不上传到任何服务器
- 🛡️ **自动脱敏** — 检测并脱敏 API Key、密码、Token、私钥等 10 种敏感信息
- 👁️ **透明可审** — 导出的 memo-bridge.md 是纯文本，你可以在分享前审查所有内容
- 📦 **零遥测** — 不收集任何使用数据

## 常见迁移场景

### CodeBuddy → Claude Code

```bash
npx memo-bridge migrate --from codebuddy --to claude-code
# 自动扫描所有 CodeBuddy 工作区 → 合并去重 → 写入 CLAUDE.md
```

### OpenClaw → Hermes Agent

```bash
npx memo-bridge migrate --from openclaw --to hermes
# 提取 MEMORY.md + 每日笔记 → 智能裁剪到 2200 字符 → 写入 ~/.hermes/memories/
```

### 豆包 → Cursor

```bash
# Step 1: 获取导出提示词
npx memo-bridge prompt --for doubao
# Step 2: 在豆包对话中发送提示词，复制 AI 的回答
# Step 3: 将回答保存为文件，然后导入
npx memo-bridge import --to cursor --input ./doubao-export.md
```

## 开发

```bash
# 克隆项目
git clone https://github.com/gonelake/memo-bridge.git
cd memo-bridge

# 安装依赖
npm install

# 开发模式
npm run dev

# 构建
npm run build

# 类型检查
npm run lint

# 测试
npm test
```

### 添加新工具适配器

1. 在 `src/extractors/` 中创建提取器，继承 `BaseExtractor`
2. 在 `src/importers/` 中创建导入器，继承 `BaseImporter`
3. 在 `src/cli.ts` 的 `getExtractor()` 和 `getImporter()` 中注册
4. 在 `src/core/types.ts` 的 `ToolId` 和 `TOOL_NAMES` 中添加工具标识

详见 [适配器开发指南](./docs/adapter-guide.md)。

## 路线图

- [x] **v0.1** — MVP：8 工具互迁 + Prompt 模板 + 隐私脱敏
- [ ] **v0.2** — Coze/扣子 API 集成 + 记忆质量评估 + 增量更新
- [ ] **v0.3** — MCP Server 模式（跨工具实时记忆共享）
- [ ] **v0.4** — Web UI + 浏览器插件（ChatGPT/豆包记忆可视化导出）
- [ ] **v1.0** — 云备份 + 团队记忆共享 + 通义千问/智谱/Windsurf 适配

## 贡献

欢迎贡献！特别是以下方向：

- 🔌 新工具适配器（Windsurf / Cline / Copilot / 通义千问 / 智谱清言等）
- 🌐 国际化（更多语言的 Prompt 模板）
- 🧪 测试用例
- 📖 文档改进

## 许可证

[MIT](./LICENSE)

---

<p align="center">
  <b>MemoBridge</b> — 你的 AI 记忆，不该被任何工具绑架。
</p>
