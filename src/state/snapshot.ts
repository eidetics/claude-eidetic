import fs from 'node:fs';
import path from 'node:path';
import { getSnapshotDir } from '../paths.js';
import type { VectorDB } from '../vectordb/types.js';

export type CodebaseStatus = 'idle' | 'indexing' | 'indexed' | 'error';

export interface CodebaseState {
  path: string;
  collectionName: string;
  status: CodebaseStatus;
  lastIndexed?: string;   // ISO timestamp
  totalFiles?: number;
  totalChunks?: number;
  error?: string;
  progress?: number;       // 0-100
  progressMessage?: string;
}

export class StateManager {
  private states = new Map<string, CodebaseState>();

  getState(normalizedPath: string): CodebaseState | undefined {
    return this.states.get(normalizedPath);
  }

  getAllStates(): CodebaseState[] {
    return [...this.states.values()];
  }

  setIndexing(normalizedPath: string, collectionName: string): void {
    this.states.set(normalizedPath, {
      path: normalizedPath,
      collectionName,
      status: 'indexing',
      progress: 0,
      progressMessage: 'Starting...',
    });
  }

  updateProgress(normalizedPath: string, progress: number, message: string): void {
    const state = this.states.get(normalizedPath);
    if (state) {
      state.progress = progress;
      state.progressMessage = message;
    }
  }

  setIndexed(normalizedPath: string, totalFiles: number, totalChunks: number): void {
    const state = this.states.get(normalizedPath);
    if (state) {
      state.status = 'indexed';
      state.lastIndexed = new Date().toISOString();
      state.totalFiles = totalFiles;
      state.totalChunks = totalChunks;
      state.progress = 100;
      state.progressMessage = 'Done';
    }
  }

  setError(normalizedPath: string, error: string): void {
    const state = this.states.get(normalizedPath);
    if (state) {
      state.status = 'error';
      state.error = error;
    }
  }

  remove(normalizedPath: string): void {
    this.states.delete(normalizedPath);
  }

  markExisting(normalizedPath: string, collectionName: string): void {
    this.states.set(normalizedPath, {
      path: normalizedPath,
      collectionName,
      status: 'indexed',
      lastIndexed: 'unknown (pre-existing)',
    });
  }
}

export async function cleanupOrphanedSnapshots(vectordb: VectorDB): Promise<number> {
  const snapshotDir = getSnapshotDir();
  let cleaned = 0;

  try {
    if (!fs.existsSync(snapshotDir)) return 0;

    const files = fs.readdirSync(snapshotDir).filter(f => f.endsWith('.json'));
    if (files.length === 0) return 0;

    // Connectivity probe: use a name unlikely to exist. If hasCollection throws
    // or the vector DB is unreachable (Qdrant's hasCollection returns false on
    // network error), we must not proceed -- deleting snapshots when we cannot
    // confirm collection absence would destroy valid state.
    const probeResult = await vectordb.hasCollection('__eidetic_connectivity_probe__');
    // If the probe returns true for a name that should never exist, something is
    // wrong -- skip cleanup to be safe.
    if (probeResult) {
      console.warn('Orphan cleanup skipped: connectivity probe returned unexpected result.');
      return 0;
    }

    for (const file of files) {
      const collectionName = path.basename(file, '.json');
      try {
        const exists = await vectordb.hasCollection(collectionName);
        if (!exists) {
          const filePath = path.join(snapshotDir, file);
          fs.unlinkSync(filePath);
          console.log(`Cleaned orphaned snapshot: ${collectionName}`);
          cleaned++;
        }
      } catch (err) {
        // Network error for this specific check -- skip rather than risk deletion
        console.warn(`Skipping orphan check for ${collectionName}: ${err}`);
      }
    }
  } catch (err) {
    // Connectivity probe failure or filesystem error -- skip cleanup entirely
    console.warn(`Orphan cleanup skipped: ${err}`);
  }

  return cleaned;
}
