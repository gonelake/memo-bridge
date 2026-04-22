#!/usr/bin/env node
/**
 * MemoBridge CLI — 让你的 AI 记忆自由流动
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { detectAllTools } from './core/detector.js';
import { extractorRegistry, importerRegistry } from './core/registry.js';
import { TOOL_NAMES, isToolId, type ToolId } from './core/types.js';
import { log } from './utils/logger.js';
import { validateWritePath, sanitizePath, validateContentSize } from './utils/security.js';
import { getExportPromptForTool } from './prompts/index.js';

// Register all built-in adapters (side effect)
import './registry/defaults.js';

/**
 * Resolve a workspace value that may have come from a config file.
 * Applies sanitizePath (absolutize + null-byte reject) so that even if
 * something slipped past loadConfig's validateWritePath smoke test
 * (e.g. a forbidden path was later un-forbidden), we still canonicalise
 * before handing off to importers. Returns undefined unchanged.
 */
function resolveWorkspace(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    return sanitizePath(raw);
  } catch (err) {
    log.warn(`忽略非法 workspace 路径: ${raw} — ${err instanceof Error ? err.message : String(err)}`);
    return undefined;
  }
}

const program = new Command();

program
  .name('memo-bridge')
  .description('🌉 MemoBridge — AI memory migration tool\n   让你的 AI 记忆自由流动')
  .version('0.1.0');

// detect command
program
  .command('detect')
  .description('检测已安装的 AI 工具 / Detect installed AI tools')
  .option('-w, --workspace <path>', '工作区路径')
  .action(async (options: { workspace?: string }) => {
    log.header('MemoBridge — 工具检测');
    const results = await detectAllTools(options.workspace);

    const localTools = results.filter(r => r.detected && r.paths && r.paths.length > 0);
    const cloudTools = results.filter(r => r.detected && (!r.paths || r.paths.length === 0));
    const notFound = results.filter(r => !r.detected);

    if (localTools.length > 0) {
      console.log(chalk.green.bold('  📂 检测到本地工具:'));
      for (const r of localTools) {
        console.log(`     ${chalk.green('●')} ${r.name}`);
        if (r.paths) {
          for (const p of r.paths) {
            console.log(chalk.dim(`       ${p}`));
          }
        }
      }
      console.log('');
    }

    if (cloudTools.length > 0) {
      console.log(chalk.yellow.bold('  ☁️  云端工具 (需 Prompt 引导导出):'));
      for (const r of cloudTools) {
        console.log(`     ${chalk.yellow('●')} ${r.name}`);
      }
      console.log('');
    }

    if (notFound.length > 0) {
      console.log(chalk.dim('  未检测到:'));
      for (const r of notFound) {
        console.log(chalk.dim(`     ○ ${r.name}`));
      }
      console.log('');
    }

    log.info(`共检测到 ${localTools.length + cloudTools.length}/${results.length} 个工具`);
  });

