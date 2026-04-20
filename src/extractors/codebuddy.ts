/**
 * MemoBridge — CodeBuddy Extractor
 *
 * Supports multi-workspace scanning: auto-discovers all CodeBuddy workspaces
 * and merges their memories into a single MemoBridgeData.
 *
 * CodeBuddy memory structure per workspace:
 *   .codebuddy/automations/<id>/memory.md   — automation execution logs
 *   .memory/YYYY-MM-DD.md                   — daily work logs
 *   .memory/ai-knowledge-*.md               — AI knowledge outputs
 *   .memory/english-words-*.md              — vocabulary outputs
 *   .memory/words-*.md                      — vocabulary outputs (alt)
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { BaseExtractor } from './base.js';
import { detectTool, autoDiscoverCodeBuddyWorkspaces, scanCodeBuddyWorkspaces } from '../core/detector.js';
import { mergeMemories } from '../core/merger.js';
import { scanAndRedact } from '../core/privacy.js';
import { log } from '../utils/logger.js';
import type {
  DetectResult, ExtractOptions, MemoBridgeData,
  KnowledgeSection, WorkspaceInfo,
} from '../core/types.js';

export default class CodeBuddyExtractor extends BaseExtractor {
  readonly toolId = 'codebuddy' as const;

  async detect(): Promise<DetectResult> {
    return detectTool('codebuddy');
  }

  async extract(options: ExtractOptions): Promise<MemoBridgeData> {
    // Determine workspaces to extract from
    const workspaces = await this.resolveWorkspaces(options);

    if (workspaces.length === 0) {
      throw new Error('未检测到任何 CodeBuddy 工作区。请使用 --workspace 指定路径，或 --scan-dir 指定扫描目录。');
    }

    if (options.verbose) {
      log.info(`发现 ${workspaces.length} 个 CodeBuddy 工作区:`);
      for (const ws of workspaces) {
        log.dim(`  ${ws.path} (自动化:${ws.automationCount} 日志:${ws.memoryFileCount})`);
      }
    }

    // Extract from each workspace
    const results: MemoBridgeData[] = [];
    for (const ws of workspaces) {
      const data = await this.extractSingleWorkspace(ws.path, options);
      results.push(data);
    }

    // Merge all workspaces
    if (results.length === 1) {
      return results[0];
    }

    const merged = mergeMemories(...results);
    // Update meta to reflect multi-workspace source
    merged.meta.source.workspace = workspaces.map(w => w.path).join(' | ');
    return merged;
  }

  // ============================================================
  // Workspace resolution
  // ============================================================

  private async resolveWorkspaces(options: ExtractOptions): Promise<WorkspaceInfo[]> {
    // Option 1: Specific workspace
    if (options.workspace) {
      const info = await this.probeWorkspace(options.workspace);
      return info ? [info] : [];
    }

    // Option 2: Scan from specified root
    if (options.scanDir) {
      return scanCodeBuddyWorkspaces(options.scanDir, 4);
    }

    // Option 3: Auto-discover from common locations
    return autoDiscoverCodeBuddyWorkspaces();
  }

  private async probeWorkspace(wsPath: string): Promise<WorkspaceInfo | null> {
    const hasCodebuddy = await this.dirExists(join(wsPath, '.codebuddy'));
    const hasMemory = await this.dirExists(join(wsPath, '.memory'));

    if (!hasCodebuddy && !hasMemory) return null;

    let automationCount = 0;
    if (hasCodebuddy) {
      const automationsDir = join(wsPath, '.codebuddy', 'automations');
      if (await this.dirExists(automationsDir)) {
        const dirs = await readdir(automationsDir).catch(() => [] as string[]);
        automationCount = dirs.length;
      }
    }

    let memoryFileCount = 0;
    if (hasMemory) {
      const files = await readdir(join(wsPath, '.memory')).catch(() => [] as string[]);
      memoryFileCount = files.filter(f => f.endsWith('.md')).length;
    }

    return {
      path: wsPath,
      tool: 'codebuddy',
      hasAutomations: hasCodebuddy,
      hasMemory: hasMemory,
      automationCount,
      memoryFileCount,
    };
  }

  // ============================================================
  // Single workspace extraction
  // ============================================================

  private async extractSingleWorkspace(wsPath: string, options: ExtractOptions): Promise<MemoBridgeData> {
    const data = this.createEmptyData(wsPath);
    const dates: string[] = [];

    // 1. Extract automation memories
    if (await this.dirExists(join(wsPath, '.codebuddy', 'automations'))) {
      await this.extractAutomations(wsPath, data, dates, options);
    }

    // 2. Extract daily work logs
    if (await this.dirExists(join(wsPath, '.memory'))) {
      await this.extractMemoryFiles(wsPath, data, dates, options);
    }

    // 3. Infer user profile from all collected data
    this.inferProfile(data);

    // 4. Update stats
    const sortedDates = dates.sort();
    data.meta = this.createMeta(
      'file',
      wsPath,
      this.countTotal(data),
      this.countCategories(data),
      sortedDates[0],
      sortedDates[sortedDates.length - 1],
    );

    return data;
  }

  // ============================================================
  // Automation memory extraction
  // ============================================================

  private async extractAutomations(
    wsPath: string,
    data: MemoBridgeData,
    dates: string[],
    _options: ExtractOptions,
  ): Promise<void> {
    const automationsDir = join(wsPath, '.codebuddy', 'automations');
    const dirs = await readdir(automationsDir).catch(() => [] as string[]);

    for (const dirName of dirs) {
      const memoryFile = join(automationsDir, dirName, 'memory.md');
      const content = await this.readFileSafe(memoryFile);
      if (!content) continue;

      // Privacy check
      const { redacted_content, detections } = scanAndRedact(content);
      if (detections.length > 0) {
        log.warn(`  ${memoryFile}: 已脱敏 ${detections.map(d => d.name).join(', ')}`);
      }

      const automationType = this.classifyAutomation(dirName, redacted_content);

      switch (automationType) {
        case 'ai-daily':
          this.extractAiDaily(redacted_content, data, dates);
          break;
        case 'ai-knowledge':
          this.extractAiKnowledge(redacted_content, data, dates);
          break;
        case 'english-words':
          this.extractEnglishWords(redacted_content, data, dates);
          break;
        case 'ai-products':
          this.extractAiProducts(redacted_content, data, dates);
          break;
        default:
          this.extractGenericAutomation(dirName, redacted_content, data, dates);
      }
    }
  }

  private classifyAutomation(dirName: string, content: string): string {
    const lowerContent = content.toLowerCase();
    const lowerDir = dirName.toLowerCase();

    if (lowerDir === 'ai' || lowerContent.includes('ai日报') || lowerContent.includes('ai coding')) {
      return 'ai-daily';
    }
    if (lowerDir === 'ai-2' || lowerContent.includes('基础知识') || lowerContent.includes('transformer')) {
      return 'ai-knowledge';
    }
    if (lowerDir === '5' || lowerContent.includes('英语单词') || lowerContent.includes('english')) {
      return 'english-words';
    }
    if (lowerDir === 'ai-3' || lowerContent.includes('创新产品')) {
      return 'ai-products';
    }
    return 'generic';
  }

  // -- AI 日报 --
  private extractAiDaily(content: string, data: MemoBridgeData, dates: string[]): void {
    const lines = content.split('\n');
    let issueCount = 0;
    let latestDate = '';

    for (const line of lines) {
      // Match date patterns like "## 2026-04-20 08:27"
      const dateMatch = line.match(/^##\s+(20\d{2}-\d{2}-\d{2})/);
      if (dateMatch) {
        dates.push(dateMatch[1]);
        latestDate = dateMatch[1];
        issueCount++;
      }
    }

    data.feeds.push({
      name: 'AI 日报（AI Coding + 具身智能）',
      schedule: '08:30',
      description: '每日筛选 AI 领域重要动态，侧重 AI Coding 与具身智能方向',
      total_issues: issueCount,
      latest_date: latestDate,
    });
  }

  // -- AI 基础知识 --
  private extractAiKnowledge(content: string, data: MemoBridgeData, dates: string[]): void {
    const section: KnowledgeSection = {
      title: 'AI 大模型基础知识',
      description: '每日一个AI知识主题，中英文对照',
      items: [],
    };

    const lines = content.split('\n');
    for (const line of lines) {
      // Match: "1. 2026-03-26 — Transformer（变换器架构）：..."
      const topicMatch = line.match(/^\d+\.\s+(20\d{2}-\d{2}-\d{2})\s+—\s+(.+?)[:：]/);
      if (topicMatch) {
        dates.push(topicMatch[1]);
        section.items.push({
          topic: topicMatch[2].trim(),
          date: topicMatch[1],
          mastery: 'learned',
        });
      }
    }

    if (section.items.length > 0) {
      data.knowledge.push(section);
    }

    data.feeds.push({
      name: 'AI 基础知识日推',
      schedule: '09:00',
      description: '每日一个AI大模型基础知识，中英文对照',
      total_issues: section.items.length,
      latest_date: section.items.length > 0 ? section.items[section.items.length - 1].date : undefined,
    });
  }

  // -- 英语单词 --
  private extractEnglishWords(content: string, data: MemoBridgeData, dates: string[]): void {
    const section: KnowledgeSection = {
      title: '英语词汇积累',
      description: '每日5个实用英语单词，含音标、释义、例句、记忆技巧',
      items: [],
    };

    const lines = content.split('\n');
    for (const line of lines) {
      // Match: "- **输出**：5个实用英语单词（leverage, commute, genuine, deadline, procrastinate）"
      const wordsMatch = line.match(/\*\*输出\*\*[：:]\s*5个实用英语单词[（(](.+?)[）)]/);
      if (wordsMatch) {
        const words = wordsMatch[1].split(/[,，]/).map(w => w.trim());
        for (const word of words) {
          if (word && !section.items.some(i => i.topic === word)) {
            section.items.push({ topic: word, mastery: 'learned' });
          }
        }
      }

      // Extract dates from execution records
      const dateMatch = line.match(/^##\s+(20\d{2}-\d{2}-\d{2})/);
      if (dateMatch) {
        dates.push(dateMatch[1]);
        // Tag recent words with date
        const recentWords = section.items.filter(i => !i.date);
        for (const w of recentWords) {
          w.date = dateMatch[1];
        }
      }
    }

    if (section.items.length > 0) {
      data.knowledge.push(section);
    }

    data.feeds.push({
      name: '每日英语单词',
      schedule: '08:45',
      description: '每日5个实用英语单词，含音标、释义、例句、记忆技巧',
      total_issues: Math.ceil(section.items.length / 5),
      latest_date: dates.length > 0 ? dates[dates.length - 1] : undefined,
    });
  }

  // -- AI 创新产品 --
  private extractAiProducts(content: string, data: MemoBridgeData, dates: string[]): void {
    const lines = content.split('\n');
    let issueCount = 0;

    for (const line of lines) {
      const dateMatch = line.match(/^##\s+(20\d{2}-\d{2}-\d{2})/);
      if (dateMatch) {
        dates.push(dateMatch[1]);
        issueCount++;
      }
    }

    data.feeds.push({
      name: 'AI 创新产品日推',
      schedule: '08:15',
      description: '每日推送AI创新产品信息',
      total_issues: issueCount,
    });
  }

  // -- Generic automation --
  private extractGenericAutomation(
    dirName: string,
    content: string,
    data: MemoBridgeData,
    dates: string[],
  ): void {
    const firstLine = content.split('\n').find(l => l.startsWith('# '));
    const title = firstLine?.replace(/^#\s+/, '') || dirName;

    // Extract dates
    const dateMatches = content.match(/20\d{2}-\d{2}-\d{2}/g);
    if (dateMatches) {
      dates.push(...dateMatches);
    }

    data.feeds.push({
      name: title,
      total_issues: (content.match(/^##/gm) || []).length,
    });
  }

  // ============================================================
  // Daily memory file extraction
  // ============================================================

  private async extractMemoryFiles(
    wsPath: string,
    data: MemoBridgeData,
    dates: string[],
    _options: ExtractOptions,
  ): Promise<void> {
    const memoryDir = join(wsPath, '.memory');
    const files = await readdir(memoryDir).catch(() => [] as string[]);
    const mdFiles = files.filter(f => f.endsWith('.md')).sort();

    for (const file of mdFiles) {
      const content = await this.readFileSafe(join(memoryDir, file));
      if (!content) continue;

      const { redacted_content } = scanAndRedact(content);
      const fileName = basename(file, '.md');

      // Date-named files (2026-03-24.md) → work logs / daily memories
      const dateMatch = fileName.match(/^(20\d{2}-\d{2}-\d{2})$/);
      if (dateMatch) {
        dates.push(dateMatch[1]);
        this.extractWorkLog(dateMatch[1], redacted_content, data);
        continue;
      }

      // AI knowledge outputs (ai-knowledge-2026-04-08.md)
      if (fileName.startsWith('ai-knowledge-')) {
        // Already captured via automation memory, skip content duplication
        // but extract date
        const knowledgeDateMatch = fileName.match(/(20\d{2}-\d{2}-\d{2})/);
        if (knowledgeDateMatch) dates.push(knowledgeDateMatch[1]);
        continue;
      }

      // Word outputs (words-*.md, english-words-*.md)
      if (fileName.startsWith('words-') || fileName.startsWith('english-words-')) {
        const wordDateMatch = fileName.match(/(20\d{2}-\d{2}-\d{2})/);
        if (wordDateMatch) dates.push(wordDateMatch[1]);
        continue;
      }

      // Other .md files → raw memories
      data.raw_memories.push({
        id: `mem-${file}`,
        content: this.summarizeContent(redacted_content, 200),
        category: 'note',
        source: `.memory/${file}`,
        confidence: 0.7,
      });
    }
  }

  private extractWorkLog(date: string, content: string, data: MemoBridgeData): void {
    const lines = content.split('\n');
    const projects: string[] = [];

    for (const line of lines) {
      // H2 headers are project/task names
      const h2Match = line.match(/^## (.+)/);
      if (h2Match) {
        const title = h2Match[1].replace(/[📡🤖🧠💻🔬🕶️📊🔮]/g, '').trim();
        projects.push(title);
      }

      // Bullet points with key decisions or facts
      if (line.startsWith('- ') && (
        line.includes('推荐') || line.includes('核心') || line.includes('关键') ||
        line.includes('结论') || line.includes('完成') || line.includes('决策')
      )) {
        data.raw_memories.push({
          id: `worklog-${date}-${data.raw_memories.length}`,
          content: line.slice(2).trim(),
          category: 'work_log',
          source: `.memory/${date}.md`,
          confidence: 0.8,
          created_at: date,
        });
      }
    }

    // Detect project contexts from work logs
    for (const projectName of projects) {
      const existing = data.projects.find(p =>
        p.name === projectName ||
        p.name.includes(projectName) ||
        projectName.includes(p.name)
      );
      if (!existing && projectName.length > 2 && projectName.length < 50) {
        // Extract key insights from the section under this h2
        const sectionContent = this.extractSection(content, projectName);
        const insights = sectionContent
          .split('\n')
          .filter(l => l.startsWith('- '))
          .slice(0, 3)
          .map(l => l.slice(2).trim());

        if (insights.length > 0) {
          data.projects.push({
            name: projectName,
            status: 'active',
            key_insights: insights,
            updated_at: date,
          });
        }
      }
    }
  }

  // ============================================================
  // Profile inference
  // ============================================================

  private inferProfile(data: MemoBridgeData): void {
    // Infer from knowledge sections
    if (data.knowledge.some(k => k.title.includes('AI'))) {
      data.profile.identity['关注方向'] = 'AI Coding、具身智能、大模型';
    }
    if (data.knowledge.some(k => k.title.includes('英语'))) {
      data.profile.identity['学习目标'] = '英语词汇积累';
    }

    // Infer from feeds
    if (data.feeds.length > 0) {
      const schedules = data.feeds
        .filter(f => f.schedule)
        .map(f => `${f.name}(${f.schedule})`)
        .join(', ');
      if (schedules) {
        data.profile.work_patterns['每日推送'] = schedules;
      }
    }

    // Infer from projects
    const projectNames = data.projects.map(p => p.name).join(', ');
    if (projectNames) {
      data.profile.identity['项目经历'] = projectNames;
    }

    // Default preferences for CodeBuddy users
    data.profile.preferences['工具'] = 'CodeBuddy IDE';
    data.profile.preferences['输出语言'] = '中文为主';
  }

  // ============================================================
  // Utility methods
  // ============================================================

  private async readFileSafe(filePath: string): Promise<string | null> {
    try {
      return await readFile(filePath, 'utf-8');
    } catch {
      return null;
    }
  }

  private async dirExists(dirPath: string): Promise<boolean> {
    try {
      const s = await stat(dirPath);
      return s.isDirectory();
    } catch {
      return false;
    }
  }

  private summarizeContent(content: string, maxChars: number): string {
    const cleaned = content
      .replace(/^#+ .+$/gm, '') // Remove headers
      .replace(/^\s*[-*] /gm, '') // Remove list markers
      .replace(/\n{2,}/g, '\n')   // Collapse blank lines
      .trim();
    if (cleaned.length <= maxChars) return cleaned;
    return cleaned.slice(0, maxChars) + '...';
  }

  private extractSection(content: string, h2Title: string): string {
    const lines = content.split('\n');
    let capturing = false;
    const sectionLines: string[] = [];

    for (const line of lines) {
      if (line.includes(h2Title) && line.startsWith('## ')) {
        capturing = true;
        continue;
      }
      if (capturing) {
        if (line.startsWith('## ')) break; // Next section
        sectionLines.push(line);
      }
    }

    return sectionLines.join('\n');
  }

  private countTotal(data: MemoBridgeData): number {
    let count = data.raw_memories.length + data.projects.length + data.feeds.length;
    for (const section of data.knowledge) count += section.items.length;
    count += Object.keys(data.profile.identity).length;
    count += Object.keys(data.profile.preferences).length;
    count += Object.keys(data.profile.work_patterns).length;
    return count;
  }

  private countCategories(data: MemoBridgeData): number {
    const cats = new Set<string>();
    if (Object.keys(data.profile.identity).length) cats.add('profile');
    for (const k of data.knowledge) cats.add(`knowledge:${k.title}`);
    if (data.projects.length) cats.add('projects');
    if (data.feeds.length) cats.add('feeds');
    if (data.raw_memories.length) cats.add('raw');
    return cats.size;
  }
}
