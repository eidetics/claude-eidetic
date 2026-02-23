import { describe, it, expect, vi, beforeEach } from 'vitest';
import { indexFiles } from '../targeted-indexer.js';
import type { VectorDB } from '../../vectordb/types.js';
import type { Embedding, EmbeddingVector } from '../../embedding/types.js';

vi.mock('../../paths.js', () => ({
  pathToCollectionName: (p: string) => `eidetic_${p.replace(/[^a-z0-9]/g, '_')}`,
  normalizePath: (p: string) => p,
  getSnapshotDir: () => '/tmp/snapshots',
  getDataDir: () => '/tmp',
}));

vi.mock('../../config.js', () => ({
  getConfig: () => ({
    indexingConcurrency: 5,
    embeddingBatchSize: 100,
  }),
}));

// vi.hoisted ensures these are available inside the hoisted vi.mock factory
const { mockFsReadFileSync } = vi.hoisted(() => ({
  mockFsReadFileSync: vi.fn(),
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    default: {
      ...(actual as unknown as Record<string, unknown>),
      readFileSync: mockFsReadFileSync,
    },
  };
});

vi.mock('../sync.js', () => ({
  extensionToLanguage: vi.fn().mockReturnValue('typescript'),
  buildSnapshot: vi.fn().mockReturnValue({ 'src/foo.ts': { contentHash: 'newhash' } }),
}));

vi.mock('../snapshot-io.js', () => ({
  loadSnapshot: vi.fn(),
  saveSnapshot: vi.fn(),
}));

// Mock splitters: AstSplitter returns one chunk, LineSplitter is fallback
vi.mock('../splitter/ast.js', async () => {
  await vi
    .importActual<typeof import('../../splitter/ast.js')>('../splitter/ast.js')
    .catch(() => ({}));
  return {
    AstSplitter: class {
      split(_code: string, _lang: string, filePath: string) {
        return [
          { content: 'chunk content', filePath, startLine: 1, endLine: 10, language: 'typescript' },
        ];
      }
    },
  };
});

vi.mock('../splitter/line.js', () => ({
  LineSplitter: class {
    split(_code: string, _lang: string, filePath: string) {
      return [
        { content: 'line chunk', filePath, startLine: 1, endLine: 5, language: 'typescript' },
      ];
    }
  },
}));

vi.mock('../file-category.js', () => ({
  classifyFileCategory: () => 'source',
}));

import { loadSnapshot, saveSnapshot } from '../snapshot-io.js';

const mockReadFileSync = mockFsReadFileSync;
const mockLoadSnapshot = vi.mocked(loadSnapshot);
const mockSaveSnapshot = vi.mocked(saveSnapshot);

function makeVectorDB(hasCollection = true): VectorDB {
  return {
    createCollection: vi.fn(),
    hasCollection: vi.fn().mockResolvedValue(hasCollection),
    dropCollection: vi.fn(),
    insert: vi.fn().mockResolvedValue(undefined),
    search: vi.fn(),
    deleteByPath: vi.fn().mockResolvedValue(undefined),
    getById: vi.fn(),
    updatePoint: vi.fn(),
    listSymbols: vi.fn(),
  };
}

function makeEmbedding(): Embedding {
  return {
    dimension: 1536,
    initialize: vi.fn(),
    embed: vi.fn(),
    embedBatch: vi.fn().mockResolvedValue([[0.1, 0.2, 0.3]] as EmbeddingVector[]),
    estimateTokens: vi.fn().mockReturnValue({ estimatedTokens: 100, estimatedCostUsd: 0.001 }),
  };
}

