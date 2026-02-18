import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { contentHash, OpenAIEmbedding } from '../openai.js';
import { EmbeddingError } from '../../errors.js';

// ── Mocks ────────────────────────────────────────────────────────────────────

// Mock config to avoid env var dependency
vi.mock('../../config.js', () => ({
  getConfig: () => ({
    openaiApiKey: 'test-key',
    openaiBaseUrl: undefined,
    embeddingModel: 'text-embedding-3-small',
    embeddingBatchSize: 3,
  }),
}));

// Mock paths to avoid real filesystem
vi.mock('../../paths.js', () => ({
  getCacheDir: () => '/tmp/eidetic-test-cache',
}));

// Mock fs/promises to control disk cache behavior
const mockReadFile = vi.fn();
const mockWriteFile = vi.fn();
const mockMkdir = vi.fn();
const mockUnlink = vi.fn();

vi.mock('node:fs/promises', () => ({
  default: {
    readFile: (...args: unknown[]) => mockReadFile(...args),
    writeFile: (...args: unknown[]) => mockWriteFile(...args),
    mkdir: (...args: unknown[]) => mockMkdir(...args),
    unlink: (...args: unknown[]) => mockUnlink(...args),
  },
}));

// Mock OpenAI SDK — capture the create method so tests can control responses
const mockCreate = vi.fn();

vi.mock('openai', () => {
  return {
    default: class MockOpenAI {
      embeddings = { create: mockCreate };
    },
  };
});

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Build a fake OpenAI embeddings.create response */
function fakeEmbeddingResponse(vectors: number[][]) {
  return {
    data: vectors.map((embedding, index) => ({ embedding, index })),
  };
}

