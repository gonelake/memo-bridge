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
  .option('-v, --verbose', '详细输出')
  .action(async (options: { from: string; workspace?: string; scanDir?: string; output: string; verbose?: boolean }) => {
    if (!isToolId(options.from)) {
      log.error(`未知工具: ${options.from}。支持的工具: ${Object.keys(TOOL_NAMES).join(', ')}`);
      process.exit(1);
    }
    const toolId: ToolId = options.from;

    log.header(`MemoBridge — 从 ${TOOL_NAMES[toolId]} 导出记忆`);
    log.info('提取器加载中...');

    try {
      const extractor = extractorRegistry.get(toolId);
      const data = await extractor.extract({ workspace: options.workspace, scanDir: options.scanDir, verbose: options.verbose });

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
  .option('--dry-run', '预览模式，不实际写入')
  .action(async (options: { to: string; input: string; workspace?: string; overwrite?: boolean; dryRun?: boolean }) => {
    if (!isToolId(options.to)) {
      log.error(`未知工具: ${options.to}。支持的工具: ${Object.keys(TOOL_NAMES).join(', ')}`);
      process.exit(1);
    }
    const toolId: ToolId = options.to;

    log.header(`MemoBridge — 导入记忆到 ${TOOL_NAMES[toolId]}`);

    try {
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
      const data = parseMemoBridge(content);

      const importer = importerRegistry.get(toolId);
      const result = await importer.import(data, {
        workspace: options.workspace,
        overwrite: options.overwrite,
        dryRun: options.dryRun,
      });

      if (result.success) {
        log.success(`导入完成!`);
        log.table('导入方式', result.method);
        log.table('导入条数', result.items_imported);
        if (result.items_skipped > 0) log.table('跳过条数', result.items_skipped);
        if (result.output_path) log.table('写入路径', result.output_path);
        if (result.instructions) {
          console.log('');
          log.info('请按以下步骤完成导入:');
          console.log(result.instructions);
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
      // Extract
      const extractor = extractorRegistry.get(fromId);
      const data = await extractor.extract({ workspace: options.workspace });

      log.info(`Step 2/3: 转换格式...`);
      log.table('记忆条数', data.meta.stats.total_memories);

      // Import
      log.info(`Step 3/3: 导入到 ${TOOL_NAMES[toId]}...`);
      const importer = importerRegistry.get(toId);
      const result = await importer.import(data, { dryRun: options.dryRun });

      if (result.success) {
        log.success('迁移完成!');
        log.table('导入方式', result.method);
        log.table('导入条数', result.items_imported);
        if (result.instructions) {
          console.log('');
          console.log(result.instructions);
        }
      }
    } catch (err) {
      log.error(`迁移失败: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

program.parse();
