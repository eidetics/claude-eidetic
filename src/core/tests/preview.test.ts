import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { previewCodebase } from '../preview.js';
import { MockEmbedding } from '../../__tests__/mock-embedding.js';

let tmpDir: string;
const embedding = new MockEmbedding();

function setup(files: Record<string, string>): string {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eidetic-preview-'));
  for (const [name, content] of Object.entries(files)) {
    const fullPath = path.join(tmpDir, name);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
  }
  return tmpDir;
}

afterEach(() => {
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('previewCodebase', () => {
  it('counts files and groups by extension', async () => {
    setup({
      'src/a.ts': 'const a = 1;',
      'src/b.ts': 'const b = 2;',
      'lib/c.js': 'var c = 3;',
    });

    const result = await previewCodebase(tmpDir, embedding);
    expect(result.totalFiles).toBe(3);
    expect(result.byExtension['.ts']).toBe(2);
    expect(result.byExtension['.js']).toBe(1);
  });

  it('computes top directories sorted by count', async () => {
    setup({
      'src/a.ts': 'a',
      'src/b.ts': 'b',
      'src/c.ts': 'c',
      'lib/d.js': 'd',
    });

    const result = await previewCodebase(tmpDir, embedding);
    expect(result.topDirectories[0].dir).toBe('src');
    expect(result.topDirectories[0].count).toBe(3);
    expect(result.topDirectories[1].dir).toBe('lib');
    expect(result.topDirectories[1].count).toBe(1);
  });

  it('estimates tokens from file sizes', async () => {
    const content = 'x'.repeat(300); // 300 bytes → ~100 tokens (300/3)
    setup({ 'src/a.ts': content });

    const result = await previewCodebase(tmpDir, embedding);
    expect(result.estimatedTokens).toBe(100);
    expect(result.estimatedCostUsd).toBeGreaterThan(0);
  });

  it('warns when no indexable files found', async () => {
    setup({}); // empty directory

    const result = await previewCodebase(tmpDir, embedding);
    expect(result.totalFiles).toBe(0);
    expect(result.warnings).toContain('No indexable files found. Check file extension filters and ignore patterns.');
  });

  it('warns when dominant directory exceeds 50%', async () => {
    // 4/5 files in 'generated' → 80%
    setup({
      'generated/a.ts': 'a',
      'generated/b.ts': 'b',
      'generated/c.ts': 'c',
      'generated/d.ts': 'd',
      'src/e.ts': 'e',
    });

    const result = await previewCodebase(tmpDir, embedding);
    const domWarning = result.warnings.find(w => w.includes('generated'));
    expect(domWarning).toBeDefined();
    expect(domWarning).toContain('80%');
  });

  it('respects custom extensions', async () => {
    setup({
      'src/a.ts': 'a',
      'src/b.dart': 'b',
    });

    const result = await previewCodebase(tmpDir, embedding, ['.dart']);
    expect(result.byExtension['.dart']).toBe(1);
  });

  it('respects custom ignore patterns', async () => {
    setup({
      'src/a.ts': 'a',
      'dist/b.js': 'b',
    });

    const result = await previewCodebase(tmpDir, embedding, [], ['**/dist/**']);
    expect(result.totalFiles).toBe(1);
    expect(result.byExtension['.js']).toBeUndefined();
  });
});
