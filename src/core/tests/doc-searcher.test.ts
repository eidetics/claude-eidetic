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
import { searchDocuments } from '../doc-searcher.js';

describe('searchDocuments', () => {
  let embedding: MockEmbedding;
  let vectordb: MockVectorDB;

  const reactContent = `# React Hooks

## useState
The useState hook lets you add state to function components.
Call useState at the top level of your component.

## useEffect
The useEffect hook lets you perform side effects in function components.
Use it for data fetching, subscriptions, or manual DOM changes.`;

  const vueContent = `# Vue Composition API

## ref
The ref function creates a reactive reference.
Use ref for primitive values.

## computed
The computed function creates a computed property.
It caches the result and re-evaluates when dependencies change.`;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eidetic-docsearch-'));
    embedding = new MockEmbedding();
    vectordb = new MockVectorDB();

    // Pre-index some docs
    await indexDocument(reactContent, 'https://react.dev/hooks', 'react', 'hooks', embedding, vectordb);
    await indexDocument(vueContent, 'https://vuejs.org/api', 'vue', 'composition', embedding, vectordb);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('searches within a specific library', async () => {
    const results = await searchDocuments('useState hook', embedding, vectordb, { library: 'react' });
    expect(results.length).toBeGreaterThan(0);
    expect(results.every(r => r.library === 'react')).toBe(true);
  });

  it('searches across all cached docs when no library specified', async () => {
    const results = await searchDocuments('reactive state', embedding, vectordb, { limit: 10 });
    expect(results.length).toBeGreaterThan(0);
  });

  it('respects limit parameter', async () => {
    const results = await searchDocuments('hook', embedding, vectordb, { library: 'react', limit: 1 });
    expect(results.length).toBeLessThanOrEqual(1);
  });

  it('annotates results with library and topic', async () => {
    const results = await searchDocuments('useState', embedding, vectordb, { library: 'react' });
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.library).toBe('react');
      expect(r.topic).toBe('hooks');
      expect(r.source).toBe('https://react.dev/hooks');
    }
  });

  it('marks fresh entries as not stale', async () => {
    const results = await searchDocuments('useState', embedding, vectordb, { library: 'react' });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].stale).toBe(false);
  });

  it('throws when library has no cached docs', async () => {
    await expect(
      searchDocuments('query', embedding, vectordb, { library: 'angular' }),
    ).rejects.toThrow('No cached documentation');
  });

  it('throws when no docs cached at all', async () => {
    // Clear metadata file
    const metadataPath = path.join(tmpDir, 'doc-metadata.json');
    fs.writeFileSync(metadataPath, '{}', 'utf-8');

    await expect(
      searchDocuments('query', embedding, vectordb),
    ).rejects.toThrow('No cached documentation');
  });

  it('throws on empty query', async () => {
    await expect(
      searchDocuments('', embedding, vectordb),
    ).rejects.toThrow('query is required');
  });
});
