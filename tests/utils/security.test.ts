import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, writeFile, symlink, rm, mkdir } from 'node:fs/promises';
import { tmpdir, homedir, platform } from 'node:os';
import { join, resolve } from 'node:path';
import {
  sanitizePath,
  validateWritePath,
  validatePathInBase,
  isNotSymlink,
  validateContentSize,
  getHomeScopedPath,
  MAX_READ_SIZE,
  MAX_WRITE_SIZE,
} from '../../src/utils/security.js';

const isWindows = platform() === 'win32';

// ---------------------------------------------------------------------------
// sanitizePath
// ---------------------------------------------------------------------------

describe('sanitizePath', () => {
  it('returns an absolute path', () => {
    const out = sanitizePath('./some/relative/path');
    expect(out).toBe(resolve('./some/relative/path'));
  });

  it('normalizes traversal (..) segments within the resolved path', () => {
    const out = sanitizePath('/a/b/../c');
    expect(out).toBe(resolve('/a/c'));
  });

  it('leaves absolute paths untouched', () => {
    const out = sanitizePath('/tmp/foo/bar');
    expect(out).toBe(resolve('/tmp/foo/bar'));
  });

  it('throws on empty string', () => {
    expect(() => sanitizePath('')).toThrowError(/路径不能为空/);
  });

  it('throws on non-string input', () => {
    // @ts-expect-error — testing runtime guard
    expect(() => sanitizePath(null)).toThrowError(/路径不能为空/);
    // @ts-expect-error
    expect(() => sanitizePath(undefined)).toThrowError(/路径不能为空/);
    // @ts-expect-error
    expect(() => sanitizePath(123)).toThrowError(/路径不能为空/);
  });

  it('throws when the path contains a null byte', () => {
    expect(() => sanitizePath('/tmp/foo\0bar')).toThrowError(/非法字符/);
  });
});

// ---------------------------------------------------------------------------
// validateWritePath
// ---------------------------------------------------------------------------

