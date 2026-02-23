#!/usr/bin/env node
/**
 * Hook entry point for PreCompact and SessionEnd events.
 *
 * PreCompact: Parses transcript, writes session note, updates index, spawns background indexer.
 * SessionEnd: Same as PreCompact + runs memory extraction pipeline (semantic facts → Qdrant).
 */

import { z } from 'zod';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTranscript } from './transcript-parser.js';
import { writeSessionNote } from './note-writer.js';
import { updateSessionIndex, readSessionIndex } from './tier0-writer.js';
import { spawnBackgroundIndexer } from './session-indexer.js';
import { getNotesDir, getProjectId } from './utils.js';
import type { ExtractedSession } from './types.js';

// Resolve index-runner path at module boundary (follows project convention)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const INDEX_RUNNER_PATH = path.join(__dirname, 'index-runner.js');

// Zod schema — handles both PreCompact and SessionEnd hook events
const HookInputSchema = z.discriminatedUnion('hook_event_name', [
  z.object({
    session_id: z.string(),
    transcript_path: z.string(),
    cwd: z.string(),
    trigger: z.enum(['auto', 'manual']),
    hook_event_name: z.literal('PreCompact'),
  }),
  z.object({
    session_id: z.string(),
    transcript_path: z.string(),
    cwd: z.string(),
    hook_event_name: z.literal('SessionEnd'),
    reason: z.string().optional(),
  }),
]);

type HookInput = z.infer<typeof HookInputSchema>;

async function main(): Promise<void> {
  try {
    const input = await readStdin();

    const parseResult = HookInputSchema.safeParse(JSON.parse(input));
    if (!parseResult.success) {
      outputError(`Invalid hook input: ${parseResult.error.message}`);
      return;
    }
    const hookInput = parseResult.data;

    const projectId = getProjectId(hookInput.cwd);
    const notesDir = getNotesDir(projectId);
    const trigger = hookInput.hook_event_name === 'PreCompact' ? hookInput.trigger : 'session_end';

    // Parse transcript
    const session = await parseTranscript(
      hookInput.transcript_path,
      hookInput.session_id,
      projectId,
      hookInput.cwd,
      trigger,
    );

    let noteFile: string;
    let skippedNote = false;

    if (hookInput.hook_event_name === 'SessionEnd') {
      // Dedup check: skip note if already captured by PreCompact
      const existingIndex = readSessionIndex(notesDir);
      const alreadyCaptured = existingIndex?.sessions.some(s => s.sessionId === hookInput.session_id) ?? false;

      if (alreadyCaptured) {
        skippedNote = true;
        // Use placeholder path — note already exists
        const existing = existingIndex!.sessions.find(s => s.sessionId === hookInput.session_id)!;
        noteFile = existing.noteFile;
        process.stderr.write(`[eidetic] SessionEnd: session ${hookInput.session_id} already captured by PreCompact, skipping note\n`);
      } else {
        noteFile = writeSessionNote(notesDir, session);
        updateSessionIndex(notesDir, session, noteFile);
        spawnBackgroundIndexer(notesDir, INDEX_RUNNER_PATH);
      }

      // Run memory extraction (best-effort — graceful failure if Qdrant unavailable)
      const memoryActions = await extractMemories(session);

      outputSuccess({
        noteFile,
        skippedNote,
        filesModified: session.filesModified.length,
        tasksCreated: session.tasksCreated.length,
        memoriesExtracted: memoryActions,
      });
    } else {
      // PreCompact: original flow
      noteFile = writeSessionNote(notesDir, session);
      updateSessionIndex(notesDir, session, noteFile);
      spawnBackgroundIndexer(notesDir, INDEX_RUNNER_PATH);

      outputSuccess({
        noteFile,
        filesModified: session.filesModified.length,
        tasksCreated: session.tasksCreated.length,
      });
    }
  } catch (err) {
    outputError(err instanceof Error ? err.message : String(err));
  }
}

/**
 * Build content string for memory extraction from an ExtractedSession.
 */
function buildMemoryContent(session: ExtractedSession): string {
  const parts: string[] = [];

  if (session.userMessages.length > 0) {
    parts.push('User messages:');
    session.userMessages.forEach((msg, i) => {
      parts.push(`${i + 1}. ${msg}`);
    });
  }

  if (session.filesModified.length > 0) {
    parts.push(`\nFiles modified: ${session.filesModified.join(', ')}`);
  }

  if (session.tasksCreated.length > 0) {
    parts.push(`Tasks: ${session.tasksCreated.join(', ')}`);
  }

  if (session.branch) {
    parts.push(`Branch: ${session.branch}`);
  }

  return parts.join('\n');
}

/**
 * Run memory extraction pipeline. Returns count of actions taken.
 * Fails gracefully — logs to stderr if Qdrant or LLM unavailable.
 */
async function extractMemories(session: ExtractedSession): Promise<number> {
  const content = buildMemoryContent(session);
  if (!content.trim()) return 0;

  try {
    // Dynamic imports to avoid loading heavy deps on every hook invocation
    const [{ loadConfig }, { createEmbedding }, { QdrantVectorDB }, { MemoryHistory }, { MemoryStore }, { getMemoryDbPath }] =
      await Promise.all([
        import('../config.js'),
        import('../embedding/factory.js'),
        import('../vectordb/qdrant.js'),
        import('../memory/history.js'),
        import('../memory/store.js'),
        import('../paths.js'),
      ]);

    const config = loadConfig();
    const embedding = createEmbedding(config);
    await embedding.initialize();
    const vectordb = new QdrantVectorDB();
    const history = new MemoryHistory(getMemoryDbPath());
    const memoryStore = new MemoryStore(embedding, vectordb, history);

    const actions = await memoryStore.addMemory(content, 'session-end-hook');
    process.stderr.write(`[eidetic] Memory extraction: ${actions.length} action(s) (${actions.map(a => a.event).join(', ') || 'none'})\n`);
    return actions.length;
  } catch (err) {
    process.stderr.write(`[eidetic] Memory extraction failed (non-fatal): ${err instanceof Error ? err.message : String(err)}\n`);
    return 0;
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
  const output = {
    hookSpecificOutput: { success: true, ...result },
  };
  process.stdout.write(JSON.stringify(output));
}

function outputError(message: string): void {
  process.stderr.write(JSON.stringify({ error: message }) + '\n');
  process.stdout.write(JSON.stringify({ hookSpecificOutput: {} }));
}

main();
