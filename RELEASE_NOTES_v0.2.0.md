# v0.2.0 "可信" — 把迁移工具从"能用"推到"敢用"

> 本文件仅作为 v0.2.0 发布存档。拷贝此内容到 GitHub Release 页面：
> https://github.com/gonelake/memo-bridge/releases/new?tag=v0.2.0

---

## 🎯 主题

v0.1 实现了 **"能搬"** — 8 个 AI 工具之间的记忆迁移能跑通。
v0.2 实现了 **"敢用"** — 记忆带质量评分、导入前自动备份、一键回滚、增量同步不重复、配置文件定制、扩展字段闭环回写，并通过完整的安全审计。

---

## ✨ 新特性

### 质量评估（M2）
每条导出的记忆现在都带有质量信号，下游工具可据此裁剪 / 排序：
- `content_hash` — SHA-256 前 12 位，内容规范化后计算，用于增量同步身份
- `importance` — 类别权重 + 中英双语关键词（"决定 / 永远 / always / must"）+ 内容长度
- `freshness` — 基于 updated_at 的分段衰减（30/90/365 天）
- `quality` — `0.5·I + 0.3·F + 0.2·C` 加权合成
- 全部纯规则启发式，**零新增依赖**，不引入 embedding / LLM / 网络

### 备份与回滚（M3）
- 每次 `import` / `migrate` 自动快照目标文件到 `.memobridge/backups/<tool>-<ts>/`
- `memo-bridge backup list [--tool X]` 列出历史
- `memo-bridge backup restore <id>` 一键恢复
- 快照通过 `Importer.listTargets()` 声明式获取，覆盖**包括将要新建的文件**（回滚时删除）
- 保留策略由 `.memobridge.yaml` 的 `backup.retention` 控制

### 增量同步（M4）
- `extract --since <previous.md>`：只输出相对上次导出新增/变更的记忆
- `import --mode=incremental`：用每工具 ledger（`.memobridge/imported/<tool>.hashes`）反向过滤，反复跑不重复导入
- Ledger 使用 **O_APPEND 原子追加**，并发写安全
- v0.2 暂不做删除传播和三路合并（留 v0.3）

### 配置文件（M6）
- 项目级 `.memobridge.yaml`（git 式 walk-upward 发现）+ 全局 `~/.config/memobridge/config.yaml`
- 优先级：CLI flag > project > global > default
- 字段：`default_workspace` / `privacy.extra_patterns` / `quality.importance_keywords` / `backup.retention`
- 列表字段走 union + dedupe（团队 + 个人两级配置不需要互相重复）

### Extensions 回写闭环（M5）
- Hermes `skills/` 目录：同工具回环时创建占位目录 + README stub 说明"只恢复了目录名"
- OpenClaw SOUL.md：完整回写（extraction 最多保留 500 字符，这个部分在 v0.2 可完整 round-trip）
- OpenClaw DREAMS.md：**诚实降级** — 中间格式只保留 chars 元数据，回写为带说明的 stub 文件，而非伪造内容
- 跨工具 skills 互转（Claude Skills ↔ Hermes ↔ Cursor）是 v0.3 范围

---

## 🛡️ 安全加固

发布前经过系统 review，修复 **3 个 P0 安全问题 + 1 个 P0 bug + 4 个 P1 问题**：

| 级别 | 问题 | 修复 commit |
|---|---|---|
| P0 安全 | `config.default_workspace` 路径劫持（可写入 `~/.ssh`、`/etc`） | `2b84917` |
| P0 安全 | 用户正则 ReDoS 让 CLI 假死（`(a+)+b` 卡死 55s+） | `0b91bc5` |
| P0 安全 | `backup` 跟随 symlink 可泄露 `/etc/passwd` 到备份目录 | `c3955d9` |
| P0 bug | `scoreMemories` 覆盖已有 hash，full↔incremental ledger 对不上 | `58e0116` |
| P1 | `recordImported` 并发写丢数据（改 O_APPEND） | `3f094ea` |
| P1 | `claude-code` overwrite 分支漏 content size 校验 | `5f2a861` |
| P1 | `diffMemories` 对 current 内部同 hash 不去重 | `aa15f1f` |
| P1 | Hermes skill 名过滤不够严（null byte / 换行 / 过长） | `d9246f1` |

额外守门：`.memobridge/` 已加入 `.gitignore`，避免备份路径 / ledger 泄漏本机信息到远端。

---

## 📊 数据

- **测试**：395 (v0.1) → **539 (v0.2)**，19 个 test file 全绿
- **新依赖**：0
- **Schema**：`FORMAT_VERSION` 保持 `"0.1"`，v0.1 文件可直接被 v0.2 parse
- **代码**：新增 `src/core/{quality,backup,diff,config}.ts` 4 个模块

---

## 🔄 向后兼容

**完全向后兼容**：
- v0.1 导出文件（无 hash / importance / origin 字段）可被 v0.2 正常 parse
- v0.1 格式的 `source` 字段是字符串时会自动归一化为对象（修复 "from undefined" cosmetic bug）
- 老配置文件如存在缺失字段，回落到默认值
- `Importer` 接口新增的 `listTargets()` 是可选方法，自定义 Importer 不实现也能跑（只是不会有 backup 保护）

---

## 📦 升级

```bash
npm install memo-bridge@0.2.0
# 或 npx memo-bridge@0.2.0 --version
```

### 升级后的建议步骤

1. 如果你在 workspace 里用 MemoBridge，把 `.memobridge/` 加到 `.gitignore`
2. 如需定制脱敏规则 / 关键词，创建 `.memobridge.yaml`（查看 README 示例）
3. 下次 `import` 会自动创建备份，用 `memo-bridge backup list` 查看

---

## 🗺️ v0.3 预告

刻意留给下一版的功能：
- **MCP Server** — 跨工具实时共享（长远会让 CLI 迁移变次要）
- **跨工具 Skills 互转** — Hermes skills ↔ CodeBuddy automations ↔ Claude Skills
- **删除传播 + 三路合并** — diff 已统计 `deleted` 数，v0.3 让用户 opt-in 执行
- **语义去重** — 当前是 hash 完全相等；embedding 方案作为可选依赖

Review 遗留的小技术债（P1-5 TOCTOU / P2-*）也一并进 v0.3。

---

## 🙏 致谢

这一版由 Agent 团队协作完成：设计、实现、审查、修复、独立验证、文档全流程。
修复阶段的"review → 并行修复 → 独立攻击视角验证"三段式值得推荐给其他项目。

---

**Full changelog**: https://github.com/gonelake/memo-bridge/compare/df31788...v0.2.0
