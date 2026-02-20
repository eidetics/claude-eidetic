#!/usr/bin/env node
/**
 * PreCompact hook entry point.
 *
 * Receives session data via stdin, extracts deterministic data from transcript,
 * writes session note and updates index, then spawns background indexer.
 */

import { z } from 'zod';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTranscript } from './transcript-parser.js';
import { writeSessionNote } from './note-writer.js';
import { updateSessionIndex } from './tier0-writer.js';
import { spawnBackgroundIndexer } from './session-indexer.js';
import { getNotesDir, getProjectId } from './utils.js';

// Resolve index-runner path at module boundary (follows project convention)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const INDEX_RUNNER_PATH = path.join(__dirname, 'index-runner.js');

// Zod schema for hook input validation
const PreCompactInputSchema = z.object({
  session_id: z.string(),
  transcript_path: z.string(),
  cwd: z.string(),
  trigger: z.enum(['auto', 'manual']),
  hook_event_name: z.literal('PreCompact'),
});

type PreCompactInput = z.infer<typeof PreCompactInputSchema>;

async function main(): Promise<void> {
  try {
    // Read input from stdin
    const input = await readStdin();

    // Validate input schema
    const parseResult = PreCompactInputSchema.safeParse(JSON.parse(input));
    if (!parseResult.success) {
      outputError(`Invalid hook input: ${parseResult.error.message}`);
      return;
    }
    const hookInput = parseResult.data;

    // Use project ID that handles name collisions
    const projectId = getProjectId(hookInput.cwd);
    const notesDir = getNotesDir(projectId);

    // Parse transcript with trigger from hook input
    const session = await parseTranscript(
      hookInput.transcript_path,
      hookInput.session_id,
      projectId,
      hookInput.cwd,
      hookInput.trigger
    );

    // Write note (atomic)
    const noteFile = writeSessionNote(notesDir, session);

    // Update session index (atomic)
    updateSessionIndex(notesDir, session, noteFile);

    // Spawn background indexer (async, non-blocking)
    spawnBackgroundIndexer(notesDir, INDEX_RUNNER_PATH);

    // Output success
    outputSuccess({
      noteFile,
      filesModified: session.filesModified.length,
      tasksCreated: session.tasksCreated.length,
    });
  } catch (err) {
    outputError(err instanceof Error ? err.message : String(err));
  }
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

function outputSuccess(result: Record<string, unknown>): void {
  // Output hookSpecificOutput for Claude Code
  const output = {
    hookSpecificOutput: { success: true, ...result },
  };
  process.stdout.write(JSON.stringify(output));
}

function outputError(message: string): void {
  // Errors go to stderr to avoid polluting Claude context
  process.stderr.write(JSON.stringify({ error: message }) + '\n');
  // Still output valid hook response with empty output
  process.stdout.write(JSON.stringify({ hookSpecificOutput: {} }));
}

main();
