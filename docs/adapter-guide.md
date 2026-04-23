# 第三方适配器开发指南

本指南面向希望为 MemoBridge 添加新工具支持的开发者。完成后可提交 PR，或作为独立 npm 包发布。

## 前提知识

- TypeScript / Node.js ESM 基础
- 了解目标 AI 工具的记忆存储位置（文件路径 / API / 网页）

---

## 适配器类型选择

```
目标工具有本地文件存储？
    │
    ├─ YES → 本地适配器（推荐，全自动）
    │           BaseExtractor + BaseImporter
    │
    └─ NO  → 云端适配器（Prompt 引导，半自动）
                CloudExtractor + InstructionBasedImporter
```

---

## 快速参考：接口契约

### Extractor 必须实现

```typescript
interface Extractor {
  readonly toolId: ToolId;
  readonly toolName: string;
  detect(workspacePath?: string): Promise<DetectResult>;
  extract(options: ExtractOptions): Promise<MemoBridgeData>;
}
```

### Importer 必须实现

```typescript
interface Importer {
  readonly toolId: ToolId;
  readonly toolName: string;
  import(data: MemoBridgeData, options: ImportOptions): Promise<ImportResult>;
  listTargets?(data: MemoBridgeData, options: ImportOptions): string[];  // 强烈建议实现
}
```

---

## 本地适配器（完整示例）

以"Windsurf"为例，假设其记忆存储在 `~/.windsurf/memories/` 目录。

### 1. Extractor

```typescript
// src/extractors/windsurf.ts
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { BaseExtractor, type DetectConfig } from './base.js';
import { scanAndRedact } from '../core/privacy.js';
import type { ExtractOptions, MemoBridgeData, Memory } from '../core/types.js';

export default class WindsurfExtractor extends BaseExtractor {
  readonly toolId = 'windsurf' as const;

  // 声明式检测：指定全局路径和工作区标识文件
  // BaseExtractor.detect() 会自动检查这些路径是否存在
  readonly detectConfig: DetectConfig = {
    globalPaths: ['~/.windsurf'],
    workspaceMarkers: ['.windsurf/config.json'],
    description: 'Windsurf AI memories',
  };

  async extract(options: ExtractOptions): Promise<MemoBridgeData> {
    const data = this.createEmptyData(options.workspace);
    const memoriesDir = join(homedir(), '.windsurf', 'memories');

    // 检查目录是否存在
    if (!(await this.dirExists(memoriesDir))) {
      return data;  // 工具未安装或无记忆，返回空结构
    }

    // 扫描记忆文件
    let files: string[];
    try {
      files = await readdir(memoriesDir);
    } catch {
      return data;
    }

    const memories: Memory[] = [];
    for (const file of files.filter(f => f.endsWith('.md'))) {
      const filePath = join(memoriesDir, file);
      const content = await this.readFileSafe(filePath);  // 自带 10MB 限制
      if (!content) continue;

      const redacted = scanAndRedact(content);  // 隐私脱敏
      memories.push({
        id: `windsurf-${file}`,
        content: redacted,
        category: 'general',
        source: filePath,
        confidence: 0.8,
      });
    }

    data.raw_memories = memories;
    data.meta.stats.total_memories = memories.length;
    data.meta.stats.categories = 1;
    return data;
  }
}
```

**注意事项：**
- `this.readFileSafe()` 在文件不存在或超过 10MB 时返回 `null`，不会抛出
- `scanAndRedact()` 应在存储文件内容之前调用
- `createEmptyData()` 返回符合 schema 的空结构，始终从它开始
- 声明 `detectConfig` 后，无需重写 `detect()`；只有需要自定义检测逻辑时才重写

### 2. Importer

