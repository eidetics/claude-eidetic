import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanupVectors } from '../cleanup.js';
import type { VectorDB } from '../../vectordb/types.js';

// Mock the dependencies
vi.mock('../sync.js', () => ({
  scanFiles: vi.fn(),
  buildSnapshot: vi.fn(),
  diffSnapshots: vi.fn(),
}));

vi.mock('../snapshot-io.js', () => ({
  loadSnapshot: vi.fn(),
  saveSnapshot: vi.fn(),
}));

vi.mock('../../paths.js', () => ({
  pathToCollectionName: (p: string) => `eidetic_${p.replace(/[^a-z0-9]/g, '_')}`,
  normalizePath: (p: string) => p,
  getSnapshotDir: () => '/tmp/snapshots',
  getDataDir: () => '/tmp',
}));

import { scanFiles, buildSnapshot, diffSnapshots } from '../sync.js';
import { loadSnapshot, saveSnapshot } from '../snapshot-io.js';

const mockScanFiles = vi.mocked(scanFiles);
const mockBuildSnapshot = vi.mocked(buildSnapshot);
const mockDiffSnapshots = vi.mocked(diffSnapshots);
const mockLoadSnapshot = vi.mocked(loadSnapshot);
const mockSaveSnapshot = vi.mocked(saveSnapshot);

function makeVectorDB(): VectorDB {
  return {
    createCollection: vi.fn(),
    hasCollection: vi.fn(),
    dropCollection: vi.fn(),
    insert: vi.fn(),
    search: vi.fn(),
    deleteByPath: vi.fn().mockResolvedValue(undefined),
    getById: vi.fn(),
    updatePoint: vi.fn(),
    listSymbols: vi.fn(),
  };
}

describe('cleanupVectors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws when no previous snapshot exists', async () => {
    mockLoadSnapshot.mockReturnValue(null);

    const vectordb = makeVectorDB();
    await expect(cleanupVectors('/test/root', vectordb)).rejects.toThrow(
      'No snapshot found',
    );
  });

  it('calls deleteByPath for each removed file', async () => {
    const previousSnapshot = {
      'src/a.ts': { contentHash: 'abc' },
      'src/b.ts': { contentHash: 'def' },
      'src/c.ts': { contentHash: 'ghi' },
    };
    const currentSnapshot = {
      'src/c.ts': { contentHash: 'ghi' },
    };

    mockLoadSnapshot.mockReturnValue(previousSnapshot);
    mockScanFiles.mockResolvedValue(['src/c.ts']);
    mockBuildSnapshot.mockReturnValue(currentSnapshot);
    mockDiffSnapshots.mockReturnValue({
      added: [],
      modified: [],
      removed: ['src/a.ts', 'src/b.ts'],
    });

    const vectordb = makeVectorDB();
    const result = await cleanupVectors('/test/root', vectordb);

    expect(vectordb.deleteByPath).toHaveBeenCalledTimes(2);
    expect(vectordb.deleteByPath).toHaveBeenCalledWith(
      expect.stringContaining('eidetic_'),
      'src/a.ts',
    );
    expect(vectordb.deleteByPath).toHaveBeenCalledWith(
      expect.stringContaining('eidetic_'),
      'src/b.ts',
    );
    expect(result.removedFiles).toEqual(['src/a.ts', 'src/b.ts']);
    expect(result.totalRemoved).toBe(2);
  });

  it('saves updated snapshot with removed files excluded', async () => {
    const previousSnapshot = {
      'src/a.ts': { contentHash: 'abc' },
      'src/b.ts': { contentHash: 'def' },
    };
    const currentSnapshot = {
      'src/b.ts': { contentHash: 'def' },
    };

    mockLoadSnapshot.mockReturnValue(previousSnapshot);
    mockScanFiles.mockResolvedValue(['src/b.ts']);
    mockBuildSnapshot.mockReturnValue(currentSnapshot);
    mockDiffSnapshots.mockReturnValue({
      added: [],
      modified: [],
      removed: ['src/a.ts'],
    });

    const vectordb = makeVectorDB();
    await cleanupVectors('/test/root', vectordb);

    expect(mockSaveSnapshot).toHaveBeenCalledOnce();
    const savedSnapshot = mockSaveSnapshot.mock.calls[0][1];
    expect(savedSnapshot).not.toHaveProperty('src/a.ts');
    expect(savedSnapshot).toHaveProperty('src/b.ts');
  });

  it('returns zero removed files when nothing has been deleted', async () => {
    const snapshot = { 'src/a.ts': { contentHash: 'abc' } };

    mockLoadSnapshot.mockReturnValue(snapshot);
    mockScanFiles.mockResolvedValue(['src/a.ts']);
    mockBuildSnapshot.mockReturnValue(snapshot);
    mockDiffSnapshots.mockReturnValue({ added: [], modified: [], removed: [] });

    const vectordb = makeVectorDB();
    const result = await cleanupVectors('/test/root', vectordb);

    expect(vectordb.deleteByPath).not.toHaveBeenCalled();
    expect(mockSaveSnapshot).not.toHaveBeenCalled();
    expect(result.totalRemoved).toBe(0);
    expect(result.removedFiles).toHaveLength(0);
  });

  it('calls onProgress callback during execution', async () => {
    const previousSnapshot = { 'src/a.ts': { contentHash: 'abc' } };
    const currentSnapshot = {};

    mockLoadSnapshot.mockReturnValue(previousSnapshot);
    mockScanFiles.mockResolvedValue([]);
    mockBuildSnapshot.mockReturnValue(currentSnapshot);
    mockDiffSnapshots.mockReturnValue({ added: [], modified: [], removed: ['src/a.ts'] });

    const vectordb = makeVectorDB();
    const progressCalls: [number, string][] = [];
    const onProgress = (pct: number, msg: string) => { progressCalls.push([pct, msg]); };

    await cleanupVectors('/test/root', vectordb, onProgress);

    expect(progressCalls.length).toBeGreaterThan(0);
    expect(progressCalls[progressCalls.length - 1][0]).toBe(100);
  });
});
