/**
 * MemoBridge — Universal export prompt template
 */

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function getUniversalExportPrompt(_toolName?: string): string {
  return `请完整列出你关于我的所有记忆和了解。

按以下结构分类输出，每一条都尽可能详细：

1. 【身份信息】我的名字、职业、所在城市、行业
2. 【技术偏好】编程语言、常用工具、技术栈、操作系统
3. 【沟通风格】我喜欢什么样的回答方式、语言偏好、输出格式
4. 【项目上下文】我正在做的项目、关键决策、进展
5. 【兴趣方向】我关注的话题、学习目标
6. 【行为习惯】我的使用模式、常见请求类型、活跃时段
7. 【明确要求】我曾告诉你"请记住"的所有内容
8. 【纠正记录】我曾纠正你的内容（"不要这样做"类规则）

要求：
- 每条记忆单独一行，以"- "开头
- 标注确信程度：【确定】或【推测】
- 如果某个分类没有内容，写"- 无记录"
- 请用中文输出`;
}