```typescript
// src/importers/windsurf.ts
import { writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { BaseImporter } from './base.js';
import { validateOutputPath } from '../utils/security.js';
import type { MemoBridgeData, ImportOptions, ImportResult } from '../core/types.js';

export default class WindsurfImporter extends BaseImporter {
  readonly toolId = 'windsurf' as const;

  /**
   * 声明所有可能被写入的文件路径。
   * CLI 在调用 import() 之前会快照这些文件，以支持回滚。
   * 包括"将要新建的"文件 — 回滚时若原本不存在则删除。
   */
  listTargets(_data: MemoBridgeData, options: ImportOptions): string[] {
    const base = options.workspace ?? homedir();
    return [join(base, '.windsurf', 'memories', 'memo-bridge-import.md')];
  }

  async import(data: MemoBridgeData, options: ImportOptions): Promise<ImportResult> {
    const outputPath = join(
      options.workspace ?? homedir(),
      '.windsurf', 'memories', 'memo-bridge-import.md'
    );

    // 路径安全校验（阻止路径遍历、写入禁止目录）
    validateOutputPath(outputPath);

    const content = this.flattenToText(data);  // 将 MemoBridgeData 序列化为 Markdown

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

**注意事项：**
- `validateOutputPath()` 是必须调用的，不可省略
- `listTargets()` 和 `import()` 中的路径计算逻辑必须保持一致
- `flattenToText(data, maxChars?)` 可传入字符数限制（如 Hermes 的 2200）
- `options.dryRun = true` 时返回预期结果但不写文件

---

## 云端适配器（Prompt 引导）

对于无本地文件的云端工具（如新的 AI 助手产品）：

### Extractor（仅检测，extract 不可用）

```typescript
// src/extractors/newai.ts
import { CloudExtractor } from './cloud.js';

export default class NewAIExtractor extends CloudExtractor {
  readonly toolId = 'newai' as const;

  // 提供给用户的导出引导提示词
  readonly promptTemplate = `
请将你目前记住的关于我的所有信息整理输出，包括：
1. 我的个人偏好和习惯
2. 我的项目背景
3. 你学到的关于我工作方式的内容

请用 Markdown 格式输出，每条信息单独一行，用 - 开头。
  `.trim();
}
```

`CloudExtractor` 的 `extract()` 会自动抛出友好的错误提示，引导用户使用 `prompt` 命令。

### Importer（生成"请记住"指令）

```typescript
// src/importers/newai.ts
import { InstructionBasedImporter } from './instruction-based.js';
import type { MemoBridgeData, ImportOptions } from '../core/types.js';

export default class NewAIImporter extends InstructionBasedImporter {
  readonly toolId = 'newai' as const;

  protected generateInstructions(data: MemoBridgeData, _options: ImportOptions): string {
    const summary = this.flattenToText(data, 3000);
    return `请记住以下关于我的信息，并在后续对话中使用：\n\n${summary}`;
  }
}
```

### 添加提示词模板

```typescript
// src/prompts/newai.ts
export const newAIExportPrompt = `
# NewAI 记忆导出提示词

将以下内容发送给 NewAI：

---
请整理并输出你目前掌握的关于我的所有记忆……
---
`;
```

在 `src/prompts/index.ts` 注册：

```typescript
import { newAIExportPrompt } from './newai.js';

export function getExportPromptForTool(toolId: ToolId): string {
  const prompts: Partial<Record<ToolId, string>> = {
    // ...
    newai: newAIExportPrompt,
  };
  return prompts[toolId] ?? universalPrompt;
}
```

---

## 注册到 Registry

```typescript
// src/registry/defaults.ts
import WindsurfExtractor from '../extractors/windsurf.js';
import WindsurfImporter from '../importers/windsurf.js';

