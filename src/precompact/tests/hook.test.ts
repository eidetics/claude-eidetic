import { describe, it, expect, afterEach } from 'vitest';
import { createTempCodebase, cleanupTempDir } from '../../__tests__/fixtures.js';
import { parseTranscript } from '../transcript-parser.js';
import { writeSessionNote } from '../note-writer.js';
import { updateSessionIndex, readSessionIndex } from '../tier0-writer.js';
import fs from 'node:fs';
import path from 'node:path';

describe('PreCompact hook integration', () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) cleanupTempDir(tmpDir);
  });

  it('end-to-end: parses transcript and writes note + index', async () => {
    // Setup: create temp transcript
    tmpDir = createTempCodebase({
      'transcript.jsonl': [
        '{"type":"user","timestamp":"2026-02-19T10:00:00Z","gitBranch":"main","message":{"role":"user","content":[{"type":"text","text":"Test request"}]}}',
        '{"type":"assistant","timestamp":"2026-02-19T10:01:00Z","message":{"content":[{"type":"tool_use","name":"Write","input":{"file_path":"/test.ts"}}]}}',
        '{"type":"assistant","timestamp":"2026-02-19T10:02:00Z","message":{"content":[{"type":"tool_use","name":"TaskCreate","input":{"subject":"Test task"}}]}}',
      ].join('\n'),
    });

    // Setup: temp notes directory
    const notesDir = path.join(tmpDir, 'notes');

    // Run hook components
    const session = await parseTranscript(
      path.join(tmpDir, 'transcript.jsonl'),
      'test-session-id',
      'testproj',
      tmpDir,
    );

    expect(session.branch).toBe('main');
    expect(session.filesModified).toContain('/test.ts');
    expect(session.tasksCreated).toContain('Test task');
    expect(session.userMessages[0]).toBe('Test request');

    const noteFile = writeSessionNote(notesDir, session);
    updateSessionIndex(notesDir, session, noteFile);

    // Verify: note file exists with correct content
    expect(fs.existsSync(noteFile)).toBe(true);
    const noteContent = fs.readFileSync(noteFile, 'utf-8');
    expect(noteContent).toContain('project: testproj');
    expect(noteContent).toContain('/test.ts');
    expect(noteContent).toContain('Test task');
    expect(noteContent).toContain('Test request');

    // Verify: session index exists and is correct
    const index = readSessionIndex(notesDir);
    expect(index).not.toBeNull();
    expect(index!.sessions[0].sessionId).toBe('test-session-id');
    expect(index!.sessions[0].filesModified).toContain('/test.ts');
    expect(index!.sessions[0].tasksCreated).toContain('Test task');
    expect(index!.sessions[0].branch).toBe('main');
  });

  it('handles empty transcript gracefully', async () => {
    tmpDir = createTempCodebase({
      'transcript.jsonl': '',
    });

    const notesDir = path.join(tmpDir, 'notes');

    const session = await parseTranscript(
      path.join(tmpDir, 'transcript.jsonl'),
      'empty-session',
      'proj',
      tmpDir,
    );

    expect(session.filesModified).toEqual([]);
    expect(session.bashCommands).toEqual([]);

    const noteFile = writeSessionNote(notesDir, session);
    updateSessionIndex(notesDir, session, noteFile);

    expect(fs.existsSync(noteFile)).toBe(true);

    const index = readSessionIndex(notesDir);
    expect(index!.sessions[0].sessionId).toBe('empty-session');
  });

  it('preserves multiple sessions in index', async () => {
    tmpDir = createTempCodebase({
      'transcript.jsonl':
        '{"type":"user","timestamp":"2026-02-19T10:00:00Z","message":{"content":[]}}',
    });

    const notesDir = path.join(tmpDir, 'notes');

    // First session
    const session1 = await parseTranscript(
      path.join(tmpDir, 'transcript.jsonl'),
      'session-1',
      'proj',
      tmpDir,
    );
    const note1 = writeSessionNote(notesDir, session1);
    updateSessionIndex(notesDir, session1, note1);

    // Second session
    const session2 = await parseTranscript(
      path.join(tmpDir, 'transcript.jsonl'),
      'session-2',
      'proj',
      tmpDir,
    );
    const note2 = writeSessionNote(notesDir, session2);
    updateSessionIndex(notesDir, session2, note2);

    const index = readSessionIndex(notesDir);
    expect(index!.sessions).toHaveLength(2);
    expect(index!.sessions[0].sessionId).toBe('session-2'); // newest first
    expect(index!.sessions[1].sessionId).toBe('session-1');
  });
});
