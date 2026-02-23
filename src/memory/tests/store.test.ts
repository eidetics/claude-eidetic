import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MemoryStore } from '../store.js';
import { MemoryHistory } from '../history.js';
import { MockEmbedding } from '../../__tests__/mock-embedding.js';
import { MockVectorDB } from '../../__tests__/mock-vectordb.js';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { chatCompletion } from '../llm.js';

// Mock the LLM module
vi.mock('../llm.js', () => ({
  chatCompletion: vi.fn(),
}));

const mockChatCompletion = vi.mocked(chatCompletion);

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
    vi.clearAllMocks();
  });

  describe('addMemory', () => {
    it('extracts facts and stores them', async () => {
      mockChatCompletion.mockResolvedValueOnce(
        JSON.stringify({
          facts: [{ fact: 'Indentation style is tabs not spaces', category: 'coding_style' }],
        }),
      );

      const actions = await store.addMemory('I always use tabs');

      expect(actions).toHaveLength(1);
      expect(actions[0].event).toBe('ADD');
      expect(actions[0].memory).toBe('Indentation style is tabs not spaces');
      expect(actions[0].category).toBe('coding_style');
      expect(actions[0].id).toBeTruthy();
    });

    it('returns empty array when no facts extracted', async () => {
      mockChatCompletion.mockResolvedValueOnce(JSON.stringify({ facts: [] }));

      const actions = await store.addMemory('hello world');
      expect(actions).toHaveLength(0);
    });

    it('handles malformed LLM response gracefully', async () => {
      mockChatCompletion.mockResolvedValueOnce('not valid json');

      const actions = await store.addMemory('some content');
      expect(actions).toHaveLength(0);
    });

    it('passes source to stored memories', async () => {
      mockChatCompletion.mockResolvedValueOnce(
        JSON.stringify({
          facts: [{ fact: 'Uses TypeScript strict mode', category: 'conventions' }],
        }),
      );

      const actions = await store.addMemory('We use TS strict mode', 'conversation');

      expect(actions).toHaveLength(1);
      expect(actions[0].source).toBe('conversation');
    });
  });

  describe('deleteMemory', () => {
    it('deletes an existing memory and logs history', async () => {
      // First add a memory
      mockChatCompletion.mockResolvedValueOnce(
        JSON.stringify({
          facts: [{ fact: 'Use React 19', category: 'tools' }],
        }),
      );
      const actions = await store.addMemory('We use React 19');
      expect(actions).toHaveLength(1);
      const memoryId = actions[0].id;

      // Delete it
      const deleted = await store.deleteMemory(memoryId);
      expect(deleted).toBe(true);

      // Check history
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
      mockChatCompletion.mockResolvedValueOnce(
        JSON.stringify({
          facts: [{ fact: 'Prefers dark mode', category: 'preferences' }],
        }),
      );

      const actions = await store.addMemory('I like dark mode');
      const id = actions[0].id;

      const entries = store.getHistory(id);
      expect(entries).toHaveLength(1);
      expect(entries[0].event).toBe('ADD');
      expect(entries[0].new_value).toBe('Prefers dark mode');
      expect(entries[0].memory_id).toBe(id);
    });
  });
});
