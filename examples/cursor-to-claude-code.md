# 迁移案例：Cursor → Claude Code

本案例演示如何将 Cursor 中积累的规则和记忆迁移到 Claude Code 的 `CLAUDE.md`。

## 场景描述

用户在 Cursor 中使用了一年，`.cursorrules` 和 `.cursor/rules/` 中积累了大量项目规范和个人偏好。现在想同时使用 Claude Code，希望这些上下文无需重新输入。

## 前提条件

- 已安装 Cursor，且有 `.cursorrules` 或 `.cursor/rules/*.md`
- 已安装 Claude Code（`claude` 命令可用）

---

## 操作步骤

### 第一步：确认 Cursor 记忆存在

```bash
npx memo-bridge detect
```

预期输出：

```
🌉 MemoBridge — 工具检测

  📂 本地工具（直接文件读写）：
     ✅ Cursor       .cursorrules + .cursor/rules/（3 个规则文件）
     ✅ Claude Code  ~/.claude/CLAUDE.md
```

### 第二步：预览提取内容（dry-run）

```bash
npx memo-bridge extract --from cursor --workspace ~/projects/my-app --dry-run
```

预期输出：

```
📤 提取来源：Cursor
   工作区：~/projects/my-app
   找到文件：.cursorrules, .cursor/rules/typescript.md, .cursor/rules/testing.md
   记忆条数：42
   隐私脱敏：0 条
   输出路径：./memo-bridge.md（dry-run，未写入）
```

### 第三步：执行提取

```bash
npx memo-bridge extract --from cursor --workspace ~/projects/my-app
```

生成 `./memo-bridge.md`：

```markdown
---
version: "0.1"
exported_at: "2026-04-23T10:00:00+08:00"
source:
  tool: cursor
  extraction_method: file
stats:
  total_memories: 42
  categories: 3
---

# 用户画像
## 编码偏好
- 使用 TypeScript strict 模式
- 函数式优先，避免 class（除非必要）
- 测试框架：vitest

# 知识积累
## TypeScript
- 类型断言只在边界层使用，内部逻辑依赖推断
- enum 替换为 as const 对象

# 原始记忆
- id: cursor-cursorrules-1
  content: 所有导入路径使用 .js 扩展名（ESM）
  category: coding_standards
  confidence: 0.9
  quality: 0.82
...
```

### 第四步：导入到 Claude Code

```bash
npx memo-bridge import --to claude-code --input ./memo-bridge.md
```

预期输出：

```
📥 导入目标：Claude Code
   自动备份：~/.claude/CLAUDE.md → .memobridge/backups/claude-code-20260423/
   写入：~/.claude/CLAUDE.md（3,241 字符）
   导入条数：42
   跳过条数：0

✅ 导入完成！如需回滚：
   npx memo-bridge backup restore claude-code-20260423
```

---

## 一步完成（等价操作）

```bash
npx memo-bridge migrate --from cursor --to claude-code --workspace ~/projects/my-app
```

---

## 增量同步（后续运行）

首次迁移后，Cursor 中若有新增规则，再次运行时只同步新内容：

```bash
# 提取时指定上次的基线文件
npx memo-bridge extract --from cursor --since ./memo-bridge.md --output ./memo-bridge-new.md

# 导入时跳过已导入内容
npx memo-bridge import --to claude-code --input ./memo-bridge-new.md --mode=incremental
```

---

## 验证结果

```bash
# 查看 Claude Code 的记忆文件
cat ~/.claude/CLAUDE.md
```

你会看到原来 Cursor 中的规则已经以结构化方式写入了 `CLAUDE.md`，Claude Code 在下次对话时会自动加载这些上下文。

---

## 常见问题

**Q：我有多个项目的 Cursor 规则，能一次全部迁移吗？**

```bash
# 扫描 ~/projects 下所有工作区并合并
npx memo-bridge extract --from cursor --scan-dir ~/projects
npx memo-bridge import --to claude-code --input ./memo-bridge.md
```

**Q：迁移后 Claude Code 的原有内容会被覆盖吗？**

会。但迁移前会自动备份，可以随时回滚：

```bash
npx memo-bridge backup list --tool claude-code
npx memo-bridge backup restore <backup-id>
```

**Q：两边都有内容，能合并而不是覆盖吗？**

v0.2 版本暂不支持三路合并（规划在 v0.3）。当前建议先提取 Claude Code 的内容，手动合并 `memo-bridge.md` 后再导入。