describe('validateWritePath', () => {
  it.skipIf(isWindows)('blocks writes to /etc and its subpaths', () => {
    expect(() => validateWritePath('/etc')).toThrowError(/系统目录 \/etc/);
    expect(() => validateWritePath('/etc/passwd')).toThrowError(/系统目录 \/etc/);
  });

  it.skipIf(isWindows)('blocks writes to other unix system dirs', () => {
    for (const dir of ['/bin/ls', '/sbin/foo', '/usr/local/bin/x', '/var/log/m.log', '/System/foo', '/Library/x']) {
      expect(() => validateWritePath(dir)).toThrowError(/系统目录/);
    }
  });

  it.skipIf(isWindows)('allows macOS temp exceptions under /var', () => {
    // os.tmpdir() returns /var/folders/... on macOS — must be writable even
    // though /var itself is in FORBIDDEN_WRITE_DIRS.
    expect(() => validateWritePath('/var/folders/zz/abc/T/x.md')).not.toThrow();
    expect(() => validateWritePath('/var/tmp/x.md')).not.toThrow();
    expect(() => validateWritePath('/private/var/folders/zz/abc/T/x.md')).not.toThrow();
    expect(() => validateWritePath('/private/tmp/x.md')).not.toThrow();
  });

  it('allows writes to os.tmpdir() (the runtime default)', () => {
    // This exercises the real-world path that the CLI's --output default
    // would hit when a user passes a tmp path.
    expect(() => validateWritePath(join(tmpdir(), 'ok.md'))).not.toThrow();
  });

  it('allows writes to home-scoped paths', () => {
    expect(() => validateWritePath(join(homedir(), '.memobridge', 'out.md'))).not.toThrow();
  });

  it('returns the resolved absolute path', () => {
    const out = validateWritePath(join(homedir(), 'ok.md'));
    expect(out).toBe(resolve(join(homedir(), 'ok.md')));
  });

  it('propagates sanitizePath errors (null byte, empty)', () => {
    expect(() => validateWritePath('')).toThrowError(/路径不能为空/);
    expect(() => validateWritePath('/tmp/a\0b')).toThrowError(/非法字符/);
  });

  it.skipIf(isWindows)('does NOT reject paths that only share a prefix with a forbidden dir', () => {
    // /etcetera is NOT /etc; /usrlocal is NOT /usr. Must check boundary.
    expect(() => validateWritePath('/etcetera/file')).not.toThrow();
    expect(() => validateWritePath('/usrlocal/file')).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// validatePathInBase
// ---------------------------------------------------------------------------

describe('validatePathInBase', () => {
  it('accepts a path nested inside base', () => {
    const base = '/tmp/work';
    const out = validatePathInBase('/tmp/work/sub/file.md', base);
    expect(out).toBe(resolve('/tmp/work/sub/file.md'));
  });

  it('accepts base itself', () => {
    const base = '/tmp/work';
    const out = validatePathInBase('/tmp/work', base);
    expect(out).toBe(resolve('/tmp/work'));
  });

  it('rejects paths that escape via ..', () => {
    const base = '/tmp/work';
    expect(() => validatePathInBase('/tmp/work/../other', base))
      .toThrowError(/不在允许范围/);
  });

  it('rejects unrelated absolute paths', () => {
    expect(() => validatePathInBase('/etc/passwd', '/tmp/work'))
      .toThrowError(/不在允许范围/);
  });

  it('rejects sibling paths that share a common prefix', () => {
    // /tmp/workshop is outside /tmp/work
    expect(() => validatePathInBase('/tmp/workshop/file', '/tmp/work'))
      .toThrowError(/不在允许范围/);
  });
});

// ---------------------------------------------------------------------------
// isNotSymlink — uses real tmp filesystem
// ---------------------------------------------------------------------------

describe('isNotSymlink', () => {
  let tmpRoot: string;
  let regularFile: string;
  let regularDir: string;
  let linkedFile: string;
  let danglingLink: string;

  beforeAll(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), 'memobridge-sec-'));
    regularFile = join(tmpRoot, 'regular.txt');
    regularDir = join(tmpRoot, 'regular-dir');
    linkedFile = join(tmpRoot, 'link.txt');
    danglingLink = join(tmpRoot, 'dangling.txt');

    await writeFile(regularFile, 'hello');
    await mkdir(regularDir);
    await symlink(regularFile, linkedFile);
    await symlink(join(tmpRoot, 'does-not-exist'), danglingLink);
  });

  afterAll(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it('returns true for a regular file', async () => {
    expect(await isNotSymlink(regularFile)).toBe(true);
  });

  it('returns true for a regular directory', async () => {
    expect(await isNotSymlink(regularDir)).toBe(true);
  });

  it('returns false for a symlink pointing to a valid target', async () => {
    expect(await isNotSymlink(linkedFile)).toBe(false);
  });

  it('returns false for a dangling symlink', async () => {
    expect(await isNotSymlink(danglingLink)).toBe(false);
  });

  it('returns true for a non-existent path (safe to create)', async () => {
    expect(await isNotSymlink(join(tmpRoot, 'never-existed.txt'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// validateContentSize
// ---------------------------------------------------------------------------

describe('validateContentSize', () => {
  it('accepts content within the default limit', () => {
    expect(() => validateContentSize('hello')).not.toThrow();
    expect(() => validateContentSize('')).not.toThrow();
    expect(() => validateContentSize('x'.repeat(1_000_000))).not.toThrow(); // 1MB
  });

  it('rejects content above the default limit (5MB)', () => {
    const oversized = 'x'.repeat(MAX_WRITE_SIZE + 1);
    expect(() => validateContentSize(oversized)).toThrowError(/超过上限/);
  });

  it('accepts a custom limit', () => {
    expect(() => validateContentSize('hello world', 100)).not.toThrow();
    expect(() => validateContentSize('x'.repeat(101), 100)).toThrowError(/超过上限/);
  });

  it('measures byte length (not char count) — multi-byte chars', () => {
    // Each Chinese char is 3 bytes in utf-8; "中" = 3 bytes
    // 40 chars = 120 bytes
    const chinese = '中'.repeat(40);
    expect(() => validateContentSize(chinese, 100)).toThrowError(/超过上限/);
    expect(() => validateContentSize(chinese, 200)).not.toThrow();
  });

  it('error message shows MB values', () => {
    const oversized = 'x'.repeat(MAX_WRITE_SIZE + 1);
    try {
      validateContentSize(oversized);
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as Error).message).toMatch(/MB/);
    }
  });
});

// ---------------------------------------------------------------------------
// getHomeScopedPath
// ---------------------------------------------------------------------------

describe('getHomeScopedPath', () => {
  it('allows paths under homedir', () => {
    const p = join(homedir(), '.memobridge', 'output.md');
    expect(getHomeScopedPath(p)).toBe(resolve(p));
  });

  it('allows paths under /tmp', () => {
    const p = '/tmp/memobridge-test.md';
    expect(getHomeScopedPath(p)).toBe(resolve(p));
  });

  it('allows paths under /private/tmp (macOS)', () => {
    const p = '/private/tmp/foo.md';
    expect(getHomeScopedPath(p)).toBe(resolve(p));
  });

  it('allows paths under os.tmpdir() (macOS /var/folders/...)', () => {
    const p = join(tmpdir(), 'scoped.md');
    expect(getHomeScopedPath(p)).toBe(resolve(p));
  });

  it('allows paths under current working directory', () => {
    const p = join(process.cwd(), 'subdir', 'file.md');
    expect(getHomeScopedPath(p)).toBe(resolve(p));
  });

  it.skipIf(isWindows)('rejects arbitrary system paths', () => {
    expect(() => getHomeScopedPath('/etc/passwd')).toThrowError(/写入路径必须在/);
    expect(() => getHomeScopedPath('/var/log/x.log')).toThrowError(/写入路径必须在/);
  });

  it('propagates sanitizePath errors', () => {
    expect(() => getHomeScopedPath('')).toThrowError(/路径不能为空/);
    expect(() => getHomeScopedPath('/tmp/a\0b')).toThrowError(/非法字符/);
  });
});

// ---------------------------------------------------------------------------
// Exported size constants
// ---------------------------------------------------------------------------

describe('size constants', () => {
  it('MAX_READ_SIZE is 10MB', () => {
    expect(MAX_READ_SIZE).toBe(10 * 1024 * 1024);
  });

  it('MAX_WRITE_SIZE is 5MB', () => {
    expect(MAX_WRITE_SIZE).toBe(5 * 1024 * 1024);
  });
});
