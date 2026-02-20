import { describe, it, expect, afterEach } from 'vitest';
import { updateSessionIndex } from '../tier0-writer.js';
import { createTempCodebase, cleanupTempDir } from '../../__tests__/fixtures.js';
import type { ExtractedSession, SessionIndex } from '../types.js';
import fs from 'node:fs';
import path from 'node:path';

const makeSession = (id: string, overrides: Partial<ExtractedSession> = {}): ExtractedSession => ({
  sessionId: id,
  projectName: 'proj',
  projectPath: '/proj',
  branch: 'main',
  startTime: '2026-02-19T10:00:00Z',
  endTime: '2026-02-19T11:00:00Z',
  filesModified: ['/a.ts'],
  bashCommands: [],
  mcpToolsCalled: [],
  tasksCreated: ['Task 1'],
  tasksUpdated: [],
  userMessages: [],
  trigger: 'auto',
  ...overrides,
});

describe('updateSessionIndex', () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) cleanupTempDir(tmpDir);
  });

  it('creates .session-index.json if missing', () => {
    tmpDir = createTempCodebase({});
    updateSessionIndex(tmpDir, makeSession('sess1'), '/note.md');
    const indexPath = path.join(tmpDir, '.session-index.json');
    expect(fs.existsSync(indexPath)).toBe(true);
  });

  it('prepends new session to existing index', () => {
    tmpDir = createTempCodebase({
      '.session-index.json': JSON.stringify({
        project: 'proj',
        sessions: [{ sessionId: 'old', date: '2026-02-18', branch: 'main', filesModified: [], tasksCreated: [], trigger: 'auto', noteFile: '/old.md' }],
        lastUpdated: '',
      }),
    });
    updateSessionIndex(tmpDir, makeSession('new'), '/note.md');
    const index: SessionIndex = JSON.parse(
      fs.readFileSync(path.join(tmpDir, '.session-index.json'), 'utf-8')
    );
    expect(index.sessions[0].sessionId).toBe('new');
    expect(index.sessions[1].sessionId).toBe('old');
  });

  it('keeps only last 10 sessions', () => {
    const existingSessions = Array.from({ length: 12 }, (_, i) => ({
      sessionId: `old${i}`,
      date: '2026-02-01',
      branch: 'main',
      filesModified: [],
      tasksCreated: [],
      trigger: 'auto' as const,
      noteFile: '/old.md',
    }));
    tmpDir = createTempCodebase({
      '.session-index.json': JSON.stringify({
        project: 'proj',
        sessions: existingSessions,
        lastUpdated: '',
      }),
    });
    updateSessionIndex(tmpDir, makeSession('newest'), '/note.md');
    const index: SessionIndex = JSON.parse(
      fs.readFileSync(path.join(tmpDir, '.session-index.json'), 'utf-8')
    );
    expect(index.sessions).toHaveLength(10);
    expect(index.sessions[0].sessionId).toBe('newest');
  });

  it('includes all required Tier0Record fields', () => {
    tmpDir = createTempCodebase({});
    updateSessionIndex(tmpDir, makeSession('sess1'), '/path/to/note.md');
    const index: SessionIndex = JSON.parse(
      fs.readFileSync(path.join(tmpDir, '.session-index.json'), 'utf-8')
    );
    const record = index.sessions[0];
    expect(record).toHaveProperty('sessionId', 'sess1');
    expect(record).toHaveProperty('date', '2026-02-19');
    expect(record).toHaveProperty('branch', 'main');
    expect(record).toHaveProperty('filesModified', ['/a.ts']);
    expect(record).toHaveProperty('tasksCreated', ['Task 1']);
    expect(record).toHaveProperty('trigger', 'auto');
    expect(record).toHaveProperty('noteFile', '/path/to/note.md');
  });

  it('updates lastUpdated timestamp', () => {
    tmpDir = createTempCodebase({});
    const before = new Date().toISOString();
    updateSessionIndex(tmpDir, makeSession('sess1'), '/note.md');
    const index: SessionIndex = JSON.parse(
      fs.readFileSync(path.join(tmpDir, '.session-index.json'), 'utf-8')
    );
    expect(new Date(index.lastUpdated).getTime()).toBeGreaterThanOrEqual(
      new Date(before).getTime()
    );
  });

  it('preserves project name from session', () => {
    tmpDir = createTempCodebase({});
    updateSessionIndex(tmpDir, makeSession('sess1', { projectName: 'my-proj' }), '/note.md');
    const index: SessionIndex = JSON.parse(
      fs.readFileSync(path.join(tmpDir, '.session-index.json'), 'utf-8')
    );
    expect(index.project).toBe('my-proj');
  });

  it('handles null branch', () => {
    tmpDir = createTempCodebase({});
    updateSessionIndex(tmpDir, makeSession('sess1', { branch: null }), '/note.md');
    const index: SessionIndex = JSON.parse(
      fs.readFileSync(path.join(tmpDir, '.session-index.json'), 'utf-8')
    );
    expect(index.sessions[0].branch).toBeNull();
  });
});