describe('indexFiles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns early with skipped count when collection does not exist', async () => {
    const vectordb = makeVectorDB(false);
    const embedding = makeEmbedding();

    const result = await indexFiles('/project', ['src/foo.ts'], embedding, vectordb);

    expect(result.processedFiles).toBe(0);
    expect(result.skippedFiles).toBe(1);
    expect(vectordb.deleteByPath).not.toHaveBeenCalled();
    expect(vectordb.insert).not.toHaveBeenCalled();
  });

  it('calls deleteByPath for every file regardless of existence', async () => {
    const vectordb = makeVectorDB();
    const embedding = makeEmbedding();
    mockReadFileSync.mockReturnValue('export const x = 1;' as unknown as Buffer);
    mockLoadSnapshot.mockReturnValue(null);

    await indexFiles('/project', ['src/foo.ts', 'src/bar.ts'], embedding, vectordb);

    expect(vectordb.deleteByPath).toHaveBeenCalledTimes(2);
    expect(vectordb.deleteByPath).toHaveBeenCalledWith(
      expect.stringContaining('eidetic_'),
      'src/foo.ts',
    );
    expect(vectordb.deleteByPath).toHaveBeenCalledWith(
      expect.stringContaining('eidetic_'),
      'src/bar.ts',
    );
  });

  it('skips re-embedding deleted files (ENOENT) but still deletes vectors', async () => {
    const vectordb = makeVectorDB();
    const embedding = makeEmbedding();

    const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    mockReadFileSync.mockImplementation(() => {
      throw enoent;
    });
    mockLoadSnapshot.mockReturnValue(null);

    const result = await indexFiles('/project', ['src/deleted.ts'], embedding, vectordb);

    expect(vectordb.deleteByPath).toHaveBeenCalledOnce();
    expect(vectordb.insert).not.toHaveBeenCalled();
    expect(result.skippedFiles).toBe(1);
    expect(result.processedFiles).toBe(0);
  });

  it('embeds and inserts chunks for existing files', async () => {
    const vectordb = makeVectorDB();
    const embedding = makeEmbedding();
    mockReadFileSync.mockReturnValue('export const x = 1;' as unknown as Buffer);
    mockLoadSnapshot.mockReturnValue(null);

    const result = await indexFiles('/project', ['src/foo.ts'], embedding, vectordb);

    expect(embedding.embedBatch).toHaveBeenCalledOnce();
    expect(vectordb.insert).toHaveBeenCalledOnce();
    expect(result.processedFiles).toBe(1);
    expect(result.totalChunks).toBe(1);
  });

  it('updates snapshot for processed files when snapshot exists', async () => {
    const vectordb = makeVectorDB();
    const embedding = makeEmbedding();
    mockReadFileSync.mockReturnValue('export const x = 1;' as unknown as Buffer);

    const existingSnapshot = {
      'src/foo.ts': { contentHash: 'oldhash' },
      'src/other.ts': { contentHash: 'stable' },
    };
    mockLoadSnapshot.mockReturnValue(existingSnapshot);

    await indexFiles('/project', ['src/foo.ts'], embedding, vectordb);

    expect(mockSaveSnapshot).toHaveBeenCalledOnce();
    const saved = mockSaveSnapshot.mock.calls[0][1];
    // Updated hash for processed file
    expect(saved['src/foo.ts']).toEqual({ contentHash: 'newhash' });
    // Untouched file preserved
    expect(saved['src/other.ts']).toEqual({ contentHash: 'stable' });
  });

  it('removes deleted files from snapshot', async () => {
    const vectordb = makeVectorDB();
    const embedding = makeEmbedding();

    const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    mockReadFileSync.mockImplementation(() => {
      throw enoent;
    });

    const existingSnapshot = {
      'src/deleted.ts': { contentHash: 'oldhash' },
      'src/other.ts': { contentHash: 'stable' },
    };
    mockLoadSnapshot.mockReturnValue(existingSnapshot);

    await indexFiles('/project', ['src/deleted.ts'], embedding, vectordb);

    expect(mockSaveSnapshot).toHaveBeenCalledOnce();
    const saved = mockSaveSnapshot.mock.calls[0][1];
    expect(saved).not.toHaveProperty('src/deleted.ts');
    expect(saved['src/other.ts']).toEqual({ contentHash: 'stable' });
  });

  it('skips snapshot update when no existing snapshot', async () => {
    const vectordb = makeVectorDB();
    const embedding = makeEmbedding();
    mockReadFileSync.mockReturnValue('export const x = 1;' as unknown as Buffer);
    mockLoadSnapshot.mockReturnValue(null);

    await indexFiles('/project', ['src/foo.ts'], embedding, vectordb);

    expect(mockSaveSnapshot).not.toHaveBeenCalled();
  });

  it('returns correct timing in durationMs', async () => {
    const vectordb = makeVectorDB(false);
    const embedding = makeEmbedding();

    const result = await indexFiles('/project', ['src/foo.ts'], embedding, vectordb);

    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});
