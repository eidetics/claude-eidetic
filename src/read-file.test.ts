import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { handleReadFile } from './tools.js';

function getText(result: { content: { type: string; text: string }[] }): string {
  return result.content[0].text;
}

describe('handleReadFile', () => {
  let tempDir: string;
  let sampleFile: string;
  let emptyFile: string;
  let binaryFile: string;

  beforeAll(() => {
    tempDir = join(tmpdir(), `eidetic-read-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });

    sampleFile = join(tempDir, 'sample.txt');
    const lines = Array.from({ length: 20 }, (_, i) => `Line ${i + 1}`);
    writeFileSync(sampleFile, lines.join('\n'), 'utf-8');

    emptyFile = join(tempDir, 'empty.txt');
    writeFileSync(emptyFile, '', 'utf-8');

    binaryFile = join(tempDir, 'binary.bin');
    writeFileSync(binaryFile, Buffer.from([0x48, 0x65, 0x6c, 0x00, 0x6f]));
  });

  afterAll(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns error when path is missing', async () => {
    const result = await handleReadFile({});
    expect(getText(result)).toContain('Error: "path" is required');
  });

  it('reads file and returns raw content without line numbers', async () => {
    const result = await handleReadFile({ path: sampleFile });
    const text = getText(result);
    expect(text).toContain('Line 1');
    expect(text).toContain('Line 20');
    // Should NOT have line number prefixes by default
    expect(text).not.toMatch(/^\s*1 Line 1/m);
  });

  it('applies offset and limit correctly', async () => {
    const result = await handleReadFile({ path: sampleFile, offset: 5, limit: 3 });
    const text = getText(result);
    expect(text).toContain('Line 5');
    expect(text).toContain('Line 6');
    expect(text).toContain('Line 7');
    expect(text).not.toContain('Line 4');
    expect(text).not.toContain('Line 8');
    expect(text).toContain('Showing: 5–7');
  });

  it('returns line numbers when lineNumbers=true', async () => {
    const result = await handleReadFile({ path: sampleFile, offset: 1, limit: 3, lineNumbers: true });
    const text = getText(result);
    // Should have padded line numbers
    expect(text).toMatch(/1 Line 1/);
    expect(text).toMatch(/2 Line 2/);
    expect(text).toMatch(/3 Line 3/);
  });

  it('returns ENOENT error for missing file', async () => {
    const result = await handleReadFile({ path: join(tempDir, 'nonexistent.txt') });
    expect(getText(result)).toContain('Error: File not found');
  });

  it('returns error for binary files (null bytes)', async () => {
    const result = await handleReadFile({ path: binaryFile });
    expect(getText(result)).toContain('Error: Binary file detected');
  });

  it('caps limit at 10000', async () => {
    const result = await handleReadFile({ path: sampleFile, limit: 99999 });
    const text = getText(result);
    // Should still work — file only has 20 lines, but limit is clamped internally
    expect(text).toContain('Line 1');
    expect(text).toContain('Line 20');
  });

  it('includes metadata header with total line count', async () => {
    const result = await handleReadFile({ path: sampleFile });
    const text = getText(result);
    expect(text).toContain('Lines: 20 total');
  });

  it('includes continuation hint when truncated', async () => {
    const result = await handleReadFile({ path: sampleFile, offset: 1, limit: 5 });
    const text = getText(result);
    expect(text).toContain('Next: read_file(path=');
    expect(text).toContain('offset=6');
  });

  it('does not include continuation hint when all lines shown', async () => {
    const result = await handleReadFile({ path: sampleFile });
    const text = getText(result);
    expect(text).not.toContain('Next:');
  });

  it('handles empty files', async () => {
    const result = await handleReadFile({ path: emptyFile });
    const text = getText(result);
    expect(text).toContain('Lines: 0 total');
    expect(text).toContain('(empty file)');
  });

  it('returns error when path is a directory', async () => {
    const result = await handleReadFile({ path: tempDir });
    expect(getText(result)).toContain('Error: Path is a directory');
  });
});
