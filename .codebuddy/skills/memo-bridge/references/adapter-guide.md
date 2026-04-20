# Adapter Development Guide

## How to Add a New Tool Adapter

Adding support for a new AI tool requires two components: an **Extractor** (export) and an **Importer** (import).

## Step 1: Add Tool ID

In `src/core/types.ts`:

1. Add to `TOOL_IDS` array
2. Add display name to `TOOL_NAMES`

## Step 2: Create Extractor

Create `src/extractors/<tool-id>.ts`:

```typescript
import { BaseExtractor } from './base.js';
import { detectTool } from '../core/detector.js';
import { scanAndRedact } from '../core/privacy.js';
import type { DetectResult, ExtractOptions, MemoBridgeData } from '../core/types.js';

export default class MyToolExtractor extends BaseExtractor {
  readonly toolId = 'my-tool' as const;

  async detect(): Promise<DetectResult> {
    return detectTool('my-tool');
  }

  async extract(options: ExtractOptions): Promise<MemoBridgeData> {
    const data = this.createEmptyData(options.workspace);
    // 1. Read memory files
    // 2. Parse and classify into profile/knowledge/projects/feeds/raw_memories
    // 3. Apply privacy scanning: scanAndRedact(content)
    // 4. Update meta stats
    return data;
  }
}
```

## Step 3: Create Importer

Create `src/importers/<tool-id>.ts`:

```typescript
import { BaseImporter } from './base.js';
import { validateWritePath, validateContentSize, isNotSymlink } from '../utils/security.js';
import type { MemoBridgeData, ImportOptions, ImportResult } from '../core/types.js';

export default class MyToolImporter extends BaseImporter {
  readonly toolId = 'my-tool' as const;

  async import(data: MemoBridgeData, options: ImportOptions): Promise<ImportResult> {
    const targetPath = validateWritePath(/* path */);
    // 1. Build content in target format
    // 2. Validate content size
    // 3. Check symlinks before writing
    // 4. Handle dry-run mode
    // 5. Write file or generate instructions
    return { success: true, method: 'file_write', items_imported: N, items_skipped: 0 };
  }
}
```

## Step 4: Register in CLI

In `src/cli.ts`, add to `getExtractor()` and `getImporter()` switch statements.

## Step 5: Add Detection Config

In `src/core/detector.ts`, add a `ToolDetectionConfig` entry.

## Security Checklist

- [ ] All write paths go through `validateWritePath()`
- [ ] Content size checked with `validateContentSize()`
- [ ] Symlink check with `isNotSymlink()` before every write
- [ ] Privacy scan with `scanAndRedact()` on all extracted content
- [ ] Dry-run mode supported and tested
