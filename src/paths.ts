import path from 'node:path';
import os from 'node:os';
import { getConfig } from './config.js';

/**
 * Normalize a path to forward slashes, resolve to absolute, remove trailing slash.
 * This is the single source of truth for path handling — called at every boundary.
 */
export function normalizePath(inputPath: string): string {
  let resolved = inputPath;
  if (resolved.startsWith('~')) {
    resolved = path.join(os.homedir(), resolved.slice(1));
  }
  resolved = path.resolve(resolved);
  resolved = resolved.replace(/\\/g, '/');
  if (resolved.length > 1 && resolved.endsWith('/')) {
    resolved = resolved.slice(0, -1);
  }
  return resolved;
}

export function getDataDir(): string {
  return normalizePath(getConfig().eideticDataDir);
}

export function getSnapshotDir(): string {
  return `${getDataDir()}/snapshots`;
}

export function getCacheDir(): string {
  return `${getDataDir()}/cache`;
}

export function getRegistryPath(): string {
  return `${getDataDir()}/registry.json`;
}

export function pathToCollectionName(absolutePath: string): string {
  const normalized = normalizePath(absolutePath);
  const safe = normalized
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  return `eidetic_${safe}`;
}
