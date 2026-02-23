import { describe, it, expect } from 'vitest';
import { extractPayload, reciprocalRankFusion, rankByTermFrequency } from '../vectordb/qdrant.js';

describe('extractPayload', () => {
  it('extracts all standard fields', () => {
    const point = {
      id: 'abc',
      payload: {
        content: 'hello world',
        relativePath: 'src/foo.ts',
        startLine: 5,
        endLine: 15,
        fileExtension: '.ts',
        language: 'typescript',
        fileCategory: 'source',
      },
    };
    const result = extractPayload(point);
    expect(result.id).toBe('abc');
    expect(result.content).toBe('hello world');
    expect(result.relativePath).toBe('src/foo.ts');
    expect(result.startLine).toBe(5);
    expect(result.endLine).toBe(15);
    expect(result.fileExtension).toBe('.ts');
    expect(result.language).toBe('typescript');
    expect(result.fileCategory).toBe('source');
  });

  it('returns empty string for missing fileCategory (graceful degradation)', () => {
    const point = {
      id: 'abc',
      payload: {
        content: 'code',
        relativePath: 'src/old.ts',
        startLine: 1,
        endLine: 10,
        fileExtension: '.ts',
        language: 'typescript',
        // no fileCategory — legacy point
      },
    };
    const result = extractPayload(point);
    expect(result.fileCategory).toBe('');
  });

  it('handles null payload', () => {
    const point = { id: 1, payload: null };
    const result = extractPayload(point);
    expect(result.content).toBe('');
    expect(result.fileCategory).toBe('');
  });
});

describe('reciprocalRankFusion', () => {
  function makePoint(id: string, payload: Record<string, unknown>, score = 0.9) {
    return { id, score, payload };
  }

  it('passes fileCategory through to SearchResult', () => {
    const denseResults = [
      makePoint('1', {
        content: 'code',
        relativePath: 'src/a.ts',
        startLine: 1,
        endLine: 5,
        fileExtension: '.ts',
        language: 'typescript',
        fileCategory: 'source',
      }),
    ];
    const results = reciprocalRankFusion(denseResults, [], 10);
    expect(results[0].fileCategory).toBe('source');
  });

  it('passes empty fileCategory for legacy points', () => {
    const denseResults = [
      makePoint('1', {
        content: 'code',
        relativePath: 'src/a.ts',
        startLine: 1,
        endLine: 5,
        fileExtension: '.ts',
        language: 'typescript',
      }),
    ];
    const results = reciprocalRankFusion(denseResults, [], 10);
    expect(results[0].fileCategory).toBe('');
  });

  it('merges scores from dense and text results', () => {
    const denseResults = [
      makePoint(
        '1',
        {
          content: 'function foo',
          relativePath: 'src/a.ts',
          startLine: 1,
          endLine: 5,
          fileExtension: '.ts',
          language: 'typescript',
          fileCategory: 'source',
        },
        0.9,
      ),
      makePoint(
        '2',
        {
          content: 'class Bar',
          relativePath: 'src/b.ts',
          startLine: 1,
          endLine: 5,
          fileExtension: '.ts',
          language: 'typescript',
          fileCategory: 'source',
        },
        0.7,
      ),
    ];
    const textResults = rankByTermFrequency(
      [{ id: '1', payload: { content: 'function foo' } }],
      'function foo',
    );

    const results = reciprocalRankFusion(denseResults, textResults, 10);
    // Point 1 appears in both lists so should have a higher combined score
    expect(results[0].relativePath).toBe('src/a.ts');
  });

  it('respects limit', () => {
    const denseResults = Array.from({ length: 10 }, (_, i) =>
      makePoint(
        String(i),
        {
          content: `code${i}`,
          relativePath: `src/f${i}.ts`,
          startLine: 1,
          endLine: 5,
          fileExtension: '.ts',
          language: 'typescript',
          fileCategory: 'source',
        },
        1 - i * 0.05,
      ),
    );
    const results = reciprocalRankFusion(denseResults, [], 3);
    expect(results).toHaveLength(3);
  });
});

describe('rankByTermFrequency', () => {
  it('returns empty array for empty input', () => {
    expect(rankByTermFrequency([], 'query')).toEqual([]);
  });

  it('ranks by term frequency', () => {
    const points = [
      { id: '1', payload: { content: 'foo bar baz' } },
      { id: '2', payload: { content: 'foo foo foo bar baz' } },
    ];
    const ranked = rankByTermFrequency(points, 'foo');
    expect(ranked[0].id).toBe('2'); // more "foo" occurrences
  });
});
