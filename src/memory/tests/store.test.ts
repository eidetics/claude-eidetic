import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryStore } from '../store.js';
import { MemoryHistory } from '../history.js';
import { MockEmbedding } from '../../__tests__/mock-embedding.js';
import { MockVectorDB } from '../../__tests__/mock-vectordb.js';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

describe('MemoryStore', () => {
  let embedding: MockEmbedding;
  let vectordb: MockVectorDB;
  let history: MemoryHistory;
  let store: MemoryStore;
  let tmpDir: string;

  beforeEach(() => {
    embedding = new MockEmbedding(32);
    vectordb = new MockVectorDB();
    tmpDir = mkdtempSync(join(tmpdir(), 'eidetic-test-'));
    history = new MemoryHistory(join(tmpDir, 'test.db'));
    store = new MemoryStore(embedding, vectordb, history);
  });

  describe('addMemory', () => {
    it('stores provided facts', async () => {
      const actions = await store.addMemory([
        { fact: 'Indentation style is tabs not spaces', category: 'coding_style' },
      ]);

      expect(actions).toHaveLength(1);
      expect(actions[0].event).toBe('ADD');
      expect(actions[0].memory).toBe('Indentation style is tabs not spaces');
      expect(actions[0].category).toBe('coding_style');
      expect(actions[0].id).toBeTruthy();
    });

    it('returns empty array when given empty facts array', async () => {
      const actions = await store.addMemory([]);
      expect(actions).toHaveLength(0);
    });

    it('stores multiple facts', async () => {
      const actions = await store.addMemory([
        { fact: 'Uses TypeScript strict mode', category: 'conventions' },
        { fact: 'Prefers pnpm over npm', category: 'tools' },
      ]);

      expect(actions).toHaveLength(2);
      expect(actions[0].event).toBe('ADD');
      expect(actions[1].event).toBe('ADD');
    });

    it('passes source to stored memories', async () => {
      const actions = await store.addMemory(
        [{ fact: 'Uses TypeScript strict mode', category: 'conventions' }],
        'conversation',
      );

      expect(actions).toHaveLength(1);
      expect(actions[0].source).toBe('conversation');
    });
  });

  describe('deleteMemory', () => {
    it('deletes an existing memory and logs history', async () => {
      const actions = await store.addMemory([{ fact: 'Use React 19', category: 'tools' }]);
      expect(actions).toHaveLength(1);
      const memoryId = actions[0].id;

      const deleted = await store.deleteMemory(memoryId);
      expect(deleted).toBe(true);

      const historyEntries = history.getHistory(memoryId);
      expect(historyEntries).toHaveLength(2); // ADD + DELETE
      expect(historyEntries[0].event).toBe('ADD');
      expect(historyEntries[1].event).toBe('DELETE');
    });

    it('returns false for non-existent memory', async () => {
      const deleted = await store.deleteMemory('non-existent-id');
      expect(deleted).toBe(false);
    });
  });

  describe('getHistory', () => {
    it('returns history entries for a memory', async () => {
      const actions = await store.addMemory([
        { fact: 'Prefers dark mode', category: 'preferences' },
      ]);
      const id = actions[0].id;

      const entries = store.getHistory(id);
      expect(entries).toHaveLength(1);
      expect(entries[0].event).toBe('ADD');
      expect(entries[0].new_value).toBe('Prefers dark mode');
      expect(entries[0].memory_id).toBe(id);
    });
  });
});
