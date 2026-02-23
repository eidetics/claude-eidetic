import { scanFiles, buildSnapshot, diffSnapshots } from './sync.js';
import { loadSnapshot, saveSnapshot } from './snapshot-io.js';
import { pathToCollectionName } from '../paths.js';
import { IndexingError } from '../errors.js';
import type { VectorDB } from '../vectordb/types.js';

export interface CleanupResult {
  removedFiles: string[];
  totalRemoved: number;
  durationMs: number;
}

export async function cleanupVectors(
  rootPath: string,
  vectordb: VectorDB,
  onProgress?: (pct: number, msg: string) => void,
  customExtensions?: string[],
  customIgnorePatterns?: string[],
): Promise<CleanupResult> {
  const startTime = Date.now();

  const previousSnapshot = loadSnapshot(rootPath);
  if (!previousSnapshot) {
    throw new IndexingError(
      `No snapshot found for ${rootPath}. Index the codebase first before running cleanup.`,
    );
  }

  onProgress?.(10, 'Scanning files on disk...');
  const filePaths = await scanFiles(rootPath, customExtensions ?? [], customIgnorePatterns ?? []);

  onProgress?.(40, 'Building current snapshot...');
  const currentSnapshot = buildSnapshot(rootPath, filePaths);

  onProgress?.(60, 'Diffing snapshots...');
  const { removed } = diffSnapshots(previousSnapshot, currentSnapshot);

  if (removed.length === 0) {
    onProgress?.(100, 'No removed files found.');
    return { removedFiles: [], totalRemoved: 0, durationMs: Date.now() - startTime };
  }

  const collectionName = pathToCollectionName(rootPath);
  let deletedCount = 0;

  for (const rel of removed) {
    onProgress?.(
      60 + Math.round((deletedCount / removed.length) * 35),
      `Deleting vectors for ${rel}...`,
    );
    await vectordb.deleteByPath(collectionName, rel);
    deletedCount++;
  }

  // Save updated snapshot (removes the deleted file entries)
  const updatedSnapshot = { ...previousSnapshot };
  for (const rel of removed) {
    Reflect.deleteProperty(updatedSnapshot, rel);
  }
  saveSnapshot(rootPath, updatedSnapshot);

  onProgress?.(100, 'Cleanup complete.');

  return {
    removedFiles: removed,
    totalRemoved: removed.length,
    durationMs: Date.now() - startTime,
  };
}
