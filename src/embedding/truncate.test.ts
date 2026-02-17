import { describe, it, expect } from 'vitest';
import { truncateToSafeLength } from './truncate.js';

const MAX_EMBED_CHARS = 6000;

describe('truncateToSafeLength', () => {
  it('returns short text unchanged', () => {
    const text = 'hello world';
    expect(truncateToSafeLength(text)).toBe(text);
  });

  it('returns text at exactly the limit unchanged', () => {
    const text = 'a'.repeat(MAX_EMBED_CHARS);
    expect(truncateToSafeLength(text)).toBe(text);
  });

  it('truncates oversized text at last newline boundary', () => {
    const lines = Array.from({ length: 200 }, (_, i) => 'x'.repeat(50) + ` line${i}`);
    const text = lines.join('\n');
    expect(text.length).toBeGreaterThan(MAX_EMBED_CHARS);

    const result = truncateToSafeLength(text);
    expect(result.length).toBeLessThanOrEqual(MAX_EMBED_CHARS);
    expect(result.endsWith('\n')).toBe(false);
    expect(result).toContain('line');
  });

  it('truncates single long line without newlines (hard cut)', () => {
    const text = 'a'.repeat(10_000);
    const result = truncateToSafeLength(text);
    expect(result.length).toBe(MAX_EMBED_CHARS);
  });

  it('handles text with only a newline at the start', () => {
    const text = '\n' + 'b'.repeat(10_000);
    const result = truncateToSafeLength(text);
    expect(result.length).toBe(MAX_EMBED_CHARS);
  });

  it('preserves content before the cut point', () => {
    const prefix = 'first line\nsecond line\n';
    const filler = 'x'.repeat(MAX_EMBED_CHARS);
    const text = prefix + filler;
    const result = truncateToSafeLength(text);

    expect(result.startsWith('first line\n')).toBe(true);
    expect(result.length).toBeLessThanOrEqual(MAX_EMBED_CHARS);
  });

  it('handles empty string', () => {
    expect(truncateToSafeLength('')).toBe('');
  });

  it('handles minified JS (one giant line)', () => {
    const minified = 'var a=1;' + 'function f(){return 0;}'.repeat(1000);
    expect(minified.length).toBeGreaterThan(MAX_EMBED_CHARS);

    const result = truncateToSafeLength(minified);
    expect(result.length).toBe(MAX_EMBED_CHARS);
  });

  it('handles large JSON blob', () => {
    const entries = Array.from({ length: 500 }, (_, i) => `  "key_${i}": "value_${i}"`);
    const json = '{\n' + entries.join(',\n') + '\n}';
    expect(json.length).toBeGreaterThan(MAX_EMBED_CHARS);

    const result = truncateToSafeLength(json);
    expect(result.length).toBeLessThanOrEqual(MAX_EMBED_CHARS);
    expect(result).toContain('"key_');
  });
});
