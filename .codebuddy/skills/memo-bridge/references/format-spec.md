# memo-bridge.md Format Specification v0.1

## Overview

The `memo-bridge.md` format is the standard interchange format for AI memory migration. It uses Markdown with YAML front matter to store structured memory data in a human-readable, LLM-friendly format.

## Structure

```
---
(YAML front matter: metadata)
---

# 用户画像
## 身份
## 沟通偏好
## 工作模式

---

# 知识积累
## Section Title (count)
| # | 主题 | 日期 | 掌握度 |

---

# 项目上下文
## Project Name (status)

---

# 关注的信息流

---

# 原始记忆
```

## YAML Front Matter

```yaml
version: "0.1"
exported_at: "2026-04-20T20:00:00+08:00"  # ISO 8601
source:
  tool: codebuddy          # ToolId
  tool_version: "0.1.0"    # optional
  workspace: "/path"        # optional
  extraction_method: file   # file | api | prompt_guided | chat_reverse
owner:                      # optional
  id: "user-id"
  locale: "zh-CN"
  timezone: "Asia/Shanghai"
stats:
  total_memories: 65
  categories: 4
  earliest: "2026-03-24"
  latest: "2026-04-20"
```

## Supported ToolId Values

- `codebuddy` — CodeBuddy IDE
- `openclaw` — OpenClaw
- `hermes` — Hermes Agent
- `claude-code` — Claude Code
- `cursor` — Cursor IDE
- `chatgpt` — ChatGPT
- `doubao` — 豆包 (Doubao)
- `kimi` — Kimi

## Sections

### User Profile (用户画像)

Key-value pairs organized into three sub-sections:
- **身份 / Identity**: name, role, location, interests
- **沟通偏好 / Preferences**: output style, language, tools
- **工作模式 / Work Patterns**: daily routines, schedules

Format: `- key：value` (Chinese colon) or `- key: value`

### Knowledge (知识积累)

Organized into sections with Markdown tables:
- H2 header with optional count: `## AI 基础知识（19条）`
- Table: `| # | 主题 | 日期 | 掌握度 |`
- Mastery values: `learned` / `reviewed` / `mastered`

### Projects (项目上下文)

- H2 header with status: `## Project Name（进行中）`
- Bullet points for key insights
- Status values: `进行中`/`active`, `已完成`/`completed`, `暂停`/`paused`

### Information Feeds (关注的信息流)

- Pipe-separated: `- Feed Name | schedule | issue_count`

### Raw Memories (原始记忆)

- HTML comment metadata: `<!-- source: file.md | confidence: 0.85 | 2026-04-20 -->`
- Content: `- memory content text`
- Confidence: 0.0 to 1.0
