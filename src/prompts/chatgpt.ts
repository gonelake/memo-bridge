/**
 * MemoBridge — ChatGPT export prompt
 */

export function getExportPrompt(): string {
  return `Please list ALL memories you have stored about me. I know ChatGPT has a Memory feature that saves information about users. Please output everything you remember.

Format each memory as a separate line:
- [Category] Content (Confidence: High/Medium/Low)

Categories to include:
1. Identity — name, job, location, industry
2. Technical — programming languages, tools, frameworks, OS
3. Communication — preferred response style, language, format
4. Projects — active projects, key decisions
5. Interests — topics I follow, learning goals
6. Habits — usage patterns, common request types
7. Explicit rules — things I asked you to remember
8. Corrections — things I told you NOT to do

Requirements:
- One memory per line
- Include ALL stored memories, not a summary
- Include uncertain/inferred memories with Low confidence
- If a category has no memories, write "- [Category] No memories stored"
- Output in the language I typically use with you`;
}
