/**
 * MemoBridge — Utility functions
 */

// fs.ts
export { readFile, writeFile, access, readdir, stat, mkdir } from 'node:fs/promises';
export { existsSync } from 'node:fs';
export { join, resolve, basename, dirname, extname } from 'node:path';
export { homedir } from 'node:os';
