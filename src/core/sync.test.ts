import { describe, it, expect, afterEach } from 'vitest';
import {
  extensionToLanguage,
  diffSnapshots,
  parseGitignorePatterns,
  buildSnapshot,
  scanFiles,
} from './sync.js';
import type { FileSnapshot } from './sync.js';
import { createTempCodebase, cleanupTempDir } from '../__test__/fixtures.js';

/** Normalize path separators for cross-platform assertions */
const norm = (p: string) => p.replace(/\\/g, '/');

describe('extensionToLanguage', () => {
  it('maps common extensions', () => {
    expect(extensionToLanguage('.ts')).toBe('typescript');
    expect(extensionToLanguage('.tsx')).toBe('tsx');
    expect(extensionToLanguage('.py')).toBe('python');
    expect(extensionToLanguage('.js')).toBe('javascript');
    expect(extensionToLanguage('.go')).toBe('go');
    expect(extensionToLanguage('.rs')).toBe('rust');
    expect(extensionToLanguage('.java')).toBe('java');
    expect(extensionToLanguage('.cpp')).toBe('cpp');
    expect(extensionToLanguage('.cs')).toBe('csharp');
  });

  it('returns "unknown" for unmapped extensions', () => {
    expect(extensionToLanguage('.xyz')).toBe('unknown');
    expect(extensionToLanguage('.foo')).toBe('unknown');
  });

  it('is case-insensitive', () => {
    expect(extensionToLanguage('.TS')).toBe('typescript');
    expect(extensionToLanguage('.PY')).toBe('python');
  });
});

describe('diffSnapshots', () => {
  it('detects added files', () => {
    const prev: FileSnapshot = {};
    const curr: FileSnapshot = { 'a.ts': { contentHash: 'abc123' } };
    const result = diffSnapshots(prev, curr);
    expect(result.added).toEqual(['a.ts']);
    expect(result.modified).toEqual([]);
    expect(result.removed).toEqual([]);
  });

  it('detects removed files', () => {
    const prev: FileSnapshot = { 'a.ts': { contentHash: 'abc123' } };
    const curr: FileSnapshot = {};
    const result = diffSnapshots(prev, curr);
    expect(result.removed).toEqual(['a.ts']);
    expect(result.added).toEqual([]);
  });

  it('detects modified files', () => {
    const prev: FileSnapshot = { 'a.ts': { contentHash: 'abc123' } };
    const curr: FileSnapshot = { 'a.ts': { contentHash: 'def456' } };
    const result = diffSnapshots(prev, curr);
    expect(result.modified).toEqual(['a.ts']);
    expect(result.added).toEqual([]);
    expect(result.removed).toEqual([]);
  });

  it('detects unchanged files (not in any list)', () => {
    const prev: FileSnapshot = { 'a.ts': { contentHash: 'same' } };
    const curr: FileSnapshot = { 'a.ts': { contentHash: 'same' } };
    const result = diffSnapshots(prev, curr);
    expect(result.added).toEqual([]);
    expect(result.modified).toEqual([]);
    expect(result.removed).toEqual([]);
  });

  it('handles empty snapshots', () => {
    const result = diffSnapshots({}, {});
    expect(result.added).toEqual([]);
    expect(result.modified).toEqual([]);
    expect(result.removed).toEqual([]);
  });

  it('handles mixed add/modify/remove', () => {
    const prev: FileSnapshot = {
      'keep.ts': { contentHash: 'aaa' },
      'change.ts': { contentHash: 'bbb' },
      'delete.ts': { contentHash: 'ccc' },
    };
    const curr: FileSnapshot = {
      'keep.ts': { contentHash: 'aaa' },
      'change.ts': { contentHash: 'xxx' },
      'new.ts': { contentHash: 'ddd' },
    };
    const result = diffSnapshots(prev, curr);
    expect(result.added).toEqual(['new.ts']);
    expect(result.modified).toEqual(['change.ts']);
    expect(result.removed).toEqual(['delete.ts']);
  });
});