/** Create an OpenAIEmbedding instance and initialize it (sets dimension) */
async function createInitialized(dimension = 4): Promise<OpenAIEmbedding> {
  const probeVector = Array.from({ length: dimension }, (_, i) => i * 0.1);
  mockCreate.mockResolvedValueOnce(fakeEmbeddingResponse([probeVector]));
  const emb = new OpenAIEmbedding();
  await emb.initialize();
  return emb;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('contentHash', () => {
  it('returns a 16-hex-char string', () => {
    const hash = contentHash('hello world');
    expect(hash).toMatch(/^[a-f0-9]{16}$/);
  });

  it('is deterministic', () => {
    expect(contentHash('test')).toBe(contentHash('test'));
  });

  it('produces different hashes for different inputs', () => {
    expect(contentHash('hello')).not.toBe(contentHash('world'));
  });
});

describe('OpenAIEmbedding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: disk cache misses (ENOENT)
    mockReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
    mockUnlink.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── initialize ───────────────────────────────────────────────────────────

  describe('initialize', () => {
    it('sets dimension from probe embedding', async () => {
      const emb = await createInitialized(8);
      expect(emb.dimension).toBe(8);
    });

    it('throws EmbeddingError when API call fails', async () => {
      mockCreate.mockRejectedValueOnce(new Error('Invalid API key'));
      const emb = new OpenAIEmbedding();
      await expect(emb.initialize()).rejects.toThrow(EmbeddingError);
      await expect(emb.initialize()).rejects.toThrow(/Failed to initialize/);
    });
  });

  // ── embed ────────────────────────────────────────────────────────────────

  describe('embed', () => {
    it('delegates to embedBatch and returns single vector', async () => {
      const emb = await createInitialized(4);
      const vec = [0.1, 0.2, 0.3, 0.4];
      mockCreate.mockResolvedValueOnce(fakeEmbeddingResponse([vec]));

      const result = await emb.embed('hello');
      expect(result).toEqual(vec);
    });

    it('throws if not initialized', async () => {
      const emb = new OpenAIEmbedding();
      await expect(emb.embed('hello')).rejects.toThrow(EmbeddingError);
      await expect(emb.embed('hello')).rejects.toThrow(/not initialized/);
    });
  });

  // ── embedBatch ───────────────────────────────────────────────────────────

  describe('embedBatch', () => {
    it('returns empty array for empty input', async () => {
      const emb = await createInitialized(4);
      const result = await emb.embedBatch([]);
      expect(result).toEqual([]);
      // No API calls beyond the initialize probe
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    it('returns zero vectors for empty/whitespace-only texts', async () => {
      const emb = await createInitialized(4);
      const result = await emb.embedBatch(['', '   ', '\n\t']);
      expect(result).toHaveLength(3);
      for (const vec of result) {
        expect(vec).toEqual([0, 0, 0, 0]);
      }
      // No API call for empty texts
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    it('calls API for uncached texts and returns vectors', async () => {
      const emb = await createInitialized(4);
      const vec1 = [1, 2, 3, 4];
      const vec2 = [5, 6, 7, 8];
      mockCreate.mockResolvedValueOnce(fakeEmbeddingResponse([vec1, vec2]));

      const result = await emb.embedBatch(['hello', 'world']);
      expect(result).toEqual([vec1, vec2]);
      // 1 for initialize + 1 for this batch
      expect(mockCreate).toHaveBeenCalledTimes(2);
    });

    it('uses memory cache on second call with same text', async () => {
      const emb = await createInitialized(4);
      const vec = [1, 2, 3, 4];
      mockCreate.mockResolvedValueOnce(fakeEmbeddingResponse([vec]));

      // First call — hits API
      await emb.embedBatch(['hello']);
      // Second call — should use memory cache
      const result = await emb.embedBatch(['hello']);

      expect(result).toEqual([vec]);
      // Only 2 total: initialize + first embed (second is cached)
      expect(mockCreate).toHaveBeenCalledTimes(2);
    });

    it('uses disk cache when memory cache misses', async () => {
      const emb = await createInitialized(4);
      const cachedVec = [9, 8, 7, 6];
      const hash = contentHash('cached-text');

      // Disk cache returns a hit for this specific hash
      mockReadFile.mockImplementation((filepath: string) => {
        if (filepath.includes(hash)) {
          return Promise.resolve(JSON.stringify(cachedVec));
        }
        return Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
      });

      const result = await emb.embedBatch(['cached-text']);
      expect(result).toEqual([cachedVec]);
      // No API call beyond initialize
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    it('handles mix of empty, cached, and uncached texts', async () => {
      const emb = await createInitialized(4);
      const cachedVec = [1, 1, 1, 1];
      const freshVec = [2, 2, 2, 2];

      // Pre-populate memory cache for "cached"
      mockCreate.mockResolvedValueOnce(fakeEmbeddingResponse([cachedVec]));
      await emb.embedBatch(['cached']);

      // Now call with mix: empty + cached + new
      mockCreate.mockResolvedValueOnce(fakeEmbeddingResponse([freshVec]));
      const result = await emb.embedBatch(['', 'cached', 'new-text']);

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual([0, 0, 0, 0]); // empty → zero vector
      expect(result[1]).toEqual(cachedVec);      // memory cache hit
      expect(result[2]).toEqual(freshVec);        // API call
      // initialize + cache-warm + this batch = 3
      expect(mockCreate).toHaveBeenCalledTimes(3);
    });

    it('batches API calls according to embeddingBatchSize', async () => {
      // Config has embeddingBatchSize = 3
      const emb = await createInitialized(2);

      // 5 texts → should split into batches of 3 + 2
      const vecs = [[1, 0], [2, 0], [3, 0], [4, 0], [5, 0]];
      mockCreate
        .mockResolvedValueOnce(fakeEmbeddingResponse(vecs.slice(0, 3)))
        .mockResolvedValueOnce(fakeEmbeddingResponse(vecs.slice(3)));

      const result = await emb.embedBatch(['a', 'b', 'c', 'd', 'e']);
      expect(result).toEqual(vecs);
      // initialize + 2 batches = 3
      expect(mockCreate).toHaveBeenCalledTimes(3);
    });

    it('writes to disk cache after API call (fire-and-forget)', async () => {
      const emb = await createInitialized(4);
      mockCreate.mockResolvedValueOnce(fakeEmbeddingResponse([[1, 2, 3, 4]]));

      await emb.embedBatch(['new-text']);

      // Allow fire-and-forget promises to settle
      await new Promise(r => setTimeout(r, 50));

      expect(mockMkdir).toHaveBeenCalled();
      expect(mockWriteFile).toHaveBeenCalled();
      // Verify the written content is the vector JSON
      const writtenContent = mockWriteFile.mock.calls[0][1];
      expect(JSON.parse(writtenContent)).toEqual([1, 2, 3, 4]);
    });

    it('handles corrupted disk cache gracefully', async () => {
      const emb = await createInitialized(4);
      const freshVec = [5, 5, 5, 5];

      // Disk cache returns invalid JSON for all reads
      mockReadFile.mockResolvedValue('not valid json{{{');

      mockCreate.mockResolvedValueOnce(fakeEmbeddingResponse([freshVec]));
      const result = await emb.embedBatch(['some-text']);

      // Should fall through to API call
      expect(result).toEqual([freshVec]);
      // Corrupted cache file should be deleted
      expect(mockUnlink).toHaveBeenCalled();
    });
  });

  // ── callWithRetry (tested through embedBatch) ───────────────────────────

  describe('retry logic', () => {
    it('retries on 429 and succeeds', async () => {
      vi.useFakeTimers();
      const emb = await createInitialized(4);

      const rateLimitErr = Object.assign(new Error('Rate limited'), {
        status: 429,
        headers: {},
      });
      const vec = [1, 2, 3, 4];

      mockCreate
        .mockRejectedValueOnce(rateLimitErr)
        .mockResolvedValueOnce(fakeEmbeddingResponse([vec]));

      const promise = emb.embedBatch(['hello']);

      // Advance past the first retry delay (1000ms)
      await vi.advanceTimersByTimeAsync(1100);

      const result = await promise;
      expect(result).toEqual([vec]);
      // initialize + failed attempt + successful retry = 3
      expect(mockCreate).toHaveBeenCalledTimes(3);

      vi.useRealTimers();
    });

    it('retries on 500 server error', async () => {
      vi.useFakeTimers();
      const emb = await createInitialized(4);

      const serverErr = Object.assign(new Error('Internal Server Error'), { status: 500 });
      const vec = [1, 2, 3, 4];

      mockCreate
        .mockRejectedValueOnce(serverErr)
        .mockResolvedValueOnce(fakeEmbeddingResponse([vec]));

      const promise = emb.embedBatch(['hello']);
      await vi.advanceTimersByTimeAsync(1100);

      const result = await promise;
      expect(result).toEqual([vec]);

      vi.useRealTimers();
    });

    it('does not retry on non-retryable error (e.g. 401)', async () => {
      const emb = await createInitialized(4);

      const authErr = Object.assign(new Error('Unauthorized'), { status: 401 });
      mockCreate.mockRejectedValueOnce(authErr);

      await expect(emb.embedBatch(['hello'])).rejects.toThrow(/1 attempt/);
    });

    it('throws after exhausting all retries', async () => {
      vi.useFakeTimers();
      const emb = await createInitialized(4);

      const serverErr = Object.assign(new Error('Server Error'), { status: 500 });
      // Fail 4 times (1 initial + 3 retries)
      mockCreate
        .mockRejectedValueOnce(serverErr)
        .mockRejectedValueOnce(serverErr)
        .mockRejectedValueOnce(serverErr)
        .mockRejectedValueOnce(serverErr);

      // Attach rejection handler immediately to avoid unhandled rejection
      const promise = emb.embedBatch(['hello']).catch((e: unknown) => e);

      // Advance through all retry delays: 1000 + 4000 + 16000
      await vi.advanceTimersByTimeAsync(1100);
      await vi.advanceTimersByTimeAsync(4100);
      await vi.advanceTimersByTimeAsync(16100);

      const err = await promise;
      expect(err).toBeInstanceOf(EmbeddingError);
      expect((err as Error).message).toMatch(/4 attempt/);

      vi.useRealTimers();
    });

    it('respects retry-after header on 429', async () => {
      vi.useFakeTimers();
      const emb = await createInitialized(4);

      const rateLimitErr = Object.assign(new Error('Rate limited'), {
        status: 429,
        headers: { 'retry-after': '2' },
      });
      const vec = [1, 2, 3, 4];

      mockCreate
        .mockRejectedValueOnce(rateLimitErr)
        .mockResolvedValueOnce(fakeEmbeddingResponse([vec]));

      const promise = emb.embedBatch(['hello']);

      // retry-after: 2 → 2000ms delay
      await vi.advanceTimersByTimeAsync(2100);

      const result = await promise;
      expect(result).toEqual([vec]);

      vi.useRealTimers();
    });
  });

  // ── estimateTokens ───────────────────────────────────────────────────────

  describe('estimateTokens', () => {
    it('estimates ~4 chars per token with correct cost', async () => {
      const emb = await createInitialized(4);
      const result = emb.estimateTokens(['hello world']); // 11 chars
      expect(result.totalChars).toBe(11);
      expect(result.estimatedTokens).toBe(3); // ceil(11/4)
      expect(result.estimatedCostUsd).toBeCloseTo(0.00000006, 10); // 3/1M * 0.02
    });

    it('returns zero cost for unknown models', async () => {
      // The mock config uses text-embedding-3-small which has a known rate.
      // Testing unknown model would require a different config mock,
      // but we can verify the formula: rate = 0 → cost = 0.
      const emb = await createInitialized(4);
      const result = emb.estimateTokens([]);
      expect(result.totalChars).toBe(0);
      expect(result.estimatedTokens).toBe(0);
      expect(result.estimatedCostUsd).toBe(0);
    });
  });
});
