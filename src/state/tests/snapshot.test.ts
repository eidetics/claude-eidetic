import { describe, it, expect, vi } from 'vitest';
import { StateManager } from '../snapshot.js';
import type { VectorDB } from '../../vectordb/types.js';

describe('StateManager', () => {
  it('returns undefined for unknown path', () => {
    const sm = new StateManager();
    expect(sm.getState('/unknown')).toBeUndefined();
  });

  it('setIndexing creates state with indexing status', () => {
    const sm = new StateManager();
    sm.setIndexing('/test', 'eidetic_test');
    const state = sm.getState('/test');
    expect(state).toBeDefined();
    expect(state!.status).toBe('indexing');
    expect(state!.progress).toBe(0);
    expect(state!.progressMessage).toBe('Starting...');
    expect(state!.collectionName).toBe('eidetic_test');
  });

  it('updateProgress changes progress and message', () => {
    const sm = new StateManager();
    sm.setIndexing('/test', 'eidetic_test');
    sm.updateProgress('/test', 50, 'Halfway there');
    const state = sm.getState('/test');
    expect(state!.progress).toBe(50);
    expect(state!.progressMessage).toBe('Halfway there');
  });

  it('setIndexed transitions to indexed status', () => {
    const sm = new StateManager();
    sm.setIndexing('/test', 'eidetic_test');
    sm.setIndexed('/test', 100, 500);
    const state = sm.getState('/test');
    expect(state!.status).toBe('indexed');
    expect(state!.totalFiles).toBe(100);
    expect(state!.totalChunks).toBe(500);
    expect(state!.progress).toBe(100);
    expect(state!.lastIndexed).toBeDefined();
  });

  it('setError transitions to error status', () => {
    const sm = new StateManager();
    sm.setIndexing('/test', 'eidetic_test');
    sm.setError('/test', 'Connection refused');
    const state = sm.getState('/test');
    expect(state!.status).toBe('error');
    expect(state!.error).toBe('Connection refused');
  });

  it('remove deletes state', () => {
    const sm = new StateManager();
    sm.setIndexing('/test', 'eidetic_test');
    sm.remove('/test');
    expect(sm.getState('/test')).toBeUndefined();
  });

  it('getAllStates returns all tracked states', () => {
    const sm = new StateManager();
    sm.setIndexing('/a', 'col_a');
    sm.setIndexing('/b', 'col_b');
    const states = sm.getAllStates();
    expect(states).toHaveLength(2);
    expect(states.map((s) => s.path).sort()).toEqual(['/a', '/b']);
  });

  describe('hydrate', () => {
    function mockVectorDB(existingCollections: Set<string>): VectorDB {
      return {
        hasCollection: vi.fn(async (name: string) => existingCollections.has(name)),
      } as unknown as VectorDB;
    }

    it('hydrates entries whose collections exist in vectordb', async () => {
      const sm = new StateManager();
      const vdb = mockVectorDB(new Set(['eidetic_e_workspace_project_a']));
      const registry = {
        'project-a': 'E:/workspace/project-a',
        'project-b': 'E:/workspace/project-b',
      };
      const count = await sm.hydrate(registry, vdb);
      expect(count).toBe(1);
      const state = sm.getState('E:/workspace/project-a');
      expect(state).toBeDefined();
      expect(state!.status).toBe('indexed');
      expect(state!.totalFiles).toBeUndefined();
      expect(sm.getState('E:/workspace/project-b')).toBeUndefined();
    });

    it('does not overwrite existing in-memory state', async () => {
      const sm = new StateManager();
      sm.setIndexing('/existing', 'eidetic__existing');
      const vdb = mockVectorDB(new Set(['eidetic__existing']));
      const count = await sm.hydrate({ proj: '/existing' }, vdb);
      expect(count).toBe(0);
      expect(sm.getState('/existing')!.status).toBe('indexing');
    });

    it('continues when individual entries fail', async () => {
      const sm = new StateManager();
      const vdb = {
        hasCollection: vi
          .fn()
          .mockRejectedValueOnce(new Error('network'))
          .mockResolvedValueOnce(true),
      } as unknown as VectorDB;
      const registry = { bad: '/bad', good: '/good' };
      const count = await sm.hydrate(registry, vdb);
      expect(count).toBe(1);
    });

    it('returns 0 for empty registry', async () => {
      const sm = new StateManager();
      const vdb = mockVectorDB(new Set());
      expect(await sm.hydrate({}, vdb)).toBe(0);
    });
  });
});
