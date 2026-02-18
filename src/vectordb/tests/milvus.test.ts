import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isSparseUnsupportedError } from '../milvus.js';
import { VectorDBError } from '../../errors.js';

// ── Hoisted mock client (available inside vi.mock factories) ─────────────────

const mockClient = vi.hoisted(() => ({
  createCollection: vi.fn().mockResolvedValue({}),
  createIndex: vi.fn().mockResolvedValue({}),
  hasCollection: vi.fn().mockResolvedValue({ value: false }),
  dropCollection: vi.fn().mockResolvedValue({}),
  loadCollection: vi.fn().mockResolvedValue({}),
  getLoadState: vi.fn().mockResolvedValue({ state: 'LoadStateLoaded' }),
  insert: vi.fn().mockResolvedValue({}),
  search: vi.fn().mockResolvedValue({ results: [] }),
  delete: vi.fn().mockResolvedValue({}),
  describeCollection: vi.fn().mockResolvedValue({ schema: { fields: [] } }),
}));

// ── Mock the Milvus SDK (dynamic import) ─────────────────────────────────────

vi.mock('@zilliz/milvus2-sdk-node', () => ({
  MilvusClient: class FakeMilvusClient {
    constructor() { Object.assign(this, mockClient); }
  },
  DataType: {
    VarChar: 21,
    FloatVector: 101,
    SparseFloatVector: 104,
    Int64: 5,
  },
  MetricType: { COSINE: 'COSINE', BM25: 'BM25' },
  FunctionType: { BM25: 1 },
  LoadState: { LoadStateLoaded: 'LoadStateLoaded' },
}));

vi.mock('../../config.js', () => ({
  getConfig: () => ({
    milvusAddress: 'localhost:19530',
    milvusToken: undefined,
  }),
}));

// ── Import after mocks ──────────────────────────────────────────────────────

const { MilvusVectorDB } = await import('../milvus.js');

// ── Tests ────────────────────────────────────────────────────────────────────

describe('isSparseUnsupportedError', () => {
  it('detects "data type 104" error', () => {
    expect(isSparseUnsupportedError({ reason: 'data type: 104 not supported' })).toBe(true);
    expect(isSparseUnsupportedError({ reason: 'Data Type 104 is not valid' })).toBe(true);
  });

  it('detects "not supported" + "104" combination', () => {
    expect(isSparseUnsupportedError({ reason: '104 not supported' })).toBe(true);
  });

  it('returns false for unrelated errors', () => {
    expect(isSparseUnsupportedError(new Error('connection refused'))).toBe(false);
    expect(isSparseUnsupportedError('random string')).toBe(false);
    expect(isSparseUnsupportedError(null)).toBe(false);
  });
});

