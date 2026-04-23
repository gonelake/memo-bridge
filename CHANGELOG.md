# Changelog

所有重要变更记录在此文件中，格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，版本号遵循 [Semantic Versioning](https://semver.org/)。

---

## [0.2.0] — 2026-04-23 "可信"

> 主题：从"能搬"到"敢用"——质量评分、自动备份、增量同步、配置文件，并通过完整安全审计。

### 新增

**质量评估**
- `content_hash`：每条记忆附带 SHA-256 前 12 位哈希，作为增量同步的内容寻址身份键
- `importance`：基于关键词权重（中英双语）+ 内容长度的启发式重要性评分（0–1）
- `freshness`：基于 `updated_at` 的分段时间衰减评分（30/90/365 天梯度）
- `quality`：`0.5·importance + 0.3·freshness + 0.2·confidence` 加权合成质量分

**备份与回滚**
- `import` / `migrate` 前自动快照目标文件到 `.memobridge/backups/<tool>-<timestamp>/`
- 新增命令 `backup list [--tool <tool>]`：列出历史备份
- 新增命令 `backup restore <id>`：一键恢复指定备份
- `Importer.listTargets()` 接口：适配器声明式声明写入目标，支持"将要新建的文件"也能回滚

**增量同步**
- `extract --since <prev.md>`：只导出相对上次基线新增/变更的记忆
- `import --mode=incremental`：基于每工具 ledger（`.memobridge/imported/<tool>.hashes`）过滤已导入内容，反复运行不重复
- Ledger 使用 O_APPEND 原子追加，并发写安全

**配置文件**
- 支持项目级 `.memobridge.yaml`（git 式 walk-upward 发现）
- 支持全局 `~/.config/memobridge/config.yaml`
- 优先级：CLI 参数 > 项目配置 > 全局配置 > 内置默认值
- 列表字段 union + dedupe（团队/个人两级配置不需互相重复）

**Extensions 回写闭环**
- Hermes `skills/` 目录：同工具回环时恢复占位目录 + README stub
- OpenClaw `SOUL.md`：完整 round-trip（提取最多 500 字符）
- OpenClaw `DREAMS.md`：诚实降级，回写带说明的 stub（不伪造内容）

### 安全修复

| 级别 | 问题描述 | 修复 |
|------|----------|------|
| P0 | `config.default_workspace` 路径劫持（可写入 `~/.ssh`、`/etc`） | 禁止目录黑名单 + 路径规范化 |
| P0 | 用户正则 ReDoS（`(a+)+b` 可让 CLI 假死 55s+） | 50ms 超时测试 + 危险模式丢弃 |
| P0 | `backup restore` 跟随符号链接可泄露 `/etc/passwd` | 符号链接守卫 |
| P0 | `scoreMemories` 覆盖已有 hash，破坏 full↔incremental 对应关系 | 跳过已有 hash |
| P1 | `recordImported` 并发写丢数据 | 改为 O_APPEND 原子追加 |
| P1 | claude-code overwrite 分支缺失 content size 校验 | 补充 50MB 写入上限 |
| P1 | `diffMemories` 对当前 export 内部同 hash 不去重 | Set 去重 |
| P1 | Hermes skill 名过滤不完整（null byte / 换行 / 超长） | 严格正则过滤 |

**其他安全加固**
- `.memobridge/` 加入 `.gitignore`，避免备份路径/ledger 泄漏

### 变更

- `Memory` 接口新增可选字段：`content_hash`、`importance`、`freshness`、`quality`、`origin`（完全向后兼容）
- `Importer` 接口新增可选方法 `listTargets()`（不实现也能运行，只是没有备份保护）
- `FORMAT_VERSION` 保持 `"0.1"`，v0.1 文件可被 v0.2 直接解析

### 数据

- 测试数：395 → **539**（新增 144 个）
- 新增运行时依赖：**0**
- 新增核心模块：`src/core/{quality,backup,diff,config}.ts`

---

## [0.1.0] — 2026-04-20 "能搬"

> 主题：MVP — 8 个 AI 工具之间的记忆迁移跑通。

### 新增

**工具支持**
- 本地工具（全自动）：CodeBuddy、OpenClaw、Hermes Agent、Claude Code、Cursor
- 云端工具（Prompt 引导）：ChatGPT、豆包 (Doubao)、Kimi

**核心功能**
- `detect`：扫描系统发现已安装的 AI 工具
- `extract`：从任意本地工具提取记忆，输出标准 `memo-bridge.md`
- `import`：将 `memo-bridge.md` 导入到任意工具（文件写入或指令生成）
- `migrate`：一步完成 extract + import
- `prompt`：为云端工具生成最优导出提示词

**核心模块**
- `src/core/schema.ts`：YAML front matter + Markdown 解析/序列化
- `src/core/privacy.ts`：15 种敏感信息模式自动脱敏
- `src/core/merger.ts`：多工作区记忆合并去重
- `src/core/detector.ts`：工具检测 + 工作区扫描
- `src/core/registry.ts`：适配器注册表（工厂模式，懒实例化）

**特性**
- 多工作区扫描（CodeBuddy、OpenClaw、Cursor）
- Hermes 2200 字符自动裁剪
- 中间格式：人类可读 + LLM 友好 + Git 友好

**测试**：395 个测试，15 个测试文件

---

## [Unreleased]

### 规划中

- MCP Server：跨工具实时记忆共享
- 跨工具 Skills 互转（Hermes ↔ CodeBuddy ↔ Claude Skills）
- 删除传播 + 三路合并
- 语义去重（可选 embedding 依赖）
- Web UI + 浏览器扩展（ChatGPT / 豆包可视化导出）
- 通义千问 / 智谱 / Windsurf / Cline 适配器

[0.2.0]: https://github.com/gonelake/memo-bridge/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/gonelake/memo-bridge/releases/tag/v0.1.0
[Unreleased]: https://github.com/gonelake/memo-bridge/compare/v0.2.0...HEAD