export function registerDefaults(): void {
  // ...已有...
  extractorRegistry.register('windsurf', () => new WindsurfExtractor());
  importerRegistry.register('windsurf',  () => new WindsurfImporter());
}
```

---

## 测试规范

### 目录结构

```
tests/extractors/windsurf.test.ts
tests/importers/windsurf.test.ts
```

### 必须覆盖的场景

**Extractor 测试：**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import WindsurfExtractor from '../../src/extractors/windsurf.js';

describe('WindsurfExtractor', () => {
  let tmpDir: string;
  let extractor: WindsurfExtractor;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'windsurf-test-'));
    extractor = new WindsurfExtractor();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('检测到工具时返回 detected: true', async () => {
    await mkdir(join(tmpDir, '.windsurf'));
    const result = await extractor.detect(tmpDir);
    expect(result.detected).toBe(true);
  });

  it('未安装时返回 detected: false', async () => {
    const result = await extractor.detect(tmpDir);
    expect(result.detected).toBe(false);
  });

  it('提取记忆文件内容', async () => {
    const memoriesDir = join(tmpDir, '.windsurf', 'memories');
    await mkdir(memoriesDir, { recursive: true });
    await writeFile(join(memoriesDir, 'pref.md'), '- 偏好：简洁回答');

    const data = await extractor.extract({ workspace: tmpDir });
    expect(data.raw_memories).toHaveLength(1);
    expect(data.raw_memories[0].content).toContain('偏好');
  });

  it('记忆目录不存在时返回空结构', async () => {
    const data = await extractor.extract({ workspace: tmpDir });
    expect(data.raw_memories).toHaveLength(0);
  });

  it('自动脱敏 API Key', async () => {
    const memoriesDir = join(tmpDir, '.windsurf', 'memories');
    await mkdir(memoriesDir, { recursive: true });
    await writeFile(join(memoriesDir, 'keys.md'), 'key = sk-abc123xyz456def789');

    const data = await extractor.extract({ workspace: tmpDir });
    expect(data.raw_memories[0].content).not.toContain('sk-abc123');
    expect(data.raw_memories[0].content).toContain('[REDACTED');
  });
});
```

**Importer 测试：**

```typescript
describe('WindsurfImporter', () => {
  it('listTargets 返回正确路径', () => {
    const importer = new WindsurfImporter();
    const targets = importer.listTargets(mockData, { workspace: '/tmp/ws' });
    expect(targets[0]).toContain('.windsurf/memories');
  });

  it('dry-run 不写文件', async () => {
    const importer = new WindsurfImporter();
    const result = await importer.import(mockData, { workspace: tmpDir, dryRun: true });
    expect(result.success).toBe(true);
    // 验证文件确实没有被创建
    await expect(access(expectedPath)).rejects.toThrow();
  });

  it('正常导入写入文件', async () => {
    const importer = new WindsurfImporter();
    const result = await importer.import(mockData, { workspace: tmpDir });
    expect(result.success).toBe(true);
    const content = await readFile(result.output_path!, 'utf-8');
    expect(content.length).toBeGreaterThan(0);
  });
});
```

---

## 作为独立 npm 包发布

如果你不想将适配器合并到主仓库，可以独立发布：

```typescript
// my-windsurf-adapter/src/index.ts
import { extractorRegistry, importerRegistry } from 'memo-bridge';
import WindsurfExtractor from './extractor.js';
import WindsurfImporter from './importer.js';

// 调用方在应用入口执行一次即可
export function registerWindsurfAdapter() {
  extractorRegistry.register('windsurf', () => new WindsurfExtractor());
  importerRegistry.register('windsurf',  () => new WindsurfImporter());
}
```

**注意**：独立包无法注册新的 `ToolId`（`ToolId` 是 `memo-bridge` 的内部类型）。可以用 `as any` 或等待上游合并后使用官方 `ToolId`。

---

## 常见问题

**Q：文件超大（>10MB）如何处理？**
`readFileSafe()` 会跳过超大文件并打印警告，extractor 应正常返回已读取的部分。

**Q：工具有多个工作区怎么办？**
参考 `src/extractors/codebuddy.ts` 的 `autoDiscoverWorkspaces()` 模式，扫描 `~/projects/*/` 后用 `mergeMemories()` 合并。

**Q：listTargets 必须实现吗？**
不强制，但没有 `listTargets()` 就没有自动备份保护。用户在 `import` 时不会收到警告，但遇到问题时无法回滚。强烈建议实现。

**Q：如何处理工具特有的数据（如 Hermes skills）？**
存入 `data.extensions[toolId]`。这部分数据不会被其他工具的 importer 读取，但在同工具 round-trip（extract → import 到同一工具）时可以恢复。
