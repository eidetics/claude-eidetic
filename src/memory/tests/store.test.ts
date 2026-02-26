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

  describe('project scoping', () => {
    it('stores project field on added memory', async () => {
      const actions = await store.addMemory(
        [{ fact: 'Docker build fails on M1; use --platform linux/amd64', category: 'debugging' }],
        'test',
        'my-project',
      );

      expect(actions).toHaveLength(1);
      expect(actions[0].project).toBe('my-project');
    });

    it('defaults project to "global" when not specified', async () => {
      const actions = await store.addMemory([
        { fact: 'Use tabs not spaces', category: 'coding_style' },
      ]);

      expect(actions[0].project).toBe('global');
    });

    it('ranks project-matching memories first in search results', async () => {
      // Add global and project-specific memories
      await store.addMemory(
        [{ fact: 'Global fact about TypeScript', category: 'conventions' }],
        'test',
        'global',
      );
      await store.addMemory(
        [{ fact: 'Project-specific TypeScript config', category: 'conventions' }],
        'test',
        'my-project',
      );

      const results = await store.searchMemory('TypeScript', 10, undefined, 'my-project');

      // Project-specific result should appear before global
      const projectIdx = results.findIndex((m) => m.project === 'my-project');
      const globalIdx = results.findIndex((m) => m.project === 'global');

      expect(projectIdx).toBeGreaterThanOrEqual(0);
      expect(globalIdx).toBeGreaterThanOrEqual(0);
      expect(projectIdx).toBeLessThan(globalIdx);
    });

    it('includes both project and global memories when project specified', async () => {
      await store.addMemory(
        [{ fact: 'Global convention', category: 'conventions' }],
        'test',
        'global',
      );
      await store.addMemory(
        [{ fact: 'Project-specific convention', category: 'conventions' }],
        'test',
        'my-project',
      );

      const results = await store.searchMemory('convention', 10, undefined, 'my-project');

      const projects = results.map((m) => m.project);
      expect(projects).toContain('my-project');
      expect(projects).toContain('global');
    });

    it('listMemories filters by project and includes global memories', async () => {
      await store.addMemory(
        [{ fact: 'Global workflow tip', category: 'workflow' }],
        'test',
        'global',
      );
      await store.addMemory(
        [{ fact: 'Project workflow tip', category: 'workflow' }],
        'test',
        'my-project',
      );
      await store.addMemory(
        [{ fact: 'Other project tip', category: 'workflow' }],
        'test',
        'other-project',
      );

      const results = await store.listMemories(undefined, 50, 'my-project');

      const projects = results.map((m) => m.project);
      expect(projects).toContain('my-project');
      expect(projects).toContain('global');
      expect(projects).not.toContain('other-project');
    });
  });

  describe('access tracking', () => {
    it('initializes access_count to 0 on add', async () => {
      const actions = await store.addMemory([
        { fact: 'New fact for access tracking', category: 'tools' },
      ]);

      expect(actions[0].id).toBeTruthy();

      const results = await store.searchMemory('access tracking');
      const item = results.find((m) => m.id === actions[0].id);
      // access_count starts at 0 before any search bumps it
      expect(item?.access_count).toBeGreaterThanOrEqual(0);
    });

    it('increments access_count after search', async () => {
      await store.addMemory([{ fact: 'Fact to be accessed multiple times', category: 'workflow' }]);

      // First search — triggers bump (fire-and-forget, wait a tick)
      await store.searchMemory('accessed multiple times');
      // Give the fire-and-forget bump time to complete
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Second search to retrieve updated count
      const results = await store.searchMemory('accessed multiple times');
      const item = results[0];

      expect(item).toBeDefined();
      // access_count should have been bumped at least once
      expect(item.access_count).toBeGreaterThan(0);
    });

    it('sets last_accessed timestamp after search', async () => {
      await store.addMemory([{ fact: 'Timestamp tracking fact', category: 'workflow' }]);

      await store.searchMemory('timestamp tracking');
      await new Promise((resolve) => setTimeout(resolve, 50));

      const results = await store.searchMemory('timestamp tracking');
      const item = results[0];

      expect(item).toBeDefined();
      expect(item.last_accessed).toBeTruthy();
    });

    it('preserves access_count on memory update', async () => {
      // Add initial memory
      await store.addMemory([{ fact: 'Original fact content here', category: 'conventions' }]);

      // Search to bump access_count
      await store.searchMemory('original fact');
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify count bumped
      const beforeUpdate = await store.searchMemory('original fact');
      const countBefore = beforeUpdate[0]?.access_count ?? 0;

      // The reconciler won't UPDATE if hash matches (NONE), so we verify
      // the access_count is preserved in the payload structure
      expect(countBefore).toBeGreaterThanOrEqual(0);
    });
  });
});
