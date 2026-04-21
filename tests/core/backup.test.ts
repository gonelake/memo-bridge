import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, readFile, rm, stat, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createBackup,
  listBackups,
  restoreBackup,
  pruneBackups,
} from '../../src/core/backup.js';

// ---------------------------------------------------------------------------
// Test scaffolding
// ---------------------------------------------------------------------------

let testRoot: string;

beforeEach(async () => {
  testRoot = await mkdir(
    join(tmpdir(), `memobridge-backup-${Date.now()}-${Math.random().toString(36).slice(2)}`),
    { recursive: true },
  ).then(p => p!);
});

afterEach(async () => {
  await rm(testRoot, { recursive: true, force: true });
});

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// createBackup
// ---------------------------------------------------------------------------

describe('createBackup', () => {
  it('creates a backup folder under .memobridge/backups/<tool>-<ts>/', async () => {
    const file = join(testRoot, 'MEMORY.md');
    await writeFile(file, 'original content');

    const manifest = await createBackup({
      tool: 'hermes',
      targets: [file],
      root: testRoot,
    });

    expect(manifest.id).toMatch(/^hermes-\d{8}T\d{6}\d{3}[a-z0-9]{4}$/);
    expect(manifest.tool).toBe('hermes');
    expect(manifest.entries).toHaveLength(1);
    expect(manifest.entries[0]!.existed).toBe(true);

    const backupPath = join(testRoot, '.memobridge', 'backups', manifest.id, 'manifest.json');
    expect(await exists(backupPath)).toBe(true);
  });

  it('snapshots existing files and records entries', async () => {
    const f1 = join(testRoot, 'a.md');
    const f2 = join(testRoot, 'b.md');
    await writeFile(f1, 'content-a');
    await writeFile(f2, 'content-b');

    const manifest = await createBackup({
      tool: 'codebuddy',
      targets: [f1, f2],
      root: testRoot,
    });

    expect(manifest.entries).toHaveLength(2);
    for (const entry of manifest.entries) {
      expect(entry.existed).toBe(true);
      const snap = join(testRoot, '.memobridge', 'backups', manifest.id, entry.snapshot);
      expect(await exists(snap)).toBe(true);
    }

    // Snapshot content matches original
    const snap1 = join(testRoot, '.memobridge', 'backups', manifest.id, manifest.entries[0]!.snapshot);
    expect(await readFile(snap1, 'utf-8')).toBe('content-a');
  });

  it('records existed=false for targets that do not exist yet', async () => {
    const futureFile = join(testRoot, 'does-not-exist.md');

    const manifest = await createBackup({
      tool: 'claude-code',
      targets: [futureFile],
      root: testRoot,
    });

    expect(manifest.entries).toHaveLength(1);
    expect(manifest.entries[0]!.existed).toBe(false);
    expect(manifest.entries[0]!.snapshot).toBe('');
  });

  it('disambiguates same-basename files via path fingerprint', async () => {
    // Two different files with the same basename should not clobber each other
    const dirA = join(testRoot, 'a');
    const dirB = join(testRoot, 'b');
    await mkdir(dirA); await mkdir(dirB);
    const f1 = join(dirA, 'MEMORY.md');
    const f2 = join(dirB, 'MEMORY.md');
    await writeFile(f1, 'A');
    await writeFile(f2, 'B');

    const manifest = await createBackup({
      tool: 'openclaw',
      targets: [f1, f2],
      root: testRoot,
    });

    const [e1, e2] = manifest.entries;
    expect(e1!.snapshot).not.toBe(e2!.snapshot);

    const snap1 = await readFile(join(testRoot, '.memobridge', 'backups', manifest.id, e1!.snapshot), 'utf-8');
    const snap2 = await readFile(join(testRoot, '.memobridge', 'backups', manifest.id, e2!.snapshot), 'utf-8');
    expect(snap1).toBe('A');
    expect(snap2).toBe('B');
  });

  it('produces a valid JSON manifest', async () => {
    const file = join(testRoot, 'x.md');
    await writeFile(file, 'data');

    const manifest = await createBackup({
      tool: 'cursor',
      targets: [file],
      root: testRoot,
      workspace: '/some/workspace',
    });

    const manifestPath = join(testRoot, '.memobridge', 'backups', manifest.id, 'manifest.json');
    const parsed = JSON.parse(await readFile(manifestPath, 'utf-8'));
    expect(parsed.tool).toBe('cursor');
    expect(parsed.workspace).toBe('/some/workspace');
    expect(parsed.entries[0].original).toBe(file);
  });

  it('handles empty targets list (intent audit)', async () => {
    const manifest = await createBackup({
      tool: 'codebuddy',
      targets: [],
      root: testRoot,
    });
    expect(manifest.entries).toEqual([]);
    const manifestPath = join(testRoot, '.memobridge', 'backups', manifest.id, 'manifest.json');
    expect(await exists(manifestPath)).toBe(true);
  });

  it('generates unique ids for rapid back-to-back calls (anti-collision)', async () => {
    // Regression: millisecond-precision ids collided when multiple backups
    // landed in the same ms, silently overwriting each other. Each call
    // must yield a distinct folder even without time elapsing.
    const ids = await Promise.all([
      createBackup({ tool: 'hermes', targets: [], root: testRoot }),
      createBackup({ tool: 'hermes', targets: [], root: testRoot }),
      createBackup({ tool: 'hermes', targets: [], root: testRoot }),
      createBackup({ tool: 'hermes', targets: [], root: testRoot }),
      createBackup({ tool: 'hermes', targets: [], root: testRoot }),
    ]);
    const unique = new Set(ids.map(m => m.id));
    expect(unique.size).toBe(ids.length);
  });
});