describe('MilvusVectorDB', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset defaults
    mockClient.hasCollection.mockResolvedValue({ value: false });
    mockClient.getLoadState.mockResolvedValue({ state: 'LoadStateLoaded' });
    mockClient.search.mockResolvedValue({ results: [] });
    mockClient.describeCollection.mockResolvedValue({ schema: { fields: [] } });
  });

  // ── createCollection ─────────────────────────────────────────────────────

  describe('createCollection', () => {
    it('creates hybrid collection when sparse is supported', async () => {
      const db = new MilvusVectorDB();
      await db.createCollection('test_col', 128);

      // Should call createCollection, createIndex (2x for dense + sparse), loadCollection
      expect(mockClient.createCollection).toHaveBeenCalledTimes(1);
      expect(mockClient.createIndex).toHaveBeenCalledTimes(2);
      expect(mockClient.loadCollection).toHaveBeenCalled();
    });

    it('falls back to dense-only when sparse is unsupported', async () => {
      // First createCollection call (hybrid) fails with sparse error
      mockClient.createCollection
        .mockRejectedValueOnce({ reason: 'data type: 104 not supported' })
        .mockResolvedValueOnce({});

      const db = new MilvusVectorDB();
      await db.createCollection('test_col', 128);

      // Called twice: failed hybrid + successful dense-only
      expect(mockClient.createCollection).toHaveBeenCalledTimes(2);
      // dropCollection called to clean up failed hybrid attempt
      expect(mockClient.dropCollection).toHaveBeenCalled();
    });

    it('throws VectorDBError for non-sparse errors', async () => {
      mockClient.createCollection.mockRejectedValue(new Error('connection refused'));

      const db = new MilvusVectorDB();
      await expect(db.createCollection('test_col', 128)).rejects.toThrow(VectorDBError);
    });
  });

  // ── hasCollection ────────────────────────────────────────────────────────

  describe('hasCollection', () => {
    it('returns true when collection exists', async () => {
      mockClient.hasCollection.mockResolvedValue({ value: true });
      const db = new MilvusVectorDB();
      expect(await db.hasCollection('test_col')).toBe(true);
    });

    it('returns false when collection does not exist', async () => {
      mockClient.hasCollection.mockResolvedValue({ value: false });
      const db = new MilvusVectorDB();
      expect(await db.hasCollection('test_col')).toBe(false);
    });

    it('returns false on client error', async () => {
      mockClient.hasCollection.mockRejectedValue(new Error('timeout'));
      const db = new MilvusVectorDB();
      expect(await db.hasCollection('test_col')).toBe(false);
    });
  });

  // ── dropCollection ───────────────────────────────────────────────────────

  describe('dropCollection', () => {
    it('drops collection when it exists', async () => {
      mockClient.hasCollection.mockResolvedValue({ value: true });
      const db = new MilvusVectorDB();
      await db.dropCollection('test_col');
      expect(mockClient.dropCollection).toHaveBeenCalledWith({ collection_name: 'test_col' });
    });

    it('does nothing when collection does not exist', async () => {
      mockClient.hasCollection.mockResolvedValue({ value: false });
      const db = new MilvusVectorDB();
      await db.dropCollection('test_col');
      expect(mockClient.dropCollection).not.toHaveBeenCalled();
    });

    it('throws VectorDBError on failure', async () => {
      mockClient.hasCollection.mockResolvedValue({ value: true });
      mockClient.dropCollection.mockRejectedValue(new Error('permission denied'));
      const db = new MilvusVectorDB();
      await expect(db.dropCollection('test_col')).rejects.toThrow(VectorDBError);
    });
  });

  // ── insert ───────────────────────────────────────────────────────────────

  describe('insert', () => {
    it('inserts documents with correct fields', async () => {
      const db = new MilvusVectorDB();
      await db.insert('test_col', [{
        id: 'doc1',
        content: 'function hello() {}',
        vector: [0.1, 0.2],
        relativePath: 'src/hello.ts',
        startLine: 1,
        endLine: 3,
        fileExtension: '.ts',
        language: 'typescript',
      }]);

      expect(mockClient.insert).toHaveBeenCalledWith({
        collection_name: 'test_col',
        data: [{
          id: 'doc1',
          content: 'function hello() {}',
          vector: [0.1, 0.2],
          relativePath: 'src/hello.ts',
          startLine: 1,
          endLine: 3,
          fileExtension: '.ts',
          language: 'typescript',
        }],
      });
    });

    it('skips empty documents array', async () => {
      const db = new MilvusVectorDB();
      await db.insert('test_col', []);
      expect(mockClient.insert).not.toHaveBeenCalled();
    });

    it('throws VectorDBError on failure', async () => {
      mockClient.insert.mockRejectedValue(new Error('quota exceeded'));
      const db = new MilvusVectorDB();
      await expect(db.insert('test_col', [{
        id: 'x', content: 'x', vector: [0], relativePath: 'x',
        startLine: 0, endLine: 0, fileExtension: '.ts', language: 'ts',
      }])).rejects.toThrow(VectorDBError);
    });
  });

  // ── search ───────────────────────────────────────────────────────────────

  describe('search', () => {
    it('returns mapped results for dense-only collection', async () => {
      // describeCollection returns no sparse_vector field → dense-only
      mockClient.describeCollection.mockResolvedValue({
        schema: { fields: [{ name: 'vector' }, { name: 'content' }] },
      });
      mockClient.search.mockResolvedValue({
        results: [{
          content: 'function hello() {}',
          relativePath: 'src/hello.ts',
          startLine: 1,
          endLine: 3,
          fileExtension: '.ts',
          language: 'typescript',
          score: 0.95,
        }],
      });

      const db = new MilvusVectorDB();
      const results = await db.search('test_col', {
        queryVector: [0.1, 0.2],
        queryText: 'hello',
        limit: 10,
      });

      expect(results).toHaveLength(1);
      expect(results[0].content).toBe('function hello() {}');
      expect(results[0].score).toBe(0.95);
    });

    it('uses hybrid search when sparse_vector field exists', async () => {
      mockClient.describeCollection.mockResolvedValue({
        schema: { fields: [{ name: 'vector' }, { name: 'sparse_vector' }] },
      });
      mockClient.search.mockResolvedValue({ results: [] });

      const db = new MilvusVectorDB();
      await db.search('test_col', {
        queryVector: [0.1],
        queryText: 'test',
        limit: 5,
      });

      // Hybrid search sends data array with 2 entries (dense + sparse)
      const callArgs = mockClient.search.mock.calls[0][0];
      expect(callArgs.data).toHaveLength(2);
      expect(callArgs.rerank).toBeDefined();
    });

    it('builds extension filter expression', async () => {
      mockClient.search.mockResolvedValue({ results: [] });

      const db = new MilvusVectorDB();
      await db.search('test_col', {
        queryVector: [0.1],
        queryText: 'test',
        limit: 10,
        extensionFilter: ['.ts', '.js'],
      });

      const callArgs = mockClient.search.mock.calls[0][0];
      expect(callArgs.expr).toContain('fileExtension in');
      expect(callArgs.expr).toContain('.ts');
      expect(callArgs.expr).toContain('.js');
    });

    it('returns empty array when no results', async () => {
      mockClient.search.mockResolvedValue({ results: [] });
      const db = new MilvusVectorDB();
      const results = await db.search('test_col', {
        queryVector: [0.1],
        queryText: 'xyz',
        limit: 10,
      });
      expect(results).toEqual([]);
    });

    it('defaults missing fields in result mapping', async () => {
      mockClient.search.mockResolvedValue({
        results: [{ score: 0.5 }], // missing all other fields
      });

      const db = new MilvusVectorDB();
      const results = await db.search('test_col', {
        queryVector: [0.1],
        queryText: 'test',
        limit: 10,
      });

      expect(results[0].content).toBe('');
      expect(results[0].relativePath).toBe('');
      expect(results[0].startLine).toBe(0);
      expect(results[0].language).toBe('');
    });

    it('throws VectorDBError on search failure', async () => {
      mockClient.search.mockRejectedValue(new Error('timeout'));
      const db = new MilvusVectorDB();
      await expect(db.search('test_col', {
        queryVector: [0.1],
        queryText: 'test',
        limit: 10,
      })).rejects.toThrow(VectorDBError);
    });
  });

  // ── deleteByPath ─────────────────────────────────────────────────────────

  describe('deleteByPath', () => {
    it('sends delete with correct filter', async () => {
      const db = new MilvusVectorDB();
      await db.deleteByPath('test_col', 'src/hello.ts');

      expect(mockClient.delete).toHaveBeenCalledWith({
        collection_name: 'test_col',
        filter: 'relativePath == "src/hello.ts"',
      });
    });

    it('escapes backslashes and quotes in path', async () => {
      const db = new MilvusVectorDB();
      await db.deleteByPath('test_col', 'src\\path with"quotes.ts');

      const callArgs = mockClient.delete.mock.calls[0][0];
      expect(callArgs.filter).toContain('src\\\\path with\\"quotes.ts');
    });

    it('throws VectorDBError on failure', async () => {
      mockClient.delete.mockRejectedValue(new Error('not found'));
      const db = new MilvusVectorDB();
      await expect(db.deleteByPath('test_col', 'x.ts')).rejects.toThrow(VectorDBError);
    });
  });

  // ── detectHybrid caching ─────────────────────────────────────────────────

  describe('hybrid detection caching', () => {
    it('caches hybrid detection after first search', async () => {
      mockClient.describeCollection.mockResolvedValue({
        schema: { fields: [{ name: 'vector' }, { name: 'sparse_vector' }] },
      });
      mockClient.search.mockResolvedValue({ results: [] });

      const db = new MilvusVectorDB();
      await db.search('test_col', { queryVector: [0.1], queryText: 'a', limit: 1 });
      await db.search('test_col', { queryVector: [0.1], queryText: 'b', limit: 1 });

      // describeCollection should only be called once (cached on second search)
      expect(mockClient.describeCollection).toHaveBeenCalledTimes(1);
    });
  });
});
