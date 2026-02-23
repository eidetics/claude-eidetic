import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { QdrantVectorDB } from '../qdrant.js';

const QDRANT_URL = process.env.QDRANT_URL ?? 'http://localhost:6333';
const TEST_COLLECTION = `eidetic_integration_test_${Date.now()}`;
const DIMENSION = 32;

function isLocalhostUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

async function isQdrantAvailable(): Promise<boolean> {
  // Refuse to run integration tests against non-localhost Qdrant
  if (!isLocalhostUrl(QDRANT_URL)) {
    console.warn(`Skipping Qdrant integration tests: QDRANT_URL (${QDRANT_URL}) is not localhost.`);
    return false;
  }
  try {
    const res = await fetch(`${QDRANT_URL}/collections`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

const describeIfQdrant = (await isQdrantAvailable()) ? describe : describe.skip;

describeIfQdrant('QdrantVectorDB integration', () => {
  let db: QdrantVectorDB;

  beforeAll(async () => {
    db = new QdrantVectorDB(QDRANT_URL);
  });

  afterAll(async () => {
    try {
      await db.dropCollection(TEST_COLLECTION);
    } catch {
      // cleanup best-effort
    }
  });

  it('create / has / drop collection lifecycle', async () => {
    await db.createCollection(TEST_COLLECTION, DIMENSION);
    expect(await db.hasCollection(TEST_COLLECTION)).toBe(true);

    await db.dropCollection(TEST_COLLECTION);
    expect(await db.hasCollection(TEST_COLLECTION)).toBe(false);

    // Re-create for subsequent tests
    await db.createCollection(TEST_COLLECTION, DIMENSION);
  });

  it('insert documents and search returns them', async () => {
    const vector = new Array(DIMENSION).fill(0.1);
    await db.insert(TEST_COLLECTION, [
      {
        id: randomUUID(),
        content: 'function greet(name) { return "Hello " + name; }',
        vector,
        relativePath: 'src/greet.ts',
        startLine: 1,
        endLine: 3,
        fileExtension: '.ts',
        language: 'typescript',
      },
      {
        id: randomUUID(),
        content: 'class Calculator { add(a, b) { return a + b; } }',
        vector: vector.map((v) => v + 0.01),
        relativePath: 'src/calc.ts',
        startLine: 1,
        endLine: 5,
        fileExtension: '.ts',
        language: 'typescript',
      },
    ]);

    const results = await db.search(TEST_COLLECTION, {
      queryVector: vector,
      queryText: 'greet',
      limit: 10,
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.content.includes('greet'))).toBe(true);
  });

  it('deleteByPath removes matching docs', async () => {
    await db.deleteByPath(TEST_COLLECTION, 'src/greet.ts');

    // Wait briefly for deletion to propagate
    await new Promise((r) => setTimeout(r, 500));

    const results = await db.search(TEST_COLLECTION, {
      queryVector: new Array(DIMENSION).fill(0.1),
      queryText: 'greet',
      limit: 10,
    });

    const greetResults = results.filter((r) => r.relativePath === 'src/greet.ts');
    expect(greetResults).toHaveLength(0);
  });

  it('extensionFilter works', async () => {
    // Insert a .py doc
    await db.insert(TEST_COLLECTION, [
      {
        id: randomUUID(),
        content: 'def hello(): return "world"',
        vector: new Array(DIMENSION).fill(0.2),
        relativePath: 'src/hello.py',
        startLine: 1,
        endLine: 1,
        fileExtension: '.py',
        language: 'python',
      },
    ]);

    const tsOnly = await db.search(TEST_COLLECTION, {
      queryVector: new Array(DIMENSION).fill(0.2),
      queryText: 'hello',
      limit: 10,
      extensionFilter: ['.ts'],
    });

    // Should not include .py results
    expect(tsOnly.every((r) => r.fileExtension === '.ts')).toBe(true);
  });

  it('returns empty results for no matches', async () => {
    const results = await db.search(TEST_COLLECTION, {
      queryVector: new Array(DIMENSION).fill(0.99),
      queryText: 'zzzznonexistenttermzzzz',
      limit: 10,
      extensionFilter: ['.xyz'],
    });
    expect(results).toHaveLength(0);
  });
});
