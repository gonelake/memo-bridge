/**
 * MemoBridge — Privacy scanner
 * Detects and redacts sensitive information (API keys, passwords, tokens)
 */

interface PatternDef {
  name: string;
  pattern: RegExp;
  replacement: string;
}

/**
 * Create a fresh RegExp instance to avoid lastIndex state leakage.
 * Using /g flag with shared regex objects causes bugs when calling .test() or .match()
 * multiple times — the lastIndex is retained between calls.
 */
function getPatterns(): PatternDef[] {
  return [
    { name: 'OpenAI API Key', pattern: /sk-[a-zA-Z0-9]{20,}/g, replacement: 'sk-***REDACTED***' },
    { name: 'Anthropic API Key', pattern: /sk-ant-[a-zA-Z0-9-]{20,}/g, replacement: 'sk-ant-***REDACTED***' },
    { name: 'GitHub Token', pattern: /ghp_[a-zA-Z0-9]{36,}/g, replacement: 'ghp_***REDACTED***' },
    { name: 'GitHub Token (fine-grained)', pattern: /github_pat_[a-zA-Z0-9_]{20,}/g, replacement: 'github_pat_***REDACTED***' },
    { name: 'AWS Access Key', pattern: /AKIA[A-Z0-9]{16}/g, replacement: 'AKIA***REDACTED***' },
    { name: 'AWS Secret Key', pattern: /(?:aws_secret_access_key|secret_access_key)\s*[:=]\s*["']?[A-Za-z0-9/+=]{30,}["']?/gi, replacement: '***AWS_SECRET_REDACTED***' },
    { name: 'Bearer Token', pattern: /Bearer\s+[a-zA-Z0-9._\-]{20,}/g, replacement: 'Bearer ***REDACTED***' },
    { name: 'Authorization Header', pattern: /Authorization\s*:\s*(?:Bearer|Basic|Digest)\s+[A-Za-z0-9._\-+/=]{16,}/gi, replacement: 'Authorization: ***REDACTED***' },
    { name: 'Custom API Header', pattern: /X-[A-Za-z][A-Za-z0-9-]*(?:[Kk]ey|[Tt]oken|[Aa]uth|[Ss]ecret)\s*:\s*[^\s"'\n]{16,}/g, replacement: '***CUSTOM_HEADER_REDACTED***' },
    { name: 'Generic API Key', pattern: /(?:api[_-]?key|apikey|api[_-]?token|api[_-]?secret)\s*[:=]\s*["']?[a-zA-Z0-9._\-]{16,}["']?/gi, replacement: '***API_KEY_REDACTED***' },
    { name: 'Password', pattern: /(?:password|passwd|pwd)\s*[:=]\s*["']?[^\s"'\n]{8,}["']?/gi, replacement: '***PASSWORD_REDACTED***' },
    { name: 'Database Connection String', pattern: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^:\s]+:[^@\s]+@[^\s"'`)]+/gi, replacement: '***DB_CONNECTION_REDACTED***' },
    { name: 'SSH Private Key', pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/g, replacement: '***SSH_KEY_REDACTED***' },
    { name: 'Telegram Bot Token', pattern: /\d{8,10}:[a-zA-Z0-9_-]{35}/g, replacement: '***TELEGRAM_TOKEN_REDACTED***' },
    { name: 'Google Cloud Key', pattern: /AIza[a-zA-Z0-9_-]{35}/g, replacement: '***GOOGLE_KEY_REDACTED***' },
    { name: 'Slack Token', pattern: /xox[bpors]-[a-zA-Z0-9-]{10,}/g, replacement: '***SLACK_TOKEN_REDACTED***' },
    { name: 'Private IP', pattern: /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})\b/g, replacement: '***PRIVATE_IP***' },
    { name: 'Email Address', pattern: /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g, replacement: '***EMAIL_REDACTED***' },
  ];
}

export interface ScanResult {
  found: boolean;
  redacted_content: string;
  detections: Array<{ name: string; count: number }>;
}

/**
 * Build PatternDefs from user-supplied regex strings. Invalid patterns are
 * dropped silently (caller is expected to have already warned at config
 * load time); this function never throws so it's safe on hot paths.
 *
 * Every user pattern is forced to global-flag so redact covers all
 * occurrences, and labeled uniformly as "Custom Pattern" (replacement
 * tag). We intentionally don't let users pick labels in v0.2 to keep the
 * config surface small — they can always pre-format the pattern if they
 * want a specific replacement.
 */
function buildUserPatterns(extraPatterns: readonly string[]): PatternDef[] {
  const out: PatternDef[] = [];
  for (const raw of extraPatterns) {
    try {
      // Ensure 'g' flag for bulk replace; dedupe by adding only if missing.
      const source = raw.trim();
      if (!source) continue;
      const re = new RegExp(source, 'g');
      out.push({ name: 'Custom Pattern', pattern: re, replacement: '***CUSTOM_REDACTED***' });
    } catch {
      // Invalid regex — skip. Caller may have already warned.
    }
  }
  return out;
}

/**
 * Scan content for sensitive information and return redacted version.
 * Creates fresh regex instances per call to avoid lastIndex state issues.
 *
 * v0.2 — `extraPatterns` appends user-supplied regex sources (from
 * .memobridge.yaml) to the built-in list. Built-in patterns run first,
 * then custom ones, so custom rules can target whatever remains.
 */
export function scanAndRedact(content: string, extraPatterns: readonly string[] = []): ScanResult {
  let redacted = content;
  const detections: Array<{ name: string; count: number }> = [];

  const allPatterns = [...getPatterns(), ...buildUserPatterns(extraPatterns)];
  for (const { name, pattern, replacement } of allPatterns) {
    const matches = redacted.match(pattern);
    if (matches && matches.length > 0) {
      detections.push({ name, count: matches.length });
      redacted = redacted.replace(pattern, replacement);
    }
  }

  return {
    found: detections.length > 0,
    redacted_content: redacted,
    detections,
  };
}

/**
 * Check if content contains sensitive information (without redacting).
 * Creates fresh regex instances per call.
 */
export function hasSensitiveInfo(content: string): boolean {
  return getPatterns().some(({ pattern }) => pattern.test(content));
}
