# MemoBridge 架构设计

本文档描述 MemoBridge 的整体架构，适合希望深入理解系统设计或贡献代码的开发者。

---

## 核心设计目标

1. **工具无关**：新增工具不影响任何现有代码
2. **格式中立**：中间格式（`memo-bridge.md`）是唯一的耦合点
3. **安全优先**：所有外部输入（文件路径、用户配置、读取内容）在边界处校验
4. **零新依赖原则**：v0.2 增加质量评分、备份、增量同步，新增运行时依赖 = 0

---

## 总体架构：Hub-and-Spoke 适配器模式

```
┌─────────────────────────────────────────────────────────────────┐
│                          CLI (cli.ts)                           │
│       detect │ extract │ import │ migrate │ prompt │ backup     │
└──────────────────────┬──────────────────────────────────────────┘
                       │ orchestrates
        ┌──────────────┼──────────────────┐
        ▼              ▼                  ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│  Extractors  │  │ Core Modules │  │  Importers   │
│  (8 tools)   │  │              │  │  (8 tools)   │
└──────┬───────┘  │  schema      │  └──────┬───────┘
       │          │  privacy     │         │
       │          │  quality     │         │
       │          │  merger      │         │
       │          │  diff        │         │
       │          │  backup      │         │
       │          │  config      │         │
       │          │  detector    │         │
       │          │  registry    │         │
       └──────────┼──────────────┼─────────┘
                  ▼              ▼
           ┌──────────────────────────┐
           │     memo-bridge.md       │
           │  (YAML front matter      │
           │   + Markdown sections)   │
           └──────────────────────────┘
```

**关键设计决策**：每个工具只与中间格式（`MemoBridgeData`）交互，工具之间完全解耦。添加工具 A→B 的新迁移路径不需要任何代码改动，只需要两个适配器都存在。

---

## 中间格式：memo-bridge.md

### 结构

```
┌──────────────────────┐
│  YAML front matter   │  ← 元数据：版本、来源工具、统计、增量基线
├──────────────────────┤
│  # 用户画像          │  ← identity / preferences / work_patterns
│  # 知识积累          │  ← KnowledgeSection[]
│  # 项目上下文        │  ← ProjectContext[]
│  # 关注的信息流      │  ← InformationFeed[]
│  # 原始记忆          │  ← Memory[]（含 v0.2 质量字段）
│  # 扩展数据          │  ← ExtensionsMap（工具私有数据）
└──────────────────────┘
```

### v0.2 Memory 结构

```typescript
interface Memory {
  // v0.1 基础字段
  id: string;             // 工具本地 ID（不跨工具）
  content: string;
  category: string;
  confidence: number;     // 0–1

  // v0.2 质量/同步字段（可选，向后兼容）
  content_hash?: string;  // SHA-256 前 12 位 — 跨工具唯一身份键
  importance?: number;    // 0–1 启发式重要性
  freshness?: number;     // 0–1 时间衰减
  quality?: number;       // 0.5·I + 0.3·F + 0.2·C 合成分

  origin?: {
    tool: ToolId;         // 记忆最初来源的工具
    imported_from?: ToolId;
    first_seen_at?: string;
  };
}
```

**设计选择**：使用 `content_hash` 而非工具本地 `id` 作为增量同步的身份键，原因：工具本地 ID 在迁移后会变化，而内容哈希在内容不变时跨工具稳定。

### 版本兼容性

- `FORMAT_VERSION = "0.1"` 在 v0.2 未改变
- v0.1 文件（无质量字段）可被 v0.2 直接 parse，质量字段按需补填
- v0.2 文件可被 v0.1 工具 parse（新字段被忽略）

---

## 核心模块详解

### registry.ts — 适配器注册表

```typescript
class AdapterRegistry<T> {
  private factories = new Map<ToolId, () => T>();

  register(toolId: ToolId, factory: () => T): void
  get(toolId: ToolId): T          // 每次调用都实例化（无 singleton）
  getAll(): Map<ToolId, T>
}
```

**懒实例化**：适配器按需创建，不在启动时全量实例化。这让测试可以在不初始化所有适配器的情况下单独测试某一个，也让 CLI 启动更快。

**无 singleton**：每次 `get()` 返回新实例，避免跨命令的状态污染。

### privacy.ts — 隐私脱敏

```
输入文本
    │
    ├─ 内置 18+ 种模式（API Key / Token / 密码 / DB 串 / SSH Key / 邮箱 / 私有 IP）
    ├─ 用户自定义模式（来自 .memobridge.yaml，经 ReDoS 测试后注册）
    │
    └─ 逐模式替换 → [REDACTED:类型]
```

**ReDoS 防护**：用户提供的正则在注册前以 50ms 超时测试。检测到 catastrophic backtracking 则丢弃该模式并发出警告。

**调用时机**：脱敏在每个 Extractor 内部调用（提取时），不是在 CLI 层面的后处理。这确保了即使通过 library API 调用也能得到脱敏保护。

### quality.ts — 质量评分

```
Memory
  │
  ├─ content_hash = sha256(normalize(content)).slice(0, 12)
  │    normalize: 去除空白、转小写
  │
  ├─ importance
  │    = category_weight × keyword_boost × length_factor
  │    category_weight: raw_memories=0.8, knowledge=0.9, projects=1.0
  │    keyword_boost: 命中"关键/must/always/..."等词 → ×1.3
  │    length_factor: 归一化到 [0.5, 1.0]（过短惩罚，过长不奖励）
  │
  ├─ freshness
  │    ≤30 天: 1.0,  ≤90 天: 0.85,  ≤365 天: 0.6,  >365 天: 0.3
  │
  └─ quality = 0.5 × importance + 0.3 × freshness + 0.2 × confidence
```

