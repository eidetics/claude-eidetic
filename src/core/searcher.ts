import type { Embedding } from '../embedding/types.js';
import type { VectorDB, SearchResult } from '../vectordb/types.js';
import { normalizePath, pathToCollectionName } from '../paths.js';
import { SearchError } from '../errors.js';

export interface SearchOptions {
  limit?: number;
  extensionFilter?: string[];
}

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

export async function searchCode(
  rootPath: string,
  query: string,
  embedding: Embedding,
  vectordb: VectorDB,
  options: SearchOptions = {},
): Promise<SearchResult[]> {
  const normalizedPath = normalizePath(rootPath);
  const collectionName = pathToCollectionName(normalizedPath);

  const exists = await vectordb.hasCollection(collectionName);
  if (!exists) {
    throw new SearchError(
      `Codebase at "${normalizedPath}" is not indexed. ` +
        `Use the index_codebase tool to index it first.`,
    );
  }

  const limit = Math.min(Math.max(1, options.limit ?? DEFAULT_LIMIT), MAX_LIMIT);
  const queryVector = await embedding.embed(query);
  const overFetchLimit = Math.min(limit * 5, MAX_LIMIT);

  const results = await vectordb.search(collectionName, {
    queryVector,
    queryText: query,
    limit: overFetchLimit,
    extensionFilter: options.extensionFilter,
  });

  return deduplicateResults(applyCategoryBoost(results), limit);
}

const CATEGORY_BOOST: Record<string, number> = {
  source: 1.0,
  test: 0.75,
  doc: 0.65,
  config: 0.7,
  generated: 0.6,
};
const DEFAULT_BOOST = 1.0; // legacy points without fileCategory get no penalty

export function applyCategoryBoost(results: SearchResult[]): SearchResult[] {
  return results
    .map((r) => ({
      ...r,
      score: r.score * (CATEGORY_BOOST[r.fileCategory ?? ''] ?? DEFAULT_BOOST),
    }))
    .sort((a, b) => b.score - a.score);
}

export function deduplicateResults(results: SearchResult[], limit: number): SearchResult[] {
  const accepted: SearchResult[] = [];
  // Track accepted line ranges per file: relativePath -> [startLine, endLine][]
  const fileRanges = new Map<string, [number, number][]>();

  for (const r of results) {
    if (accepted.length >= limit) break;

    const ranges = fileRanges.get(r.relativePath);
    if (ranges?.some(([s, e]) => r.startLine <= e && r.endLine >= s)) {
      continue; // overlaps with an already-accepted chunk from same file
    }

    accepted.push(r);
    if (!ranges) {
      fileRanges.set(r.relativePath, [[r.startLine, r.endLine]]);
    } else {
      ranges.push([r.startLine, r.endLine]);
    }
  }

  return accepted;
}

export function formatCompactResults(
  results: SearchResult[],
  query: string,
  rootPath: string,
): string {
  if (results.length === 0) {
    return `No results found for "${query}" in ${rootPath}.`;
  }

  const lines: string[] = [
    `Found ${results.length} result(s) for "${query}" in ${rootPath}:\n`,
    '| # | File | Lines | Score | ~Tokens |',
    '|---|------|-------|-------|---------|',
  ];

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const tokens = Math.ceil(r.content.length / 4);
    lines.push(
      `| ${i + 1} | \`${r.relativePath}\` | ${r.startLine}-${r.endLine} | ${r.score.toFixed(2)} | ~${tokens} |`,
    );
  }

  lines.push('');
  lines.push('Use the Read tool to view full code for specific results.');

  return lines.join('\n');
}

export function formatSearchResults(
  results: SearchResult[],
  query: string,
  rootPath: string,
): string {
  if (results.length === 0) {
    return `No results found for "${query}" in ${rootPath}.`;
  }

  const lines: string[] = [`Found ${results.length} result(s) for "${query}" in ${rootPath}:\n`];

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    lines.push(`### Result ${i + 1} of ${results.length}`);
    lines.push(`**File:** \`${r.relativePath}\` (lines ${r.startLine}-${r.endLine})`);
    lines.push(`**Language:** ${r.language} | **Score:** ${r.score.toFixed(4)}`);
    const safeLang = r.language.replace(/[^a-zA-Z0-9_+-]/g, '');
    lines.push('```' + safeLang);
    lines.push(r.content);
    lines.push('```');
    lines.push('');
  }

  return lines.join('\n');
}
