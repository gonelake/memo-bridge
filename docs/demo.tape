# MemoBridge — Demo GIF
# 生成命令：vhs docs/demo.tape
# 输出文件：docs/demo.gif

Output docs/demo.gif

# 画布设置：宽一点，字体大一点，视觉清晰
Set Width 900
Set Height 480
Set FontSize 15
Set FontFamily "JetBrains Mono"
Set Theme "Dracula"
Set Padding 20
Set PlaybackSpeed 1

# ─── 开场：检测工具 ───────────────────────────────────────────
Type "npx memo-bridge detect"
Sleep 500ms
Enter
Sleep 2s

# ─── 一键迁移：CodeBuddy → Claude Code ───────────────────────
Sleep 1s
Type "npx memo-bridge migrate --from codebuddy --to claude-code --dry-run"
Sleep 500ms
Enter
Sleep 3s

# ─── 查看备份列表 ─────────────────────────────────────────────
Sleep 1s
Type "npx memo-bridge backup list"
Sleep 500ms
Enter
Sleep 2s

# 停留让观众看清结果
Sleep 2s