describe('parseGitignorePatterns', () => {
  it('filters out comments', () => {
    const patterns = parseGitignorePatterns('# comment\nnode_modules');
    expect(patterns).toEqual(['**/node_modules']);
  });

  it('filters out blank lines', () => {
    const patterns = parseGitignorePatterns('\n\nnode_modules\n\n');
    expect(patterns).toEqual(['**/node_modules']);
  });

  it('strips trailing whitespace', () => {
    const patterns = parseGitignorePatterns('node_modules   ');
    expect(patterns).toEqual(['**/node_modules']);
  });

  it('handles directory patterns (trailing /)', () => {
    const patterns = parseGitignorePatterns('dist/');
    expect(patterns).toEqual(['**/dist']);
  });

  it('handles rooted patterns (leading /)', () => {
    const patterns = parseGitignorePatterns('/build');
    expect(patterns).toEqual(['build']);
  });

  it('wraps unrooted patterns without / in **/', () => {
    const patterns = parseGitignorePatterns('*.log');
    expect(patterns).toEqual(['**/*.log']);
  });

  it('preserves patterns with internal slashes', () => {
    const patterns = parseGitignorePatterns('docs/internal');
    expect(patterns).toEqual(['docs/internal']);
  });

  it('skips negation patterns', () => {
    const patterns = parseGitignorePatterns('!important.ts\nnode_modules');
    expect(patterns).toEqual(['**/node_modules']);
  });

  it('handles empty content', () => {
    expect(parseGitignorePatterns('')).toEqual([]);
  });
});

describe('buildSnapshot', () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) cleanupTempDir(tmpDir);
  });

  it('hashes file content', () => {
    tmpDir = createTempCodebase({ 'a.ts': 'const x = 1;' });
    const snapshot = buildSnapshot(tmpDir, ['a.ts']);
    expect(snapshot['a.ts']).toBeDefined();
    expect(snapshot['a.ts'].contentHash).toMatch(/^[a-f0-9]{16}$/);
  });

  it('produces different hashes for different content', () => {
    tmpDir = createTempCodebase({ 'a.ts': 'const x = 1;', 'b.ts': 'const y = 2;' });
    const snapshot = buildSnapshot(tmpDir, ['a.ts', 'b.ts']);
    expect(snapshot['a.ts'].contentHash).not.toBe(snapshot['b.ts'].contentHash);
  });

  it('skips unreadable files without crashing', () => {
    tmpDir = createTempCodebase({ 'a.ts': 'hello' });
    const snapshot = buildSnapshot(tmpDir, ['a.ts', 'nonexistent.ts']);
    expect(snapshot['a.ts']).toBeDefined();
    expect(snapshot['nonexistent.ts']).toBeUndefined();
  });

  it('returns empty snapshot for empty input', () => {
    tmpDir = createTempCodebase({});
    const snapshot = buildSnapshot(tmpDir, []);
    expect(Object.keys(snapshot)).toEqual([]);
  });
});

describe('scanFiles', () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) cleanupTempDir(tmpDir);
  });

  it('finds files with default extensions', async () => {
    tmpDir = createTempCodebase({
      'src/a.ts': 'code',
      'src/b.py': 'code',
      'readme.txt': 'not indexed',
    });
    const files = (await scanFiles(tmpDir)).map(norm);
    expect(files).toContain('src/a.ts');
    expect(files).toContain('src/b.py');
    expect(files).not.toContain('readme.txt');
  });

  it('includes custom extensions', async () => {
    tmpDir = createTempCodebase({
      'file.custom': 'custom code',
      'file.ts': 'ts code',
    });
    const files = (await scanFiles(tmpDir, ['.custom'])).map(norm);
    expect(files).toContain('file.custom');
    expect(files).toContain('file.ts');
  });

  it('applies custom ignore patterns', async () => {
    tmpDir = createTempCodebase({
      'src/a.ts': 'code',
      'generated/b.ts': 'generated',
    });
    const files = (await scanFiles(tmpDir, [], ['**/generated/**'])).map(norm);
    expect(files).toContain('src/a.ts');
    expect(files).not.toContain('generated/b.ts');
  });

  it('respects .gitignore', async () => {
    tmpDir = createTempCodebase({
      '.gitignore': '*.log\nsecrets.ts',
      'src/a.ts': 'code',
      'debug.log': 'log data',
      'src/secrets.ts': 'secret',
    });
    const files = (await scanFiles(tmpDir)).map(norm);
    expect(files).toContain('src/a.ts');
    // *.log doesn't match default extensions anyway, but secrets.ts should be ignored
    expect(files).not.toContain('src/secrets.ts');
  });

  it('returns sorted output', async () => {
    tmpDir = createTempCodebase({
      'z.ts': 'z',
      'a.ts': 'a',
      'm.ts': 'm',
    });
    const files = await scanFiles(tmpDir);
    expect(files).toEqual([...files].sort());
  });
});
