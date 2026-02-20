import { describe, it, expect } from 'vitest';
import { formatTier0Context } from '../tier0-inject.js';

describe('formatTier0Context', () => {
  const makeSession = (overrides = {}) => ({
    date: '2026-02-19',
    branch: 'feat/auth',
    filesModified: ['/src/auth.ts', '/src/middleware.ts'],
    tasksCreated: ['Implement JWT'],
    ...overrides,
  });

  it('includes date and branch in header', () => {
    const output = formatTier0Context(makeSession(), 1);
    expect(output).toContain('Last session (2026-02-19, branch: feat/auth)');
  });

  it('shows "unknown" for null branch', () => {
    const output = formatTier0Context(makeSession({ branch: null }), 1);
    expect(output).toContain('branch: unknown');
  });

  it('lists modified files (basenames only)', () => {
    const output = formatTier0Context(makeSession(), 1);
    expect(output).toContain('Files modified: auth.ts, middleware.ts');
  });

  it('truncates file list with count when > 5', () => {
    const output = formatTier0Context(makeSession({
      filesModified: ['/a.ts', '/b.ts', '/c.ts', '/d.ts', '/e.ts', '/f.ts', '/g.ts'],
    }), 1);
    expect(output).toContain('(+2 more)');
  });

  it('lists tasks', () => {
    const output = formatTier0Context(makeSession(), 1);
    expect(output).toContain('Tasks: Implement JWT');
  });

  it('omits files line when no files modified', () => {
    const output = formatTier0Context(makeSession({ filesModified: [] }), 1);
    expect(output).not.toContain('Files modified');
  });

  it('omits tasks line when no tasks', () => {
    const output = formatTier0Context(makeSession({ tasksCreated: [] }), 1);
    expect(output).not.toContain('Tasks:');
  });

  it('shows session count when multiple available', () => {
    const output = formatTier0Context(makeSession(), 5);
    expect(output).toContain('(5 sessions available)');
  });

  it('does not show count for single session', () => {
    const output = formatTier0Context(makeSession(), 1);
    expect(output).not.toContain('sessions available');
  });

  it('always suggests /catchup', () => {
    const output = formatTier0Context(makeSession(), 1);
    expect(output).toContain('Run /catchup for full context');
  });
});
