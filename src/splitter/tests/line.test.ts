import { describe, it, expect } from 'vitest';
import { LineSplitter } from '../line.js';

const MAX_CHUNK_CHARS = 2500;

describe('LineSplitter', () => {
  const splitter = new LineSplitter();

  it('splits normal code into chunks', () => {
    const lines = Array.from({ length: 120 }, (_, i) => `const x${i} = ${i};`);
    const code = lines.join('\n');
    const chunks = splitter.split(code, 'javascript', 'test.js');

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.content.trim().length).toBeGreaterThan(0);
    }
  });

  it('enforces MAX_CHUNK_CHARS on chunks with long lines', () => {
    const longLine = 'x'.repeat(5000);
    const code = [longLine, longLine, longLine].join('\n');
    const chunks = splitter.split(code, 'javascript', 'bundle.min.js');

    for (const chunk of chunks) {
      expect(chunk.content.length).toBeLessThanOrEqual(MAX_CHUNK_CHARS + 200);
    }
  });

  it('splits a single extremely long line', () => {
    const code = 'a'.repeat(20_000);
    const chunks = splitter.split(code, 'text', 'huge.txt');
    expect(chunks.length).toBeGreaterThanOrEqual(1);
  });

  it('handles large JSON-like content (many short lines)', () => {
    const lines = Array.from({ length: 200 }, (_, i) => `  "key_${i}": "value_${i}",`);
    const code = lines.join('\n');
    const chunks = splitter.split(code, 'json', 'data.json');

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeLessThanOrEqual(MAX_CHUNK_CHARS + 200);
    }
  });

  it('handles mix of normal and very long lines', () => {
    const lines = [
      ...Array.from({ length: 10 }, (_, i) => `line ${i}`),
      'x'.repeat(8000),
      ...Array.from({ length: 10 }, (_, i) => `line ${i + 10}`),
    ];
    const code = lines.join('\n');
    const chunks = splitter.split(code, 'javascript', 'mixed.js');

    expect(chunks.length).toBeGreaterThanOrEqual(1);
    const normalChunks = chunks.filter(c => !c.content.includes('xxxx'));
    for (const chunk of normalChunks) {
      expect(chunk.content.length).toBeLessThanOrEqual(MAX_CHUNK_CHARS + 200);
    }
  });

  it('preserves startLine/endLine metadata after refinement', () => {
    const longLine = 'y'.repeat(5000);
    const code = ['short line', longLine, 'another short'].join('\n');
    const chunks = splitter.split(code, 'text', 'meta.txt');

    expect(chunks.length).toBeGreaterThanOrEqual(1);
    for (const chunk of chunks) {
      expect(chunk.startLine).toBeGreaterThanOrEqual(1);
      expect(chunk.endLine).toBeGreaterThanOrEqual(chunk.startLine);
      expect(chunk.filePath).toBe('meta.txt');
      expect(chunk.language).toBe('text');
    }
  });

  it('returns empty array for empty input', () => {
    const chunks = splitter.split('', 'text', 'empty.txt');
    expect(chunks.length).toBe(0);
  });

  it('returns empty array for whitespace-only input', () => {
    const chunks = splitter.split('   \n  \n   ', 'text', 'blank.txt');
    expect(chunks.length).toBe(0);
  });
});
