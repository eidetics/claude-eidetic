import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  loadDocMetadata,
  saveDocMetadata,
  upsertDocEntry,
  removeDocEntry,
  findDocEntries,
  isStale,
  listDocLibraries,
  type DocEntry,
} from '../doc-metadata.js';

let tmpDir: string;

vi.mock('../../paths.js', () => ({
  getDocMetadataPath: () => path.join(tmpDir, 'doc-metadata.json'),
  getDataDir: () => tmpDir,
}));

function makeEntry(overrides: Partial<DocEntry> = {}): DocEntry {
  return {
    library: 'react',
    topic: 'hooks',
    source: 'https://react.dev/reference/react/hooks',
    collectionName: 'doc_react',
    indexedAt: new Date().toISOString(),
    ttlDays: 7,
    totalChunks: 10,
    ...overrides,
  };
}

describe('doc-metadata', () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eidetic-docmeta-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('loadDocMetadata returns empty object when no file', () => {
    expect(loadDocMetadata()).toEqual({});
  });

  it('saveDocMetadata and loadDocMetadata round-trip', () => {
    const entry = makeEntry();
    const metadata = { 'react::hooks': entry };
    saveDocMetadata(metadata);
    const loaded = loadDocMetadata();
    expect(loaded['react::hooks']).toEqual(entry);
  });

  it('upsertDocEntry adds a new entry', () => {
    upsertDocEntry(makeEntry());
    const metadata = loadDocMetadata();
    expect(metadata['react::hooks']).toBeDefined();
    expect(metadata['react::hooks'].library).toBe('react');
  });

  it('upsertDocEntry updates existing entry', () => {
    upsertDocEntry(makeEntry({ totalChunks: 10 }));
    upsertDocEntry(makeEntry({ totalChunks: 20 }));
    const metadata = loadDocMetadata();
    expect(metadata['react::hooks'].totalChunks).toBe(20);
  });

  it('upsertDocEntry key is case-insensitive', () => {
    upsertDocEntry(makeEntry({ library: 'React', topic: 'Hooks' }));
    const metadata = loadDocMetadata();
    expect(metadata['react::hooks']).toBeDefined();
  });

  it('removeDocEntry removes an existing entry', () => {
    upsertDocEntry(makeEntry());
    const removed = removeDocEntry('react', 'hooks');
    expect(removed).toBe(true);
    expect(loadDocMetadata()['react::hooks']).toBeUndefined();
  });

  it('removeDocEntry returns false for nonexistent entry', () => {
    expect(removeDocEntry('nonexistent', 'topic')).toBe(false);
  });

  it('findDocEntries finds entries by library', () => {
    upsertDocEntry(makeEntry({ library: 'react', topic: 'hooks' }));
    upsertDocEntry(makeEntry({ library: 'react', topic: 'context' }));
    upsertDocEntry(makeEntry({ library: 'vue', topic: 'setup' }));

    const reactEntries = findDocEntries('react');
    expect(reactEntries).toHaveLength(2);
    expect(reactEntries.every(e => e.library === 'react')).toBe(true);
  });

  it('findDocEntries returns empty for unknown library', () => {
    expect(findDocEntries('unknown')).toHaveLength(0);
  });

  it('isStale returns false for fresh entry', () => {
    const entry = makeEntry({ indexedAt: new Date().toISOString(), ttlDays: 7 });
    expect(isStale(entry)).toBe(false);
  });

  it('isStale returns true for expired entry', () => {
    const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    const entry = makeEntry({ indexedAt: old.toISOString(), ttlDays: 7 });
    expect(isStale(entry)).toBe(true);
  });

  it('listDocLibraries returns sorted unique libraries', () => {
    upsertDocEntry(makeEntry({ library: 'react', topic: 'hooks' }));
    upsertDocEntry(makeEntry({ library: 'vue', topic: 'setup' }));
    upsertDocEntry(makeEntry({ library: 'react', topic: 'context' }));

    const libs = listDocLibraries();
    expect(libs).toEqual(['react', 'vue']);
  });

  it('listDocLibraries returns empty when no entries', () => {
    expect(listDocLibraries()).toEqual([]);
  });
});
