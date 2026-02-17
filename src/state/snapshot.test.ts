import { describe, it, expect } from 'vitest';
import { StateManager } from './snapshot.js';

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
    expect(states.map(s => s.path).sort()).toEqual(['/a', '/b']);
  });

  it('markExisting creates indexed state with unknown timestamp', () => {
    const sm = new StateManager();
    sm.markExisting('/existing', 'eidetic_existing');
    const state = sm.getState('/existing');
    expect(state!.status).toBe('indexed');
    expect(state!.lastIndexed).toContain('pre-existing');
  });
});
