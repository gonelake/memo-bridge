/**
 * MemoBridge — Path security utilities
 * Prevents path traversal, symlink attacks, and writes to sensitive directories
 */

import { resolve, normalize, relative, sep } from 'node:path';
import { lstat } from 'node:fs/promises';
import { homedir, platform } from 'node:os';

/** Directories that must never be written to */
const FORBIDDEN_WRITE_DIRS = [
  '/etc', '/bin', '/sbin', '/usr', '/var', '/System',
  '/Library', '/boot', '/proc', '/sys', '/dev',
  '/Windows', '/Program Files', '/Program Files (x86)',
];

/**
 * Explicit exceptions to FORBIDDEN_WRITE_DIRS. These are subtrees under
 * forbidden roots that are known-safe for user writes (e.g. OS-managed
 * temp directories). Checked as prefix matches before rejection.
 */
const WRITE_EXCEPTIONS = [
  '/var/folders/',   // macOS per-user temp (os.tmpdir() lives here)
  '/var/tmp/',       // traditional unix temp
  '/private/var/folders/', // macOS with /private prefix
  '/private/tmp/',   // macOS /tmp is a symlink to this
];

/** Max file size we'll read (10 MB) */
export const MAX_READ_SIZE = 10 * 1024 * 1024;

/** Max file size we'll write (5 MB) */
export const MAX_WRITE_SIZE = 5 * 1024 * 1024;

/**
 * Resolve and normalize a user-provided path, checking for traversal attacks.
 * Returns the resolved absolute path.
 */
export function sanitizePath(inputPath: string): string {
  if (!inputPath || typeof inputPath !== 'string') {
    throw new Error('路径不能为空');
  }

  // Normalize and resolve to absolute
  const resolved = resolve(normalize(inputPath));

  // Check for null bytes (path injection)
  if (resolved.includes('\0')) {
    throw new Error('路径包含非法字符');
  }

  return resolved;
}

/**
 * Validate that a write target is safe.
 * Ensures path is not in forbidden system directories, except for known
 * user-safe subtrees listed in WRITE_EXCEPTIONS (e.g. /var/folders/ on macOS).
 *
 * On Windows the filesystem is case-insensitive, so comparisons are
 * normalized to lowercase to prevent trivial bypass like "c:\program files"
 * vs "C:\Program Files".
 */
export function validateWritePath(targetPath: string): string {
  const resolved = sanitizePath(targetPath);
  const caseInsensitive = platform() === 'win32';
  const compare = caseInsensitive ? resolved.toLowerCase() : resolved;

  // Allow explicit exceptions under forbidden roots (e.g. macOS temp)
  for (const allowed of WRITE_EXCEPTIONS) {
    const needle = caseInsensitive ? allowed.toLowerCase() : allowed;
    if (compare.startsWith(needle)) {
      return resolved;
    }
  }

  // Block writes to system directories
  for (const forbidden of FORBIDDEN_WRITE_DIRS) {
    const needle = caseInsensitive ? forbidden.toLowerCase() : forbidden;
    if (compare.startsWith(needle + sep) || compare.startsWith(needle + '/') || compare === needle) {
      throw new Error(`安全限制: 禁止写入系统目录 ${forbidden}`);
    }
  }

  return resolved;
}

/**
 * Validate that a write path is within an expected base directory.
 * Used for workspace-scoped operations.
 */
export function validatePathInBase(targetPath: string, basePath: string): string {
  const resolvedTarget = sanitizePath(targetPath);
  const resolvedBase = sanitizePath(basePath);

  const rel = relative(resolvedBase, resolvedTarget);
  // If relative path starts with '..' or is absolute, it escaped the base
  if (rel.startsWith('..') || resolve(rel) === rel) {
    throw new Error(`安全限制: 路径 ${targetPath} 不在允许范围 ${basePath} 内`);
  }

  return resolvedTarget;
}

/**
 * Check if a path is a symbolic link (potential symlink attack).
 * Returns true if it's a real file/directory, false if it's a symlink.
 */
export async function isNotSymlink(filePath: string): Promise<boolean> {
  try {
    const stats = await lstat(filePath);
    return !stats.isSymbolicLink();
  } catch {
    // Path doesn't exist yet — safe to create
    return true;
  }
}

/**
 * Validate content size before writing
 */
export function validateContentSize(content: string, maxSize: number = MAX_WRITE_SIZE): void {
  const byteLength = Buffer.byteLength(content, 'utf-8');
  if (byteLength > maxSize) {
    throw new Error(
      `安全限制: 内容大小 ${(byteLength / 1024 / 1024).toFixed(1)}MB 超过上限 ${(maxSize / 1024 / 1024).toFixed(1)}MB`
    );
  }
}

/**
 * Get safe write paths (home directory scope)
 */
export function getHomeScopedPath(subPath: string): string {
  const home = homedir();
  const resolved = sanitizePath(subPath);

  // Allow writes within home directory, OS temp locations, or cwd
  const tempPrefixes = ['/tmp/', '/private/tmp/', '/var/folders/', '/private/var/folders/', '/var/tmp/'];
  if (resolved.startsWith(home)) return resolved;
  for (const prefix of tempPrefixes) {
    // Match both "prefix/..." and the exact "prefix without trailing slash" case
    if (resolved.startsWith(prefix) || resolved === prefix.slice(0, -1)) {
      return resolved;
    }
  }

  // Allow writes to current working directory and below
  const cwd = process.cwd();
  if (resolved.startsWith(cwd)) {
    return resolved;
  }

  throw new Error(
    `安全限制: 写入路径必须在用户主目录、当前目录或临时目录下。收到: ${resolved}`
  );
}
