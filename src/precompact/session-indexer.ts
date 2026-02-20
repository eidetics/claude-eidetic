/**
 * Spawn background process to index session notes into Qdrant.
 * Non-blocking: hook returns immediately while indexing continues.
 */

import { spawn } from 'node:child_process';

/**
 * Spawn a detached background process to index the notes directory.
 * The process runs independently and won't block the hook.
 *
 * @param notesDir - Directory containing session notes to index
 * @param indexRunnerPath - Full path to the index-runner.js script
 */
export function spawnBackgroundIndexer(notesDir: string, indexRunnerPath: string): void {
  try {
    const child = spawn(process.execPath, [indexRunnerPath, notesDir], {
      detached: true,
      stdio: 'ignore',
      // Inherit environment for OPENAI_API_KEY, QDRANT_URL, etc.
      env: process.env,
      // Prevent the parent process from waiting for this child
      windowsHide: true,
    });

    // Unref so the parent can exit independently
    child.unref();
  } catch {
    // Best effort - if spawn fails, just skip indexing
    // The notes are already saved, indexing can happen later
  }
}
