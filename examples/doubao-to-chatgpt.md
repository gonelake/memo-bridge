# 迁移案例：豆包 → ChatGPT

本案例演示如何将豆包（Doubao）中积累的记忆导出，并导入到 ChatGPT，实现跨平台记忆迁移。

## 场景描述

用户长期使用豆包，AI 已积累了大量个人偏好、工作背景和使用习惯。现在需要在 ChatGPT 中继续工作，希望无缝继承已有上下文。

豆包和 ChatGPT 均为云端工具，无本地文件存储，因此使用「Prompt 引导」模式：先用特制提示词让豆包输出记忆，再生成"请记住"指令导入 ChatGPT。

---

## 操作步骤

### 第一步：生成豆包导出提示词

```bash
npx memo-bridge prompt --for doubao
```

输出的提示词（复制备用）：

```
# 豆包记忆导出

请将你目前记住的关于我的所有信息整理输出，包括：

1. 我的基本信息（姓名、职业、所在城市等你知道的）
2. 我的工作和项目背景
3. 我的个人偏好（沟通风格、回答长度、语言偏好等）
4. 你学到的关于我思维方式和工作习惯的内容
5. 我们讨论过的重要主题和结论

请用 Markdown 格式输出，每条信息用 - 开头，分类整理。
```

### 第二步：在豆包中导出记忆

1. 打开豆包对话
2. 粘贴上面的提示词，发送
3. 等待豆包整理并输出记忆内容，例如：

```markdown
以下是我记住的关于你的信息：

## 基本信息
- 姓名：Alice
- 职业：全栈工程师，主要使用 TypeScript / Node.js
- 所在地：上海

## 工作背景
- 目前在开发一个 AI 工具记忆迁移项目（MemoBridge）
- 擅长开源项目架构设计

## 个人偏好
- 喜欢简洁直接的回答，不需要过多铺垫
- 代码示例优先，解释为辅
- 使用中文回答

## 工作习惯
- 习惯使用 TDD（测试驱动开发）
- 代码审查时关注安全边界和错误处理
```

4. 将豆包的回复复制，保存为本地文件：

```bash
# 将复制的内容粘贴到文件（macOS 示例）
pbpaste > doubao-export.md
```

### 第三步：（可选）提取并整理中间格式

```bash
# 将豆包导出的纯文本解析为标准格式
npx memo-bridge extract --from doubao --input ./doubao-export.md
```

这会生成结构化的 `memo-bridge.md`，便于后续处理。

### 第四步：生成 ChatGPT 导入指令

```bash
npx memo-bridge import --to chatgpt --input ./doubao-export.md
```

输出（复制到 ChatGPT）：

```
请记住以下关于我的信息，并在后续所有对话中使用：

## 基本信息
- 姓名：Alice
- 职业：全栈工程师，TypeScript / Node.js
- 所在地：上海

## 工作背景
- 正在开发 AI 工具记忆迁移项目（MemoBridge）
- 擅长开源项目架构设计

## 个人偏好
- 简洁直接，不需要铺垫
- 代码示例优先
- 中文回答

## 工作习惯
- TDD 实践者
- 关注安全边界和错误处理

---

确认后请回复：「好的，我已记住以上信息。」
```

### 第五步：在 ChatGPT 中导入

1. 打开 ChatGPT 新对话
2. 粘贴上面生成的指令，发送
3. ChatGPT 确认记住后，记忆迁移完成

---

## 完整流程图

```
豆包对话
  │
  ├─ 1. 发送导出提示词（memo-bridge prompt --for doubao）
  ├─ 2. 复制 AI 回复 → doubao-export.md
  │
memo-bridge
  ├─ 3. 生成导入指令（memo-bridge import --to chatgpt）
  │
ChatGPT 对话
  └─ 4. 粘贴导入指令 → 记忆迁移完成
```

---

## 注意事项

**隐私保护**

`memo-bridge` 会在处理文件时自动扫描并脱敏敏感信息（API Key、邮箱、密码等）。建议在粘贴到 ChatGPT 前检查导出内容，确认无敏感数据。

**记忆的准确性**

豆包输出的记忆是 AI 的主观整理，可能有遗漏或偏差。建议阅读并手动校对后再导入。

**ChatGPT 记忆功能**

ChatGPT 的记忆功能需在设置中开启（Settings → Personalization → Memory → On）。导入后 ChatGPT 会将内容保存为持久记忆。

---

## 常见问题

**Q：豆包输出的格式不标准怎么办？**

`memo-bridge` 的解析器对格式有一定容忍度。或者直接将豆包原始输出保存为 `.md`，`import` 命令会尽力解析。

**Q：能直接从豆包迁移到 Claude Code 吗？**

可以。步骤相同，只需将第四步改为：

```bash
npx memo-bridge import --to claude-code --input ./doubao-export.md
```

这会直接写入 `~/.claude/CLAUDE.md`（本地工具，全自动）。
