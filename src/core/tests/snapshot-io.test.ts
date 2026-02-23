import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { saveSnapshot, loadSnapshot, deleteSnapshot, snapshotExists } from '../snapshot-io.js';

let tmpDir: string;

vi.mock('../../paths.js', () => ({
  pathToCollectionName: (p: string) => 'eidetic_' + p.replace(/[^a-z0-9]/gi, '_').toLowerCase(),
  getSnapshotDir: () => path.join(tmpDir, 'snapshots'),
  normalizePath: (p: string) => p,
  getDataDir: () => tmpDir,
}));

describe('snapshot-io', () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eidetic-snap-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('saveSnapshot + loadSnapshot round-trips JSON', () => {
    const snapshot = { 'a.ts': { contentHash: 'abc123' } };
    saveSnapshot('/test/path', snapshot);
    const loaded = loadSnapshot('/test/path');
    expect(loaded).toEqual(snapshot);
  });

  it('loadSnapshot returns null for nonexistent', () => {
    expect(loadSnapshot('/nonexistent')).toBeNull();
  });

  it('loadSnapshot returns null for corrupted JSON', () => {
    const snapshotDir = path.join(tmpDir, 'snapshots');
    fs.mkdirSync(snapshotDir, { recursive: true });
    // Write corrupted data
    const name = 'eidetic__corrupted'.toLowerCase();
    fs.writeFileSync(path.join(snapshotDir, `${name}.json`), 'not valid json{{{');
    expect(loadSnapshot('/corrupted')).toBeNull();
  });

  it('deleteSnapshot removes file safely', () => {
    saveSnapshot('/test/path', { 'a.ts': { contentHash: 'abc' } });
    expect(snapshotExists('/test/path')).toBe(true);
    deleteSnapshot('/test/path');
    expect(snapshotExists('/test/path')).toBe(false);
  });

  it('deleteSnapshot does not throw for nonexistent', () => {
    expect(() => {
      deleteSnapshot('/nonexistent');
    }).not.toThrow();
  });

  it('snapshotExists returns correct boolean', () => {
    expect(snapshotExists('/test/path')).toBe(false);
    saveSnapshot('/test/path', {});
    expect(snapshotExists('/test/path')).toBe(true);
  });
});