// extract command
program
  .command('extract')
  .description('从 AI 工具导出记忆 / Extract memories from an AI tool')
  .requiredOption('-f, --from <tool>', `来源工具 (${Object.keys(TOOL_NAMES).join('/')})`)
  .option('-w, --workspace <path>', '指定单个工作区路径')
  .option('-s, --scan-dir <path>', '指定扫描根目录（自动发现所有工作区）')
  .option('-o, --output <path>', '输出文件路径', './memo-bridge.md')
  .option('--since <path>', '增量模式：基于先前的导出文件，只输出新增/变更的记忆')
  .option('-v, --verbose', '详细输出')
  .action(async (options: { from: string; workspace?: string; scanDir?: string; output: string; since?: string; verbose?: boolean }) => {
    if (!isToolId(options.from)) {
      log.error(`未知工具: ${options.from}。支持的工具: ${Object.keys(TOOL_NAMES).join(', ')}`);
      process.exit(1);
    }
    const toolId: ToolId = options.from;

    log.header(`MemoBridge — 从 ${TOOL_NAMES[toolId]} 导出记忆`);
    log.info('提取器加载中...');

    try {
      const { loadConfig } = await import('./core/config.js');
      const config = await loadConfig();
      const workspace = resolveWorkspace(options.workspace ?? config.defaultWorkspace);

      const extractor = extractorRegistry.get(toolId);
      let data = await extractor.extract({ workspace, scanDir: options.scanDir, verbose: options.verbose });

      // v0.2 — populate quality/hash fields before serialization
      const { scoreMemories } = await import('./core/quality.js');
      scoreMemories(data, { importanceKeywords: config.quality.importanceKeywords });

      // v0.2 — apply user privacy patterns as a second redaction pass over
      // raw_memories content. Built-in patterns are already applied inside
      // each extractor; this pass lets users add org-specific rules via
      // .memobridge.yaml without touching extractor internals.
      if (config.privacy.extraPatterns.length > 0) {
        const { scanAndRedact } = await import('./core/privacy.js');
        let redactedCount = 0;
        for (const m of data.raw_memories) {
          const result = scanAndRedact(m.content, config.privacy.extraPatterns);
          if (result.found) {
            m.content = result.redacted_content;
            redactedCount += result.detections.reduce((n, d) => n + d.count, 0);
          }
        }
        if (redactedCount > 0) {
          log.info(`用户自定义规则脱敏: ${redactedCount} 处`);
        }
      }

      // v0.2 — incremental mode: diff against previous export
      if (options.since) {
        const { readFile } = await import('node:fs/promises');
        const { parseMemoBridge } = await import('./core/schema.js');
        const { diffMemories, applyDiff, computeSnapshotHash } = await import('./core/diff.js');

        const prevRaw = await readFile(sanitizePath(options.since), 'utf-8');
        const prev = parseMemoBridge(prevRaw);
        // Score the previous snapshot too, in case it's a v0.1 export without hashes.
        scoreMemories(prev, { importanceKeywords: config.quality.importanceKeywords });

        const diff = diffMemories(data.raw_memories, prev.raw_memories);
        log.info(`增量 diff: +${diff.stats.new} new, ~${diff.stats.changed} changed, -${diff.stats.deleted} deleted (ignored), =${diff.stats.unchanged} unchanged`);

        data = applyDiff(data, diff);
        data.meta.previous_export = {
          exported_at: prev.meta.exported_at,
          snapshot_hash: computeSnapshotHash(prev.raw_memories),
          total_memories: prev.raw_memories.length,
        };
      }

      // Serialize to file with security checks
      const { serializeMemoBridge } = await import('./core/schema.js');
      const { writeFile } = await import('node:fs/promises');
      const content = serializeMemoBridge(data);
      validateContentSize(content);
      const outputPath = validateWritePath(options.output);
      await writeFile(outputPath, content, 'utf-8');

      log.success(`导出完成!`);
      log.table('输出文件', outputPath);
      log.table('记忆条数', data.meta.stats.total_memories);
      log.table('分类数', data.meta.stats.categories);
      if (data.meta.stats.earliest && data.meta.stats.latest) {
        log.table('时间跨度', `${data.meta.stats.earliest} ~ ${data.meta.stats.latest}`);
      }
    } catch (err) {
      log.error(`导出失败: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

// prompt command
program
  .command('prompt')
  .description('获取 AI 记忆导出提示词 / Get export prompt for an AI tool')
  .requiredOption('-f, --for <tool>', '目标工具')
  .action(async (options: { for: string }) => {
    if (!isToolId(options.for)) {
      log.error(`未知工具: ${options.for}。支持: ${Object.keys(TOOL_NAMES).join(', ')}`);
      process.exit(1);
    }
    const toolId: ToolId = options.for;
    log.header(`MemoBridge — ${TOOL_NAMES[toolId]} 导出提示词`);

    const prompt = getExportPromptForTool(toolId, TOOL_NAMES[toolId]);
    console.log(chalk.dim('─'.repeat(60)));
    console.log('');
    console.log(prompt);
    console.log('');
    console.log(chalk.dim('─'.repeat(60)));
    log.info(`将以上内容复制到 ${TOOL_NAMES[toolId]} 的对话中发送`);
  });

// import command placeholder
program
  .command('import')
  .description('导入记忆到 AI 工具 / Import memories into an AI tool')
  .requiredOption('-t, --to <tool>', '目标工具')
  .requiredOption('-i, --input <path>', '输入文件路径 (memo-bridge.md)')
  .option('-w, --workspace <path>', '工作区路径')
  .option('--overwrite', '覆盖已有内容')
  .option('--mode <mode>', '导入模式: full | incremental', 'full')
  .option('--dry-run', '预览模式，不实际写入')
  .action(async (options: { to: string; input: string; workspace?: string; overwrite?: boolean; mode?: string; dryRun?: boolean }) => {
    if (!isToolId(options.to)) {
      log.error(`未知工具: ${options.to}。支持的工具: ${Object.keys(TOOL_NAMES).join(', ')}`);
      process.exit(1);
    }
    const toolId: ToolId = options.to;
    const mode = options.mode === 'incremental' ? 'incremental' : 'full';

    if (mode === 'incremental' && options.overwrite) {
      log.warn('--mode=incremental 与 --overwrite 语义矛盾，已忽略 --overwrite');
      options.overwrite = false;
    }

    log.header(`MemoBridge — 导入记忆到 ${TOOL_NAMES[toolId]}`);

    try {
      const { loadConfig } = await import('./core/config.js');
      const config = await loadConfig();
      const workspace = resolveWorkspace(options.workspace ?? config.defaultWorkspace);

      const { readFile, stat: fstat } = await import('node:fs/promises');
      const { parseMemoBridge } = await import('./core/schema.js');
      const { MAX_READ_SIZE } = await import('./utils/security.js');

      // Validate input file
      const inputPath = sanitizePath(options.input);
      const fileStats = await fstat(inputPath);
      if (fileStats.size > MAX_READ_SIZE) {
        throw new Error(`输入文件过大 (${(fileStats.size / 1024 / 1024).toFixed(1)}MB)，上限 ${MAX_READ_SIZE / 1024 / 1024}MB`);
      }

      const content = await readFile(inputPath, 'utf-8');
      let data = parseMemoBridge(content);

      // v0.2 — always score so every memory has a content_hash before the
      // ledger is written. Legacy v0.1 files (no hash in meta) get a fresh
      // hash; files that already carry a hash keep it (scoreMemories is
      // now non-destructive on content_hash). This keeps full and
      // incremental paths in sync so their ledger entries agree.
      const { scoreMemories } = await import('./core/quality.js');
      scoreMemories(data, { importanceKeywords: config.quality.importanceKeywords });

      // v0.2 — incremental mode: filter out memories already imported into this tool
      let ledgerSkipped = 0;
      if (mode === 'incremental') {
        const { loadImportLedger, filterAgainstLedger } = await import('./core/diff.js');
        const ledger = await loadImportLedger(toolId);
        const filtered = filterAgainstLedger(data, ledger);
        data = filtered.data;
        ledgerSkipped = filtered.skipped;
        log.info(`增量导入: ${data.raw_memories.length} 待导入 / ${ledgerSkipped} 已跳过（此前已导入过）`);
      }

      const importer = importerRegistry.get(toolId);

      // v0.2 — snapshot files the importer may touch, before writing.
      // Skip on dry-run (nothing is written) and when the importer declares
      // no file targets (instruction-only importers).
      let backupId: string | undefined;
      if (!options.dryRun) {
        const targets = importer.listTargets?.(data, {
          workspace,
          overwrite: options.overwrite,
        }) ?? [];
        if (targets.length > 0) {
          const { createBackup, pruneBackups } = await import('./core/backup.js');
          const manifest = await createBackup({
            tool: toolId,
            targets,
            workspace,
          });
          backupId = manifest.id;
          // Respect backup.retention — prune older backups after creating this one
          await pruneBackups(process.cwd(), config.backup.retention);
        }
      }

      const result = await importer.import(data, {
        workspace,
        overwrite: options.overwrite,
        dryRun: options.dryRun,
      });

      // v0.2 — on successful non-dry-run, record the hashes we just imported
      if (result.success && !options.dryRun && data.raw_memories.length > 0) {
        const { recordImported } = await import('./core/diff.js');
        const { computeHash } = await import('./core/quality.js');
        const hashes = data.raw_memories
          .map(m => m.content_hash ?? computeHash(m.content))
          .filter((h): h is string => Boolean(h));
        await recordImported(toolId, hashes);
      }

      if (result.success) {
        log.success(`导入完成!`);
        log.table('导入方式', result.method);
        log.table('导入条数', result.items_imported);
        if (result.items_skipped > 0) log.table('跳过条数', result.items_skipped);
        if (ledgerSkipped > 0) log.table('增量跳过', ledgerSkipped);
        if (result.output_path) log.table('写入路径', result.output_path);
        if (backupId) log.table('备份 ID', backupId);
        // v0.2.0 — surface importer warnings to user (previously silent).
        // Without this, non-fatal issues (skipped Hermes skill names, Hermes
        // MEMORY.md truncation, OpenClaw DREAMS stub notice, etc.) only
        // appeared in the return object — users never saw them.
        if (result.warnings && result.warnings.length > 0) {
          console.log('');
          for (const w of result.warnings) log.warn(w);
        }
        if (result.instructions) {
          console.log('');
          log.info('请按以下步骤完成导入:');
          console.log(result.instructions);
        }
        if (backupId) {
          console.log('');
          log.info(`如需回滚: memo-bridge backup restore ${backupId}`);
        }
      }
    } catch (err) {
      log.error(`导入失败: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

// migrate command
program
  .command('migrate')
  .description('一键迁移 / Migrate memories between tools')
  .requiredOption('-f, --from <tool>', '来源工具')
  .requiredOption('-t, --to <tool>', '目标工具')
  .option('-w, --workspace <path>', '来源工作区路径')
  .option('--dry-run', '预览模式')
  .action(async (options: { from: string; to: string; workspace?: string; dryRun?: boolean }) => {
    if (!isToolId(options.from)) {
      log.error(`未知来源工具: ${options.from}。支持: ${Object.keys(TOOL_NAMES).join(', ')}`);
      process.exit(1);
    }
    if (!isToolId(options.to)) {
      log.error(`未知目标工具: ${options.to}。支持: ${Object.keys(TOOL_NAMES).join(', ')}`);
      process.exit(1);
    }
    const fromId: ToolId = options.from;
    const toId: ToolId = options.to;
    log.header(`MemoBridge — 迁移 ${TOOL_NAMES[fromId]} → ${TOOL_NAMES[toId]}`);
    log.info('Step 1/3: 导出记忆...');

    try {
      const { loadConfig } = await import('./core/config.js');
      const config = await loadConfig();
      const workspace = resolveWorkspace(options.workspace ?? config.defaultWorkspace);

      // Extract
      const extractor = extractorRegistry.get(fromId);
      const data = await extractor.extract({ workspace });

      // v0.2 — populate quality/hash fields so the importer sees a fully scored object
      const { scoreMemories } = await import('./core/quality.js');
      scoreMemories(data, { importanceKeywords: config.quality.importanceKeywords });

      log.info(`Step 2/3: 转换格式...`);
      log.table('记忆条数', data.meta.stats.total_memories);

      // Import
      log.info(`Step 3/3: 导入到 ${TOOL_NAMES[toId]}...`);
      const importer = importerRegistry.get(toId);

      // v0.2 — snapshot target files before writing
      let backupId: string | undefined;
      if (!options.dryRun) {
        const targets = importer.listTargets?.(data, { workspace }) ?? [];
        if (targets.length > 0) {
          const { createBackup, pruneBackups } = await import('./core/backup.js');
          const manifest = await createBackup({
            tool: toId,
            targets,
            workspace,
          });
          backupId = manifest.id;
          await pruneBackups(process.cwd(), config.backup.retention);
        }
      }

      const result = await importer.import(data, { workspace, dryRun: options.dryRun });

      if (result.success) {
        log.success('迁移完成!');
        log.table('导入方式', result.method);
        log.table('导入条数', result.items_imported);
        if (backupId) log.table('备份 ID', backupId);
        if (result.warnings && result.warnings.length > 0) {
          console.log('');
          for (const w of result.warnings) log.warn(w);
        }
        if (result.instructions) {
          console.log('');
          console.log(result.instructions);
        }
        if (backupId) {
          console.log('');
          log.info(`如需回滚: memo-bridge backup restore ${backupId}`);
        }
      }
    } catch (err) {
      log.error(`迁移失败: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

// backup list/restore commands
const backupCmd = program
  .command('backup')
  .description('管理导入备份 / Manage import backups');

backupCmd
  .command('list')
  .description('列出所有备份 / List all backups')
  .option('--tool <tool>', '只显示指定工具的备份')
  .action(async (options: { tool?: string }) => {
    const { listBackups } = await import('./core/backup.js');
    let backups = await listBackups();
    if (options.tool) {
      backups = backups.filter(b => b.tool === options.tool);
    }

    if (backups.length === 0) {
      log.info('暂无备份');
      return;
    }

    log.header(`MemoBridge — 备份列表 (${backups.length})`);
    for (const b of backups) {
      const snapshotCount = b.entries.filter(e => e.existed).length;
      console.log(`  ${chalk.cyan(b.id)}`);
      console.log(chalk.dim(`    ${b.created_at}  ·  ${TOOL_NAMES[b.tool]}  ·  ${snapshotCount}/${b.entries.length} 文件已快照`));
      if (b.workspace) console.log(chalk.dim(`    workspace: ${b.workspace}`));
    }
  });

backupCmd
  .command('restore')
  .description('恢复指定备份 / Restore a backup')
  .argument('<id>', '备份 ID（从 backup list 获取）')
  .action(async (id: string) => {
    const { restoreBackup } = await import('./core/backup.js');
    log.header(`MemoBridge — 恢复备份 ${id}`);
    try {
      const result = await restoreBackup(id);
      log.success('恢复完成!');
      log.table('已恢复', result.restored);
      log.table('已删除', result.deleted);
      if (result.skipped > 0) log.table('已跳过', result.skipped);
      if (result.warnings.length > 0) {
        console.log('');
        for (const w of result.warnings) log.warn(w);
      }
    } catch (err) {
      log.error(`恢复失败: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

program.parse();
