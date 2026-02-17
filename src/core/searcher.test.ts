import { describe, it, expect } from 'vitest';
import { deduplicateResults, formatSearchResults, formatCompactResults } from './searcher.js';
import type { SearchResult } from '../vectordb/types.js';

function makeResult(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    content: 'function test() {}',
    relativePath: 'src/test.ts',
    startLine: 1,
    endLine: 10,
    fileExtension: '.ts',
    language: 'typescript',
    score: 0.9,
    ...overrides,
  };
}

describe('deduplicateResults', () => {
  it('respects limit', () => {
    const results = Array.from({ length: 10 }, (_, i) =>
      makeResult({ relativePath: `file${i}.ts`, score: 1 - i * 0.1 }),
    );
    const deduped = deduplicateResults(results, 3);
    expect(deduped).toHaveLength(3);
  });

  it('removes overlapping chunks from same file', () => {
    const results = [
      makeResult({ relativePath: 'a.ts', startLine: 1, endLine: 20, score: 0.9 }),
      makeResult({ relativePath: 'a.ts', startLine: 10, endLine: 30, score: 0.8 }), // overlaps
      makeResult({ relativePath: 'b.ts', startLine: 1, endLine: 10, score: 0.7 }),
    ];
    const deduped = deduplicateResults(results, 10);
    expect(deduped).toHaveLength(2);
    expect(deduped[0].score).toBe(0.9);
    expect(deduped[1].relativePath).toBe('b.ts');
  });

  it('keeps non-overlapping chunks from same file', () => {
    const results = [
      makeResult({ relativePath: 'a.ts', startLine: 1, endLine: 10, score: 0.9 }),
      makeResult({ relativePath: 'a.ts', startLine: 20, endLine: 30, score: 0.8 }),
    ];
    const deduped = deduplicateResults(results, 10);
    expect(deduped).toHaveLength(2);
  });

  it('keeps chunks from different files regardless of line overlap', () => {
    const results = [
      makeResult({ relativePath: 'a.ts', startLine: 1, endLine: 20, score: 0.9 }),
      makeResult({ relativePath: 'b.ts', startLine: 5, endLine: 15, score: 0.8 }),
    ];
    const deduped = deduplicateResults(results, 10);
    expect(deduped).toHaveLength(2);
  });

  it('prefers higher-scored results', () => {
    const results = [
      makeResult({ relativePath: 'a.ts', startLine: 1, endLine: 20, score: 0.95 }),
      makeResult({ relativePath: 'a.ts', startLine: 5, endLine: 15, score: 0.5 }), // overlaps, lower score
    ];
    const deduped = deduplicateResults(results, 10);
    expect(deduped).toHaveLength(1);
    expect(deduped[0].score).toBe(0.95);
  });

  it('handles empty input', () => {
    expect(deduplicateResults([], 10)).toEqual([]);
  });
});

describe('formatSearchResults', () => {
  it('formats markdown with file path, lines, language, score', () => {
    const results = [makeResult()];
    const output = formatSearchResults(results, 'test query', '/project');
    expect(output).toContain('Result 1 of 1');
    expect(output).toContain('src/test.ts');
    expect(output).toContain('lines 1-10');
    expect(output).toContain('typescript');
    expect(output).toContain('0.9000');
    expect(output).toContain('```typescript');
  });

  it('returns "No results found" for empty results', () => {
    const output = formatSearchResults([], 'test', '/project');
    expect(output).toContain('No results found');
  });

  it('sanitizes language name in code fence', () => {
    const results = [makeResult({ language: 'c++/special' })];
    const output = formatSearchResults(results, 'test', '/project');
    // Special chars should be stripped
    expect(output).toContain('```c+');
    expect(output).not.toContain('```c++/special');
  });
});

describe('formatCompactResults', () => {
  it('renders table header and rows', () => {
    const results = [
      makeResult({ relativePath: 'src/a.ts', startLine: 1, endLine: 20, score: 0.93 }),
      makeResult({ relativePath: 'src/b.ts', startLine: 5, endLine: 15, score: 0.87 }),
    ];
    const output = formatCompactResults(results, 'test query', '/project');
    expect(output).toContain('| # | File | Lines | Score | ~Tokens |');
    expect(output).toContain('| 1 | `src/a.ts` | 1-20 | 0.93 |');
    expect(output).toContain('| 2 | `src/b.ts` | 5-15 | 0.87 |');
  });

  it('shows token estimates based on content length', () => {
    // 'function test() {}' is 18 chars → ceil(18/4) = 5
    const results = [makeResult({ content: 'function test() {}' })];
    const output = formatCompactResults(results, 'test', '/project');
    expect(output).toContain('~5 |');
  });

  it('handles empty results', () => {
    const output = formatCompactResults([], 'test', '/project');
    expect(output).toContain('No results found');
  });

  it('shows hint about Read tool', () => {
    const results = [makeResult()];
    const output = formatCompactResults(results, 'test', '/project');
    expect(output).toContain('Use the Read tool to view full code for specific results.');
  });

  it('does not include code snippets', () => {
    const results = [makeResult({ content: 'function test() {}' })];
    const output = formatCompactResults(results, 'test', '/project');
    expect(output).not.toContain('function test() {}');
    expect(output).not.toContain('```');
  });
});
