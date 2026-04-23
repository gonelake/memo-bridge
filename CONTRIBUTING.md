# Contributing to MemoBridge

感谢你对 MemoBridge 的关注！欢迎任何形式的贡献。

## 快速开始

```bash
git clone https://github.com/gonelake/memo-bridge.git
cd memo-bridge
npm install
npm run dev   # watch 模式
npm test      # 运行全部 539 个测试
```

## 贡献类型

| 类型 | 说明 |
|------|------|
| 🔌 新工具适配器 | 添加对新 AI 工具的支持（见下方详细指南） |
| 🐛 Bug 修复 | 附上能复现问题的测试用例 |
| 🧪 测试 | 提升覆盖率，特别是 edge case |
| 📖 文档 | 修正错误、补充示例 |
| 🌐 国际化 | 英文注释、日志消息翻译 |

---

## 添加新工具适配器

添加一个工具需要 **4 个文件改动**，通常 2–4 小时可完成。

### 第一步：添加工具 ID

编辑 `src/core/types.ts`：

```typescript
// 在 TOOL_IDS 数组中添加
export const TOOL_IDS = [
  'codebuddy',
  'openclaw',
  // ... 已有工具 ...
  'windsurf',   // ← 新增
] as const;

// 在 TOOL_NAMES 中添加显示名称
export const TOOL_NAMES: Record<ToolId, string> = {
  // ...
  windsurf: 'Windsurf',  // ← 新增
};
```

### 第二步：创建 Extractor

在 `src/extractors/windsurf.ts` 创建提取器：

```typescript
import { BaseExtractor, type DetectConfig } from './base.js';
import type { ExtractOptions, MemoBridgeData } from '../core/types.js';

export default class WindsurfExtractor extends BaseExtractor {
  readonly toolId = 'windsurf' as const;

  // 声明式检测：列出工具存储路径和工作区标识文件
  readonly detectConfig: DetectConfig = {
    globalPaths: ['~/.windsurf'],
    workspaceMarkers: ['.windsurf'],
    description: 'Windsurf memory files',
  };

  async extract(options: ExtractOptions): Promise<MemoBridgeData> {
    const data = this.createEmptyData(options.workspace);

    // 读取工具记忆文件
    const memoryPath = `${options.workspace ?? process.env.HOME}/.windsurf/memory.md`;
    const content = await this.readFileSafe(memoryPath);
    if (!content) return data;

    // 将内容解析为 raw_memories
    data.raw_memories.push({
      id: 'windsurf-1',
      content: content.trim(),
      category: 'general',
      source: memoryPath,
      confidence: 0.8,
    });

    data.meta.stats.total_memories = data.raw_memories.length;
    return data;
  }
}
```

**关键约束：**
- 继承 `BaseExtractor`，使用 `this.readFileSafe()` 读文件（自带 10MB 限制保护）
- `createEmptyData()` 生成符合 schema 的空结构
- 云端工具（无本地文件）：继承 `src/extractors/cloud.ts` 中的 `CloudExtractor`，`extract()` 直接 `throw`

### 第三步：创建 Importer

在 `src/importers/windsurf.ts` 创建导入器：

```typescript
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { homedir } from 'node:os';
import { BaseImporter } from './base.js';
import { validateOutputPath } from '../utils/security.js';
import type { MemoBridgeData, ImportOptions, ImportResult } from '../core/types.js';

export default class WindsurfImporter extends BaseImporter {
  readonly toolId = 'windsurf' as const;

  listTargets(_data: MemoBridgeData, options: ImportOptions): string[] {
    // 声明所有会被写入的文件路径（用于自动备份）
    const base = options.workspace ?? homedir();
    return [`${base}/.windsurf/memory.md`];
  }

  async import(data: MemoBridgeData, options: ImportOptions): Promise<ImportResult> {
    const outputPath = `${options.workspace ?? homedir()}/.windsurf/memory.md`;

    // 路径安全校验（防止路径遍历攻击）
    validateOutputPath(outputPath);

    const content = this.flattenToText(data);

    if (options.dryRun) {
      return {
        success: true,
        method: 'file_write',
        items_imported: this.countImported(data),
        items_skipped: 0,
        output_path: outputPath,
      };
    }

    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, content, 'utf-8');

    return {
      success: true,
      method: 'file_write',
      items_imported: this.countImported(data),
      items_skipped: 0,
      output_path: outputPath,
    };
  }
}
```

**关键约束：**
- **必须实现 `listTargets()`**，否则导入前不会自动备份
- 调用 `validateOutputPath()` 防止路径遍历
- 云端工具（只生成指令文本）：继承 `src/importers/instruction-based.ts` 中的基类

### 第四步：注册适配器

编辑 `src/registry/defaults.ts`：

```typescript
import WindsurfExtractor from '../extractors/windsurf.js';
import WindsurfImporter from '../importers/windsurf.js';

export function registerDefaults(): void {
  // ...已有注册...
  extractorRegistry.register('windsurf', () => new WindsurfExtractor());
  importerRegistry.register('windsurf',  () => new WindsurfImporter());
}
```

### 第五步：添加测试

参考 `tests/extractors/cursor.test.ts` 的结构：

```
tests/extractors/windsurf.test.ts   # 检测逻辑、提取逻辑、边界情况
tests/importers/windsurf.test.ts    # 写入逻辑、dry-run、listTargets
```

测试要求：
- 使用 `tmp` 临时目录，不依赖真实 `~/.windsurf`
- 覆盖：检测命中 / 未命中、提取正常 / 文件不存在、导入写入 / dry-run / 路径安全

### 第六步：更新文档

- `README.md` 的「支持工具」表格添加新工具行
- `README_EN.md` 同步更新

---

## 云端工具（无本地 API）

对于 ChatGPT / 豆包 / Kimi 类工具，采用「Prompt 引导」模式：

1. **Extractor**：继承 `src/extractors/cloud.ts` 的 `CloudExtractor`，提供 `promptTemplate` 属性
2. **Importer**：继承 `src/importers/instruction-based.ts` 的 `InstructionBasedImporter`，实现 `generateInstructions()`
3. **提示词模板**：在 `src/prompts/<tool>.ts` 中添加导出提示词

---

## 代码规范

- **TypeScript strict 模式**：运行 `npm run lint` 确保零类型错误
- **ESM**：所有导入路径必须带 `.js` 扩展名（即使源文件是 `.ts`）
- **日志**：使用 `src/utils/logger.ts` 的 `log.*` 方法，不直接 `console.log`
- **错误消息**：中文面向用户，英文面向开发者/测试

## Pull Request 规范

1. Fork → feature 分支（`feat/windsurf-adapter`）
2. 确保 `npm test` 全绿，`npm run lint` 无报错
3. PR 描述中说明：工具的记忆存储路径、提取方式（自动/引导）、已测试的场景
4. 不需要同步更新 `CHANGELOG.md`，维护者会在发版时统一整理

## 许可证

提交即表示同意以 [MIT 许可证](./LICENSE) 授权你的贡献。
