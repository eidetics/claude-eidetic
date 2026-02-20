import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { spawnBackgroundIndexer } from '../session-indexer.js';
import * as child_process from 'node:child_process';

// Mock child_process
vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

describe('spawnBackgroundIndexer', () => {
  const mockChild = {
    unref: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (child_process.spawn as ReturnType<typeof vi.fn>).mockReturnValue(mockChild);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('spawns node with index-runner script', () => {
    spawnBackgroundIndexer('/path/to/notes', '/path/to/index-runner.js');

    expect(child_process.spawn).toHaveBeenCalledWith(
      process.execPath,
      ['/path/to/index-runner.js', '/path/to/notes'],
      expect.objectContaining({
        detached: true,
        stdio: 'ignore',
      })
    );
  });

  it('passes environment variables', () => {
    spawnBackgroundIndexer('/path/to/notes', '/path/to/index-runner.js');

    expect(child_process.spawn).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      expect.objectContaining({
        env: process.env,
      })
    );
  });

  it('calls unref to detach child process', () => {
    spawnBackgroundIndexer('/path/to/notes', '/path/to/index-runner.js');

    expect(mockChild.unref).toHaveBeenCalled();
  });

  it('does not throw on spawn failure', () => {
    (child_process.spawn as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('spawn failed');
    });

    // Should not throw
    expect(() => {
      spawnBackgroundIndexer('/path/to/notes', '/path/to/index-runner.js');
    }).not.toThrow();
  });

  it('uses windowsHide option', () => {
    spawnBackgroundIndexer('/path/to/notes', '/path/to/index-runner.js');

    expect(child_process.spawn).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      expect.objectContaining({
        windowsHide: true,
      })
    );
  });
});