**设计选择**：纯规则启发式，零依赖。分数不保证绝对精准，只用于在导入时排序/截断（如 Hermes 2200 字符限制）。

### diff.ts — 增量同步

两种机制协同工作：

```
extract 侧（--since）:
  current_hashes = Set(current.memories.map(m => m.content_hash))
  prev_hashes    = Set(parse(prev.md).memories.map(m => m.content_hash))
  delta = current_hashes - prev_hashes   ← 只输出这部分

import 侧（--mode=incremental）:
  ledger = .memobridge/imported/<tool>.hashes  （每行一个 hash）
  已导入 hashes = new Set(readLines(ledger))
  待导入 = memories.filter(m => !已导入.has(m.content_hash))
  导入完成后: O_APPEND 写入新 hashes
```

**O_APPEND 原子性**：ledger 文件只追加，多进程并发导入时不会互相覆盖已记录的 hash。

### backup.ts — 备份管理

```
import/migrate 调用链:
  1. importer.listTargets(data, options)  → string[]（目标文件路径）
  2. backup.snapshot(tool, targets)       → snapshotId
  3. importer.import(data, options)       → ImportResult
  4. 如失败: backup.restore(snapshotId)

快照目录结构:
  .memobridge/
  └── backups/
      └── claude-code-20260423T100000/
          ├── manifest.json        ← 文件列表 + 元数据
          └── files/
              └── CLAUDE.md        ← 原始文件内容
```

**符号链接守卫**：snapshot 前检查目标路径是否为符号链接，拒绝跟随（防止将 `/etc/passwd` 备份到用户可见目录）。

**新建文件也能回滚**：`listTargets()` 应包含"即将创建的"文件路径。restore 时，若快照中无该文件的原始内容，则直接删除该文件。

### config.ts — 配置文件

```
优先级（高→低）:
  CLI 参数 > 项目 .memobridge.yaml > 全局 ~/.config/memobridge/config.yaml > 内置默认值

发现机制:
  从 process.cwd() 向上 walk，找第一个 .memobridge.yaml（类似 git 的配置查找）

合并策略:
  标量字段: 高优先级覆盖低优先级
  列表字段: union + dedupe（团队配置 + 个人配置不需互相重复）

校验:
  default_workspace: 检查禁止目录黑名单 + null byte
  privacy.extra_patterns: 50ms ReDoS 测试
  backup.retention: 正整数
```

---

## 数据流：migrate 命令

```
CLI: memo-bridge migrate --from codebuddy --to claude-code
  │
  ├─ 1. extractorRegistry.get('codebuddy')
  │      └─ CodeBuddyExtractor.extract()
  │           ├─ autoDiscoverWorkspaces()
  │           ├─ readFileSafe(memory files)
  │           ├─ scanAndRedact()          ← 隐私脱敏
  │           └─ returns MemoBridgeData
  │
  ├─ 2. quality.scoreMemories(data)       ← 计算 hash + 质量分
  │
  ├─ 3. importerRegistry.get('claude-code')
  │      └─ ClaudeCodeImporter.listTargets()  → ['~/.claude/CLAUDE.md']
  │
  ├─ 4. backup.snapshot('claude-code', targets)  ← 快照
  │
  └─ 5. ClaudeCodeImporter.import(data, options)
         ├─ validateOutputPath()
         ├─ serializer.serialize(data)
         └─ writeFile(CLAUDE.md)
```

---

## 安全边界

| 边界 | 防御措施 | 实现位置 |
|------|----------|----------|
| 文件读取 | 10MB 大小限制 | `BaseExtractor.readFileSafe()` |
| 文件写入 | 50MB 总量限制，禁止目录黑名单 | `validateOutputPath()` |
| 路径遍历 | null byte 拦截，禁止 `..` 穿越 | `utils/security.ts` |
| 符号链接 | 拒绝跟随符号链接写入/备份 | `utils/security.ts` |
| 用户正则 | ReDoS 50ms 超时测试 | `core/config.ts` |
| 脱敏 | 18+ 内置模式 + 用户自定义 | `core/privacy.ts` |

---

## 扩展点

| 扩展 | 方式 |
|------|------|
| 新工具适配器 | 实现 `BaseExtractor` / `BaseImporter`，注册到 registry |
| 自定义脱敏规则 | `.memobridge.yaml` 的 `privacy.extra_patterns` |
| 自定义质量关键词 | `.memobridge.yaml` 的 `quality.importance_keywords` |
| 编程方式使用 | `import { extractorRegistry, importerRegistry } from 'memo-bridge'` |
| 替换单个适配器 | `extractorRegistry.register('codebuddy', () => new MyExtractor())` |

---

## 测试策略

```
tests/
├── core/          ← 纯单元测试，不依赖文件系统（mock 或内存数据）
├── extractors/    ← 使用 tmp 临时目录模拟工具存储，不依赖 ~/ 真实路径
├── importers/     ← 同上，验证写入内容 + listTargets 声明
└── utils/         ← 安全函数专项测试（路径遍历、符号链接攻击场景）
```

**539 个测试，19 个测试文件**。新功能要求先写测试（privacy / diff / backup 模块的测试密度最高，修改时重点保护）。
