import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn, execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { createTempCodebase, cleanupTempDir } from '../__tests__/fixtures.js';

const HOOK_PATH = path.resolve('dist/hooks/stop-hook.js');

interface HookResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Spawns dist/hooks/stop-hook.js, writes payload to stdin,
 * collects stdout + stderr, and returns { stdout, stderr, exitCode }.
 */
async function invokeStopHook(payload: unknown, cwdOverride?: string): Promise<HookResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [HOOK_PATH], {
      cwd: cwdOverride ?? process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on('close', (code) => {
      resolve({ stdout, stderr, exitCode: code ?? 0 });
    });

    child.on('error', reject);

    const input = typeof payload === 'string' ? payload : JSON.stringify(payload);
    child.stdin.write(input);
    child.stdin.end();
  });
}

/**
 * Initialises a git repo in an existing directory with an initial commit
 * containing all current files.
 */
function initGitRepo(dir: string): void {
  execFileSync('git', ['init'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: dir });
  execFileSync('git', ['add', '.'], { cwd: dir });
  execFileSync('git', ['commit', '-m', 'initial'], { cwd: dir });
}

/**
 * Mimics what the PostToolUse hook does: creates the shadow index directory
 * structure under .git/claude/indexes/<sessionId>/ and optionally stages
 * extra files into it.
 */
function createShadowIndex(
  repoDir: string,
  sessionId: string,
  extraFiles?: Record<string, string>,
): void {
  const gitDirRaw = execFileSync('git', ['-C', repoDir, 'rev-parse', '--git-dir'], {
    encoding: 'utf-8',
  }).trim();
  const absGitDir = path.isAbsolute(gitDirRaw) ? gitDirRaw : path.resolve(repoDir, gitDirRaw);

  const shadowDir = path.join(absGitDir, 'claude', 'indexes', sessionId);
  fs.mkdirSync(shadowDir, { recursive: true });

  const baseCommit = execFileSync('git', ['-C', repoDir, 'rev-parse', 'HEAD'], {
    encoding: 'utf-8',
  }).trim();
  fs.writeFileSync(path.join(shadowDir, 'base_commit'), baseCommit, 'utf-8');

  const shadowIndex = path.join(shadowDir, 'index');
  execFileSync(
    'git',
    ['-C', repoDir, 'read-tree', `--index-output=${shadowIndex}`, 'HEAD'],
    { encoding: 'utf-8' },
  );

  if (extraFiles) {
    for (const [relPath, content] of Object.entries(extraFiles)) {
      const fullPath = path.join(repoDir, relPath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, content, 'utf-8');
      execFileSync('git', ['-C', repoDir, 'add', relPath], {
        env: { ...process.env, GIT_INDEX_FILE: shadowIndex },
        encoding: 'utf-8',
      });
    }
  }
}

// ---------------------------------------------------------------------------

describe('stop-hook stdin/stdout protocol', () => {
  it('outputs {} for invalid JSON input', async () => {
    const { stdout, exitCode } = await invokeStopHook('not valid json at all');
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout)).toEqual({});
  });

  it('outputs {} for missing required fields', async () => {
    const { stdout, exitCode } = await invokeStopHook({ hook_event_name: 'Stop' });
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout)).toEqual({});
  });

  it('outputs {} for wrong hook_event_name', async () => {
    const { stdout, exitCode } = await invokeStopHook({
      session_id: 'test-session',
      cwd: os.tmpdir(),
      hook_event_name: 'UserPromptSubmit',
    });
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout)).toEqual({});
  });
});

// ---------------------------------------------------------------------------

describe('stop-hook with non-git cwd', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempCodebase({ 'readme.txt': 'hello' });
    // Deliberately NOT running git init
  });

  afterEach(() => {
    cleanupTempDir(tempDir);
  });

  it('outputs {} and exits 0 for non-git directory', async () => {
    const { stdout, exitCode } = await invokeStopHook({
      session_id: 'test-session-abc',
      cwd: tempDir,
      hook_event_name: 'Stop',
    });
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout)).toEqual({});
  });
});

// ---------------------------------------------------------------------------

