import { describe, it, expect } from 'vitest';
import { applyCategoryBoost, deduplicateResults } from '../core/searcher.js';
import type { SearchResult } from '../vectordb/types.js';

function makeResult(overrides: Partial<SearchResult> & { score: number }): SearchResult {
  return {
    content: 'test content',
    relativePath: 'src/test.ts',
    startLine: 1,
    endLine: 10,
    fileExtension: '.ts',
    language: 'typescript',
    ...overrides,
  };
}

describe('applyCategoryBoost', () => {
  it('applies 1.0 multiplier to source files', () => {
    const result = makeResult({ score: 1.0, fileCategory: 'source' });
    const [boosted] = applyCategoryBoost([result]);
    expect(boosted.score).toBe(1.0);
  });

  it('applies 0.75 multiplier to test files', () => {
    const result = makeResult({ score: 1.0, fileCategory: 'test' });
    const [boosted] = applyCategoryBoost([result]);
    expect(boosted.score).toBeCloseTo(0.75);
  });

  it('applies 0.65 multiplier to doc files', () => {
    const result = makeResult({ score: 1.0, fileCategory: 'doc' });
    const [boosted] = applyCategoryBoost([result]);
    expect(boosted.score).toBeCloseTo(0.65);
  });

  it('applies 0.70 multiplier to config files', () => {
    const result = makeResult({ score: 1.0, fileCategory: 'config' });
    const [boosted] = applyCategoryBoost([result]);
    expect(boosted.score).toBeCloseTo(0.70);
  });

  it('applies 0.60 multiplier to generated files', () => {
    const result = makeResult({ score: 1.0, fileCategory: 'generated' });
    const [boosted] = applyCategoryBoost([result]);
    expect(boosted.score).toBeCloseTo(0.60);
  });

  it('applies no penalty (1.0) to results without fileCategory (legacy points)', () => {
    const result = makeResult({ score: 1.0 }); // no fileCategory
    const [boosted] = applyCategoryBoost([result]);
    expect(boosted.score).toBeCloseTo(1.0);
  });

  it('applies no penalty (1.0) to results with empty fileCategory (legacy points)', () => {
    const result = makeResult({ score: 1.0, fileCategory: '' });
    const [boosted] = applyCategoryBoost([result]);
    expect(boosted.score).toBeCloseTo(1.0);
  });

  it('re-sorts results after boosting', () => {
    // doc file with higher raw score should be re-ranked below source file
    const docResult = makeResult({ score: 1.0, fileCategory: 'doc', relativePath: 'README.md' });
    const sourceResult = makeResult({ score: 0.8, fileCategory: 'source', relativePath: 'src/core.ts' });
    const boosted = applyCategoryBoost([docResult, sourceResult]);
    // doc: 1.0 * 0.65 = 0.65, source: 0.8 * 1.0 = 0.8 → source should be first
    expect(boosted[0].relativePath).toBe('src/core.ts');
    expect(boosted[1].relativePath).toBe('README.md');
  });

  it('preserves all result fields', () => {
    const result = makeResult({ score: 0.9, fileCategory: 'source' });
    const [boosted] = applyCategoryBoost([result]);
    expect(boosted.content).toBe(result.content);
    expect(boosted.relativePath).toBe(result.relativePath);
    expect(boosted.startLine).toBe(result.startLine);
    expect(boosted.endLine).toBe(result.endLine);
    expect(boosted.fileExtension).toBe(result.fileExtension);
    expect(boosted.language).toBe(result.language);
    expect(boosted.fileCategory).toBe(result.fileCategory);
  });

  it('returns empty array for empty input', () => {
    expect(applyCategoryBoost([])).toEqual([]);
  });
});

describe('deduplicateResults', () => {
  it('removes overlapping chunks from the same file', () => {
    const results: SearchResult[] = [
      makeResult({ score: 1.0, relativePath: 'src/a.ts', startLine: 1, endLine: 20 }),
      makeResult({ score: 0.9, relativePath: 'src/a.ts', startLine: 15, endLine: 30 }), // overlaps
      makeResult({ score: 0.8, relativePath: 'src/b.ts', startLine: 1, endLine: 10 }),
    ];
    const deduped = deduplicateResults(results, 10);
    expect(deduped).toHaveLength(2);
    expect(deduped[0].relativePath).toBe('src/a.ts');
    expect(deduped[1].relativePath).toBe('src/b.ts');
  });

  it('allows non-overlapping chunks from the same file', () => {
    const results: SearchResult[] = [
      makeResult({ score: 1.0, relativePath: 'src/a.ts', startLine: 1, endLine: 10 }),
      makeResult({ score: 0.9, relativePath: 'src/a.ts', startLine: 20, endLine: 30 }), // no overlap
    ];
    const deduped = deduplicateResults(results, 10);
    expect(deduped).toHaveLength(2);
  });

  it('respects limit', () => {
    const results: SearchResult[] = Array.from({ length: 10 }, (_, i) =>
      makeResult({ score: 1 - i * 0.1, relativePath: `src/file${i}.ts`, startLine: 1, endLine: 10 }),
    );
    const deduped = deduplicateResults(results, 3);
    expect(deduped).toHaveLength(3);
  });
});
