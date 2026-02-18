import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MockEmbedding } from '../../__tests__/mock-embedding.js';
import { MockVectorDB } from '../../__tests__/mock-vectordb.js';

let tmpDir: string;

vi.mock('../../paths.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../paths.js')>();
  return {
    ...original,
    getDocMetadataPath: () => path.join(tmpDir, 'doc-metadata.json'),
    getDataDir: () => tmpDir,
  };
});

vi.mock('../../config.js', () => ({
  getConfig: () => ({
    embeddingBatchSize: 100,
    indexingConcurrency: 4,
  }),
}));

import { indexDocument } from '../doc-indexer.js';

describe('indexDocument', () => {
  let embedding: MockEmbedding;
  let vectordb: MockVectorDB;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eidetic-docidx-'));
    embedding = new MockEmbedding();
    vectordb = new MockVectorDB();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const sampleContent = `# React Hooks

## useState
The useState hook lets you add state to function components.

## useEffect
The useEffect hook lets you perform side effects in function components.

## useContext
The useContext hook lets you read context from a provider.`;

  it('indexes document content and returns result', async () => {
    const result = await indexDocument(
      sampleContent,
      'https://react.dev/hooks',
      'react',
      'hooks',
      embedding,
      vectordb,
    );

    expect(result.library).toBe('react');
    expect(result.topic).toBe('hooks');
    expect(result.source).toBe('https://react.dev/hooks');
    expect(result.collectionName).toBe('doc_react');
    expect(result.totalChunks).toBeGreaterThan(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('creates collection if it does not exist', async () => {
    await indexDocument(sampleContent, 'https://react.dev/hooks', 'react', 'hooks', embedding, vectordb);

    const createCalls = vectordb.calls.filter(c => c.method === 'createCollection');
    expect(createCalls).toHaveLength(1);
    expect(createCalls[0].args[0]).toBe('doc_react');
  });

  it('reuses collection if it already exists', async () => {
    await vectordb.createCollection('doc_react', 32);
    vectordb.calls.length = 0;

    await indexDocument(sampleContent, 'https://react.dev/hooks', 'react', 'hooks', embedding, vectordb);

    const createCalls = vectordb.calls.filter(c => c.method === 'createCollection');
    expect(createCalls).toHaveLength(0);
  });

  it('deletes old chunks for same source on refresh', async () => {
    await indexDocument(sampleContent, 'https://react.dev/hooks', 'react', 'hooks', embedding, vectordb);

    const firstChunkCount = vectordb.collections.get('doc_react')!.documents.length;

    await indexDocument(sampleContent + '\n\n## useMemo\nMemoize values.', 'https://react.dev/hooks', 'react', 'hooks', embedding, vectordb);

    const deleteCalls = vectordb.calls.filter(c => c.method === 'deleteByPath');
    expect(deleteCalls.length).toBeGreaterThanOrEqual(1);
    // Should have new chunks after delete + re-insert
    expect(vectordb.collections.get('doc_react')!.documents.length).toBeGreaterThan(0);
  });

  it('stores documents with markdown language and .md extension', async () => {
    await indexDocument(sampleContent, 'https://react.dev/hooks', 'react', 'hooks', embedding, vectordb);

    const docs = vectordb.collections.get('doc_react')!.documents;
    for (const doc of docs) {
      expect(doc.language).toBe('markdown');
      expect(doc.fileExtension).toBe('.md');
      expect(doc.relativePath).toBe('https://react.dev/hooks');
    }
  });

  it('saves metadata to doc-metadata.json', async () => {
    await indexDocument(sampleContent, 'https://react.dev/hooks', 'react', 'hooks', embedding, vectordb, 14);

    const metadataPath = path.join(tmpDir, 'doc-metadata.json');
    expect(fs.existsSync(metadataPath)).toBe(true);

    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
    expect(metadata['react::hooks']).toBeDefined();
    expect(metadata['react::hooks'].ttlDays).toBe(14);
    expect(metadata['react::hooks'].totalChunks).toBeGreaterThan(0);
  });

  it('throws on empty content', async () => {
    await expect(
      indexDocument('', 'https://react.dev/hooks', 'react', 'hooks', embedding, vectordb),
    ).rejects.toThrow('empty');
  });

  it('throws on missing source', async () => {
    await expect(
      indexDocument(sampleContent, '', 'react', 'hooks', embedding, vectordb),
    ).rejects.toThrow('source');
  });

  it('throws on missing library', async () => {
    await expect(
      indexDocument(sampleContent, 'https://react.dev/hooks', '', 'hooks', embedding, vectordb),
    ).rejects.toThrow('Library');
  });

  it('throws on missing topic', async () => {
    await expect(
      indexDocument(sampleContent, 'https://react.dev/hooks', 'react', '', embedding, vectordb),
    ).rejects.toThrow('Topic');
  });
});
