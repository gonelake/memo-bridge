/**
 * MemoBridge — Path security utilities
 * Prevents path traversal, symlink attacks, and writes to sensitive directories
 */

import { resolve, normalize, relative } from 'node:path';
import { lstat } from 'node:fs/promises';
import { homedir } from 'node:os';

/** Directories that must never be written to */
const FORBIDDEN_WRITE_DIRS = [
  '/etc', '/bin', '/sbin', '/usr', '/var', '/System',
  '/Library', '/boot', '/proc', '/sys', '/dev',
  '/Windows', '/Program Files', '/Program Files (x86)',
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
 * Ensures path is not in forbidden system directories.
 */
export function validateWritePath(targetPath: string): string {
  const resolved = sanitizePath(targetPath);

  // Block writes to system directories
  for (const forbidden of FORBIDDEN_WRITE_DIRS) {
    if (resolved.startsWith(forbidden + '/') || resolved === forbidden) {
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

  // Allow writes within home directory or /tmp
  if (resolved.startsWith(home) || resolved.startsWith('/tmp') || resolved.startsWith('/private/tmp')) {
    return resolved;
  }

  // Allow writes to current working directory and below
  const cwd = process.cwd();
  if (resolved.startsWith(cwd)) {
    return resolved;
  }

  throw new Error(
    `安全限制: 写入路径必须在用户主目录、当前目录或 /tmp 下。收到: ${resolved}`
  );
}