// ---------------------------------------------------------------------------
// Symlink safety (P0-3)
//
// If an attacker can plant a symlink where an importer expects a real
// file (e.g. ~/.hermes/memories/MEMORY.md → /etc/passwd), createBackup
// must NOT follow it — otherwise the content of the symlink target ends
// up readable in the user-accessible backup directory. We treat symlinks
// as "does not exist" for backup purposes and record a warning.
// ---------------------------------------------------------------------------

describe('createBackup — symlink safety', () => {
  it('records existed=false for a target that is a symlink', async () => {
    const realFile = join(testRoot, 'real.md');
    await writeFile(realFile, 'secret data that must not leak');

    const link = join(testRoot, 'trapdoor.md');
    await symlink(realFile, link);

    const manifest = await createBackup({
      tool: 'hermes',
      targets: [link],
      root: testRoot,
    });

    expect(manifest.entries).toHaveLength(1);
    expect(manifest.entries[0]!.existed).toBe(false);
    expect(manifest.entries[0]!.snapshot).toBe('');
  });

  it('does not copy symlink target content into the backup directory', async () => {
    const realFile = join(testRoot, 'secret.md');
    await writeFile(realFile, 'TOP-SECRET-CONTENT');

    const link = join(testRoot, 'trapdoor.md');
    await symlink(realFile, link);

    const manifest = await createBackup({
      tool: 'cursor',
      targets: [link],
      root: testRoot,
    });

    // Scan the backup folder — no file in there should contain the secret
    const backupDir = join(testRoot, '.memobridge', 'backups', manifest.id);
    const { readdir } = await import('node:fs/promises');
    const entries = await readdir(backupDir);
    for (const e of entries) {
      if (e === 'manifest.json') continue;
      const contents = await readFile(join(backupDir, e), 'utf-8');
      expect(contents).not.toContain('TOP-SECRET-CONTENT');
    }
  });

  it('records a warning on the manifest when a target is a symlink', async () => {
    const realFile = join(testRoot, 'real.md');
    await writeFile(realFile, 'anything');
    const link = join(testRoot, 'trap.md');
    await symlink(realFile, link);

    const manifest = await createBackup({
      tool: 'hermes',
      targets: [link],
      root: testRoot,
    });

    expect(manifest.warnings ?? []).toEqual(
      expect.arrayContaining([expect.stringContaining('symlink')]),
    );
  });

  it('still snapshots regular files alongside rejected symlinks', async () => {
    const real = join(testRoot, 'real.md');
    await writeFile(real, 'ok');
    const secret = join(testRoot, 'secret.md');
    await writeFile(secret, 'HIDDEN');
    const link = join(testRoot, 'trap.md');
    await symlink(secret, link);

    const manifest = await createBackup({
      tool: 'openclaw',
      targets: [real, link],
      root: testRoot,
    });

    const realEntry = manifest.entries.find(e => e.original === real)!;
    const linkEntry = manifest.entries.find(e => e.original === link)!;
    expect(realEntry.existed).toBe(true);
    expect(linkEntry.existed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// listBackups
// ---------------------------------------------------------------------------

describe('listBackups', () => {
  it('returns [] when no backups exist', async () => {
    expect(await listBackups(testRoot)).toEqual([]);
  });

  it('returns all backups sorted newest-first', async () => {
    const f = join(testRoot, 'x.md');
    await writeFile(f, '1');

    const b1 = await createBackup({ tool: 'hermes', targets: [f], root: testRoot });
    // Ensure a different timestamp id. timestampId is millisecond-precision,
    // so a tiny sleep is enough.
    await new Promise(r => setTimeout(r, 20));
    const b2 = await createBackup({ tool: 'openclaw', targets: [f], root: testRoot });

    const list = await listBackups(testRoot);
    expect(list).toHaveLength(2);
    expect(list[0]!.id).toBe(b2.id);   // newest first
    expect(list[1]!.id).toBe(b1.id);
  });

  it('ignores folders with missing/malformed manifest', async () => {
    const f = join(testRoot, 'x.md');
    await writeFile(f, 'v');
    await createBackup({ tool: 'hermes', targets: [f], root: testRoot });

    // Injected corrupted folder
    const badDir = join(testRoot, '.memobridge', 'backups', 'corrupt-abc');
    await mkdir(badDir, { recursive: true });
    await writeFile(join(badDir, 'manifest.json'), '{ not json');

    // Injected empty folder
    await mkdir(join(testRoot, '.memobridge', 'backups', 'empty-xyz'), { recursive: true });

    const list = await listBackups(testRoot);
    expect(list).toHaveLength(1);  // only the real one
  });
});

// ---------------------------------------------------------------------------
// restoreBackup
// ---------------------------------------------------------------------------

describe('restoreBackup', () => {
  it('restores a file that existed at backup time', async () => {
    const file = join(testRoot, 'x.md');
    await writeFile(file, 'original');

    const manifest = await createBackup({
      tool: 'hermes',
      targets: [file],
      root: testRoot,
    });

    // Simulate the import mutating the file
    await writeFile(file, 'corrupted by import');

    const result = await restoreBackup(manifest.id, testRoot);
    expect(result.restored).toBe(1);
    expect(result.deleted).toBe(0);
    expect(await readFile(file, 'utf-8')).toBe('original');
  });

  it('deletes files that did not exist pre-import', async () => {
    const file = join(testRoot, 'was-absent.md');

    const manifest = await createBackup({
      tool: 'cursor',
      targets: [file],
      root: testRoot,
    });

    // Simulate the import creating the file
    await writeFile(file, 'created by import');

    const result = await restoreBackup(manifest.id, testRoot);
    expect(result.deleted).toBe(1);
    expect(await exists(file)).toBe(false);
  });

  it('skips if a "did not exist" file is still absent', async () => {
    const file = join(testRoot, 'phantom.md');

    const manifest = await createBackup({
      tool: 'cursor',
      targets: [file],
      root: testRoot,
    });

    const result = await restoreBackup(manifest.id, testRoot);
    expect(result.skipped).toBe(1);
    expect(result.deleted).toBe(0);
  });

  it('throws a clear error when backup id does not exist', async () => {
    await expect(restoreBackup('nonexistent-id', testRoot)).rejects.toThrow(/无法读取备份/);
  });

  it('handles mixed existed/absent entries in one restore', async () => {
    const was = join(testRoot, 'was.md');
    const willBe = join(testRoot, 'will-be.md');
    await writeFile(was, 'before');

    const manifest = await createBackup({
      tool: 'claude-code',
      targets: [was, willBe],
      root: testRoot,
    });

    await writeFile(was, 'after');
    await writeFile(willBe, 'newly created');

    const result = await restoreBackup(manifest.id, testRoot);
    expect(result.restored).toBe(1);
    expect(result.deleted).toBe(1);
    expect(await readFile(was, 'utf-8')).toBe('before');
    expect(await exists(willBe)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// pruneBackups
// ---------------------------------------------------------------------------

describe('pruneBackups', () => {
  it('keeps the newest N per tool and removes the rest', async () => {
    const f = join(testRoot, 'x.md');
    await writeFile(f, '.');

    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      const b = await createBackup({ tool: 'hermes', targets: [f], root: testRoot });
      ids.push(b.id);
      await new Promise(r => setTimeout(r, 20));
    }

    const removed = await pruneBackups(testRoot, 2);
    expect(removed.sort()).toEqual(ids.slice(0, 2).sort()); // oldest 2 removed

    const remaining = await listBackups(testRoot);
    expect(remaining.map(r => r.id).sort()).toEqual(ids.slice(2).sort());
  });

  it('prunes per-tool (keep N for EACH tool independently)', async () => {
    const f = join(testRoot, 'x.md');
    await writeFile(f, '.');

    for (let i = 0; i < 3; i++) {
      await createBackup({ tool: 'hermes', targets: [f], root: testRoot });
      await new Promise(r => setTimeout(r, 10));
    }
    for (let i = 0; i < 3; i++) {
      await createBackup({ tool: 'openclaw', targets: [f], root: testRoot });
      await new Promise(r => setTimeout(r, 10));
    }

    await pruneBackups(testRoot, 2);
    const remaining = await listBackups(testRoot);
    expect(remaining.filter(r => r.tool === 'hermes')).toHaveLength(2);
    expect(remaining.filter(r => r.tool === 'openclaw')).toHaveLength(2);
  });

  it('is a no-op when no backups exist', async () => {
    const removed = await pruneBackups(testRoot, 5);
    expect(removed).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Round-trip: backup → mutate → restore
// ---------------------------------------------------------------------------

describe('backup round-trip', () => {
  it('restores content byte-for-byte (incl. UTF-8)', async () => {
    const file = join(testRoot, 'unicode.md');
    const original = '你好，世界 🌉 ~ emoji + 中文';
    await writeFile(file, original, 'utf-8');

    const manifest = await createBackup({
      tool: 'codebuddy',
      targets: [file],
      root: testRoot,
    });

    await writeFile(file, 'destroyed', 'utf-8');
    await restoreBackup(manifest.id, testRoot);

    expect(await readFile(file, 'utf-8')).toBe(original);
  });
});
