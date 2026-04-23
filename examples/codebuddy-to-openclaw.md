# 迁移案例：CodeBuddy → OpenClaw

本案例演示多工作区场景下，从 CodeBuddy 迁移到 OpenClaw 的完整流程，包括增量同步的使用。

## 场景描述

用户同时维护多个项目，每个项目在 CodeBuddy 中都有独立的 `.codebuddy/automations/*/memory.md`。现在团队迁移到 OpenClaw，需要将所有项目的记忆合并导入。

---

## 前提条件

- 已安装 CodeBuddy，有多个工作区的记忆文件
- 已安装 OpenClaw，`~/.openclaw/workspace/` 已初始化

---

## 操作步骤

### 第一步：检测已有工具和工作区

```bash
npx memo-bridge detect
```

预期输出：

```
🌉 MemoBridge — 工具检测

  📂 本地工具（直接文件读写）：
     ✅ CodeBuddy    ~/.codebuddy/  （5 个工作区）
                    ~/projects/api-server/.codebuddy/
                    ~/projects/frontend/.codebuddy/
                    ~/projects/infra/.codebuddy/
                    ~/projects/shared-lib/.codebuddy/
                    ~/projects/memo-bridge/.codebuddy/

     ✅ OpenClaw     ~/.openclaw/workspace/MEMORY.md
```

### 第二步：提取所有工作区的 CodeBuddy 记忆

```bash
# 扫描 ~/projects 下所有工作区，自动合并去重
npx memo-bridge extract --from codebuddy --scan-dir ~/projects
```

预期输出：

```
📤 提取来源：CodeBuddy
   扫描目录：~/projects
   发现工作区：5 个
   合并记忆：87 条 → 去重后 74 条
   隐私脱敏：3 条（API Key × 2, Token × 1）
   质量评分：平均 0.71
   输出：./memo-bridge.md
```

生成的 `memo-bridge.md` 示例片段：

```markdown
---
version: "0.1"
exported_at: "2026-04-23T10:00:00+08:00"
source:
  tool: codebuddy
  extraction_method: file
stats:
  total_memories: 74
  categories: 5
---

# 用户画像
## 编码偏好
- 使用 pnpm 而非 npm
- Monorepo 结构：pnpm workspace

# 项目上下文
## api-server
- 技术栈：Node.js + Fastify + PostgreSQL
- 部署：Docker + Kubernetes（阿里云 ACK）

## frontend
- 技术栈：React 18 + Vite + TailwindCSS
- 状态管理：Zustand

# 原始记忆
- id: codebuddy-api-server-memory-1
  content: 数据库迁移使用 Prisma，不直接写 SQL
  category: project_context
  source: ~/projects/api-server/.codebuddy/automations/default/memory.md
  confidence: 0.85
  content_hash: a3f2b1c4d5e6
  quality: 0.79
...
```

### 第三步：预览导入到 OpenClaw

```bash
npx memo-bridge import --to openclaw --input ./memo-bridge.md --dry-run
```

预期输出：

```
📥 导入目标：OpenClaw（dry-run）
   将写入：~/.openclaw/workspace/MEMORY.md
   导入条数：74
   跳过条数：0
   预计大小：4,821 字符
   （dry-run 模式，未实际写入）
```

### 第四步：执行导入

```bash
npx memo-bridge import --to openclaw --input ./memo-bridge.md
```

预期输出：

```
📥 导入目标：OpenClaw
   自动备份：~/.openclaw/workspace/MEMORY.md → .memobridge/backups/openclaw-20260423/
   写入：~/.openclaw/workspace/MEMORY.md（4,821 字符）
   导入条数：74
   跳过条数：0

✅ 导入完成！如需回滚：
   npx memo-bridge backup restore openclaw-20260423
```

---

## 一步完成（等价操作）

```bash
npx memo-bridge migrate --from codebuddy --to openclaw --scan-dir ~/projects
```

---

## 增量同步：后续新增记忆同步

几周后 CodeBuddy 中产生了新记忆，使用增量模式只同步新内容：

### 方式一：基于基线文件的增量提取

```bash
# 以上次导出的 memo-bridge.md 为基线
npx memo-bridge extract --from codebuddy \
  --scan-dir ~/projects \
  --since ./memo-bridge.md \
  --output ./memo-bridge-delta.md
```

输出：

```
📤 增量提取（相对基线：./memo-bridge.md）
   当前记忆：81 条
   基线记忆：74 条
   新增/变更：7 条
   输出：./memo-bridge-delta.md
```

```bash
# 导入增量内容（基于 ledger 跳过已导入）
npx memo-bridge import --to openclaw \
  --input ./memo-bridge-delta.md \
  --mode=incremental
```

### 方式二：基于 ledger 的增量导入

如果没有保留上次的基线文件，直接使用 `--mode=incremental`：

```bash
# 完整提取
npx memo-bridge extract --from codebuddy --scan-dir ~/projects

# 导入时自动跳过已导入的 hash
npx memo-bridge import --to openclaw --input ./memo-bridge.md --mode=incremental
```

OpenClaw ledger 位于 `.memobridge/imported/openclaw.hashes`，每次导入后自动追加新记录。

---

## 备份管理

```bash
# 查看所有 OpenClaw 备份
npx memo-bridge backup list --tool openclaw

# 输出：
# ID                          时间                    文件数
# openclaw-20260423T100000    2026-04-23 10:00:00     1
# openclaw-20260415T143022    2026-04-15 14:30:22     1

# 回滚到指定备份
npx memo-bridge backup restore openclaw-20260415T143022
```

---

## 验证结果

```bash
cat ~/.openclaw/workspace/MEMORY.md
```

OpenClaw 会在下次对话时加载这些记忆，你在 CodeBuddy 中积累的项目上下文、偏好和知识将无缝延续到新工具中。

---

## 常见问题

**Q：多个工作区有相同内容，会重复吗？**

不会。`extract` 阶段会按 `content_hash` 去重，相同内容只保留一条。

**Q：OpenClaw 的 MEMORY.md 已经有内容，会被覆盖吗？**

当前版本（v0.2）是覆盖写入，但覆盖前会自动备份。v0.3 计划支持三路合并。

**Q：想只迁移某个特定项目的记忆怎么办？**

指定 `--workspace` 而不是 `--scan-dir`：

```bash
npx memo-bridge migrate --from codebuddy --to openclaw \
  --workspace ~/projects/api-server
```
