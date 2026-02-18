import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ToolHandlers } from '../tools.js';
import { MockEmbedding } from './mock-embedding.js';
import { MockVectorDB } from './mock-vectordb.js';
import { StateManager } from '../state/snapshot.js';
import { normalizePath, pathToCollectionName } from '../paths.js';

// Mock the registry module to avoid filesystem deps
vi.mock('../state/registry.js', () => ({
  registerProject: vi.fn(),
  resolveProject: vi.fn(() => undefined),
  listProjects: vi.fn(() => ({})),
}));

// Mock indexer to avoid complex filesystem operations
vi.mock('../core/indexer.js', () => ({
  indexCodebase: vi.fn(async () => ({
    totalFiles: 5,
    totalChunks: 20,
    addedFiles: 5,
    modifiedFiles: 0,
    removedFiles: 0,
    skippedFiles: 0,
    parseFailures: [],
    estimatedTokens: 5000,
    estimatedCostUsd: 0.001,
    durationMs: 100,
  })),
  previewCodebase: vi.fn(async () => ({
    totalFiles: 10,
    byExtension: { '.ts': 8, '.js': 2 },
    topDirectories: [{ dir: 'src', count: 10 }],
    estimatedTokens: 10000,
    estimatedCostUsd: 0.002,
    warnings: [],
  })),
  deleteSnapshot: vi.fn(),
}));

// Use a real absolute path so normalizePath is a no-op
const TEST_PATH = normalizePath('/test/project');
const TEST_COL = pathToCollectionName(TEST_PATH);

describe('ToolHandlers', () => {
  let embedding: MockEmbedding;
  let vectordb: MockVectorDB;
  let state: StateManager;
  let handlers: ToolHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    embedding = new MockEmbedding();
    vectordb = new MockVectorDB();
    state = new StateManager();
    handlers = new ToolHandlers(embedding, vectordb, state);
  });

  describe('handleSearchCode', () => {
    it('returns error when query is missing', async () => {
      const result = await handlers.handleSearchCode({ path: TEST_PATH });
      expect(result.content[0].text).toContain('query');
    });

    it('returns error when path is missing', async () => {
      const result = await handlers.handleSearchCode({ query: 'test' });
      expect(result.content[0].text).toContain('Error');
    });

    it('returns results for valid query against indexed collection', async () => {
      await vectordb.createCollection(TEST_COL, 32);
      await vectordb.insert(TEST_COL, [{
        id: '1',
        content: 'function hello() { return "world"; }',
        vector: new Array(32).fill(0.1),
        relativePath: 'src/hello.ts',
        startLine: 1,
        endLine: 3,
        fileExtension: '.ts',
        language: 'typescript',
      }]);

      const result = await handlers.handleSearchCode({
        path: TEST_PATH,
        query: 'hello world',
      });
      expect(result.content[0].text).toBeDefined();
    });
  });

  describe('handleGetIndexingStatus', () => {
    it('reports not indexed when no state exists', async () => {
      const result = await handlers.handleGetIndexingStatus({ path: TEST_PATH });
      expect(result.content[0].text).toContain('not indexed');
    });

    it('reports indexed status', async () => {
      state.setIndexing(TEST_PATH, TEST_COL);
      state.setIndexed(TEST_PATH, 10, 50);
      const result = await handlers.handleGetIndexingStatus({ path: TEST_PATH });
      expect(result.content[0].text).toContain('indexed');
      expect(result.content[0].text).toContain('10');
    });

    it('reports progress during indexing', async () => {
      state.setIndexing(TEST_PATH, TEST_COL);
      state.updateProgress(TEST_PATH, 45, 'Processing files...');
      const result = await handlers.handleGetIndexingStatus({ path: TEST_PATH });
      expect(result.content[0].text).toContain('45%');
      expect(result.content[0].text).toContain('Processing files');
    });

    it('reports error state', async () => {
      state.setIndexing(TEST_PATH, TEST_COL);
      state.setError(TEST_PATH, 'Connection refused');
      const result = await handlers.handleGetIndexingStatus({ path: TEST_PATH });
      expect(result.content[0].text).toContain('error');
      expect(result.content[0].text).toContain('Connection refused');
    });
  });

  describe('handleListIndexed', () => {
    it('returns empty message when nothing indexed', async () => {
      const result = await handlers.handleListIndexed();
      expect(result.content[0].text).toContain('No codebases');
    });

    it('lists all indexed codebases', async () => {
      const pathA = normalizePath('/project-a');
      const pathB = normalizePath('/project-b');
      state.setIndexing(pathA, 'col_a');
      state.setIndexed(pathA, 5, 20);
      state.setIndexing(pathB, 'col_b');
      state.setIndexed(pathB, 10, 40);
      const result = await handlers.handleListIndexed();
      expect(result.content[0].text).toContain(pathA);
      expect(result.content[0].text).toContain(pathB);
    });
  });

  describe('handleClearIndex', () => {
    it('drops collection and removes state', async () => {
      await vectordb.createCollection(TEST_COL, 32);
      state.setIndexing(TEST_PATH, TEST_COL);
      state.setIndexed(TEST_PATH, 5, 20);

      const result = await handlers.handleClearIndex({ path: TEST_PATH });
      expect(result.content[0].text).toContain('cleared');
      expect(state.getState(TEST_PATH)).toBeUndefined();
    });

    it('returns error when path is missing', async () => {
      const result = await handlers.handleClearIndex({});
      expect(result.content[0].text).toContain('Error');
    });
  });
});