describe('stop-hook with no shadow index', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = createTempCodebase({ 'src/index.ts': 'export const x = 1;\n' });
    initGitRepo(repoDir);
    // Deliberately NOT calling createShadowIndex
  });

  afterEach(() => {
    cleanupTempDir(repoDir);
  });

  it('outputs {} and exits 0 when shadow index does not exist', async () => {
    const { stdout, exitCode } = await invokeStopHook({
      session_id: 'no-shadow-session',
      cwd: repoDir,
      hook_event_name: 'Stop',
    });
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout)).toEqual({});
  });
});

// ---------------------------------------------------------------------------

describe('stop-hook happy path', () => {
  let repoDir: string;
  let sessionId: string;

  beforeEach(() => {
    sessionId = `test-session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    repoDir = createTempCodebase({ 'src/index.ts': 'export const x = 1;\n' });
    initGitRepo(repoDir);
    createShadowIndex(repoDir, sessionId, {
      'src/modified.ts': 'export const y = 2;\n',
    });
  });

  afterEach(() => {
    cleanupTempDir(repoDir);
    const manifestFile = path.join(os.tmpdir(), `eidetic-reindex-${sessionId}.json`);
    if (fs.existsSync(manifestFile)) {
      fs.rmSync(manifestFile);
    }
  });

  it('outputs {} on success', async () => {
    const { stdout, exitCode } = await invokeStopHook({
      session_id: sessionId,
      cwd: repoDir,
      hook_event_name: 'Stop',
    });
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout)).toEqual({});
  });

  it('creates a commit ref at refs/heads/claude/<session-id>', async () => {
    await invokeStopHook({
      session_id: sessionId,
      cwd: repoDir,
      hook_event_name: 'Stop',
    });

    const refOutput = execFileSync(
      'git',
      ['-C', repoDir, 'show-ref', `refs/heads/claude/${sessionId}`],
      { encoding: 'utf-8' },
    );
    expect(refOutput.trim()).toBeTruthy();
  });

  it('writes manifest JSON to tmpdir with projectPath and modifiedFiles', async () => {
    await invokeStopHook({
      session_id: sessionId,
      cwd: repoDir,
      hook_event_name: 'Stop',
    });

    const manifestFile = path.join(os.tmpdir(), `eidetic-reindex-${sessionId}.json`);
    expect(fs.existsSync(manifestFile)).toBe(true);

    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf-8')) as {
      projectPath: string;
      modifiedFiles: string[];
    };
    expect(manifest.projectPath).toBe(repoDir);
    expect(manifest.modifiedFiles).toContain('src/modified.ts');
  });

  it('removes shadow index directory after processing', async () => {
    const gitDirRaw = execFileSync('git', ['-C', repoDir, 'rev-parse', '--git-dir'], {
      encoding: 'utf-8',
    }).trim();
    const absGitDir = path.isAbsolute(gitDirRaw) ? gitDirRaw : path.resolve(repoDir, gitDirRaw);
    const shadowDir = path.join(absGitDir, 'claude', 'indexes', sessionId);

    expect(fs.existsSync(shadowDir)).toBe(true); // sanity: exists before hook

    await invokeStopHook({
      session_id: sessionId,
      cwd: repoDir,
      hook_event_name: 'Stop',
    });

    expect(fs.existsSync(shadowDir)).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe('stop-hook with no modified files', () => {
  let repoDir: string;
  let sessionId: string;

  beforeEach(() => {
    sessionId = `test-session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    repoDir = createTempCodebase({ 'src/index.ts': 'export const x = 1;\n' });
    initGitRepo(repoDir);
    // Shadow index identical to HEAD — no extra files
    createShadowIndex(repoDir, sessionId);
  });

  afterEach(() => {
    cleanupTempDir(repoDir);
  });

  it('outputs {} without writing manifest when diff is empty', async () => {
    const { stdout, exitCode } = await invokeStopHook({
      session_id: sessionId,
      cwd: repoDir,
      hook_event_name: 'Stop',
    });
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout)).toEqual({});

    const manifestFile = path.join(os.tmpdir(), `eidetic-reindex-${sessionId}.json`);
    expect(fs.existsSync(manifestFile)).toBe(false);
  });
});
