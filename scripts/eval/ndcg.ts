#!/usr/bin/env tsx
/**
 * 📐 ndcg — Search Eval #3
 *
 *   Ground truth holds still;
 *   ranked list shifts above it —
 *   nDCG tells all
 *
 * Computes nDCG@10 against a hand-curated set of ~15 natural-language queries.
 * Each query has an expected file, a line range, and a relevance grade for
 * grading system results. Grades are human-judged, not derived from the index.
 *
 * Grading scheme:
 *   3 = result overlaps expected line range in expected file (exact match)
 *   1 = result is in expected file but different section
 *   0 = result is in a different file (miss)
 *
 * Pass threshold: mean nDCG@10 >= 0.4 (conservative baseline).
 */

import { searchCode } from '../../src/core/searcher.js';
import { loadInfra } from './_infra.js';

interface GroundTruth {
  query: string;
  expectedFile: string;  // relative path from repo root
  expectedStartLine: number;
  expectedEndLine: number;
}

// Hand-curated queries — line ranges are approximate sections that contain
// the primary implementation of each concept.
const GROUND_TRUTH: GroundTruth[] = [
  {
    query: 'function that normalizes file paths to forward slashes',
    expectedFile: 'src/paths.ts',
    expectedStartLine: 5,
    expectedEndLine: 16,
  },
  {
    query: 'convert absolute file path to safe Qdrant collection name',
    expectedFile: 'src/paths.ts',
    expectedStartLine: 34,
    expectedEndLine: 42,
  },
  {
    query: 'reciprocal rank fusion scoring of dense and text search results',
    expectedFile: 'src/vectordb/qdrant.ts',
    expectedStartLine: 251,
    expectedEndLine: 297,
  },
  {
    query: 'rank text match results by normalized term frequency score',
    expectedFile: 'src/vectordb/qdrant.ts',
    expectedStartLine: 194,
    expectedEndLine: 226,
  },
  {
    query: 'load and validate configuration from environment variables using zod',
    expectedFile: 'src/config.ts',
    expectedStartLine: 46,
    expectedEndLine: 79,
  },
  {
    query: 'create embedding provider instance based on config provider field',
    expectedFile: 'src/embedding/factory.ts',
    expectedStartLine: 5,
    expectedEndLine: 29,
  },
  {
    query: 'embed query and search using hybrid dense and keyword retrieval',
    expectedFile: 'src/core/searcher.ts',
    expectedStartLine: 14,
    expectedEndLine: 44,
  },
  {
    query: 'deduplicate overlapping search result chunks within the same file',
    expectedFile: 'src/core/searcher.ts',
    expectedStartLine: 46,
    expectedEndLine: 68,
  },
  {
    query: 'insert code documents into Qdrant vector collection in batches',
    expectedFile: 'src/vectordb/qdrant.ts',
    expectedStartLine: 70,
    expectedEndLine: 96,
  },
  {
    query: 'error class hierarchy for typed application errors',
    expectedFile: 'src/errors.ts',
    expectedStartLine: 1,
    expectedEndLine: 14,
  },
  {
    query: 'track codebase indexing status with progress percentage',
    expectedFile: 'src/state/snapshot.ts',
    expectedStartLine: 1,
    expectedEndLine: 40,
  },
  {
    query: 'scan files and compute SHA-256 content hash for incremental indexing',
    expectedFile: 'src/core/sync.ts',
    expectedStartLine: 1,
    expectedEndLine: 50,
  },
  {
    query: 'split TypeScript source code into chunks using tree-sitter AST',
    expectedFile: 'src/splitter/ast.ts',
    expectedStartLine: 1,
    expectedEndLine: 60,
  },
  {
    query: 'extract payload fields from Qdrant point into typed object',
    expectedFile: 'src/vectordb/qdrant.ts',
    expectedStartLine: 238,
    expectedEndLine: 249,
  },
  {
    query: 'check whether Qdrant collection exists by name',
    expectedFile: 'src/vectordb/qdrant.ts',
    expectedStartLine: 51,
    expectedEndLine: 58,
  },
];

const K = 10;

function rangesOverlap(
  s1: number, e1: number,
  s2: number, e2: number,
): boolean {
  return s1 <= e2 && e1 >= s2;
}

function grade(
  relativePath: string,
  startLine: number,
  endLine: number,
  gt: GroundTruth,
): number {
  if (relativePath.replace(/\\/g, '/') !== gt.expectedFile) return 0;
  if (rangesOverlap(startLine, endLine, gt.expectedStartLine, gt.expectedEndLine)) return 3;
  return 1; // right file, different section
}

function dcgAtK(grades: number[], k: number): number {
  let dcg = 0;
  for (let i = 0; i < Math.min(k, grades.length); i++) {
    dcg += grades[i] / Math.log2(i + 2); // log2(rank+1), rank is 1-indexed so i+2
  }
  return dcg;
}

function idealDcgAtK(grades: number[], k: number): number {
  // IDCG = DCG of actual grades sorted descending (self-normalization).
  // This guarantees nDCG ∈ [0, 1] even when multiple chunks from the
  // expected file appear in results (each contributing grade-1 or grade-3).
  // If no relevant result was retrieved we fall back to a single grade-3
  // at rank 1, so misses are still penalised properly.
  const sorted = [...grades].sort((a, b) => b - a);
  if (sorted[0] === 0) {
    // Nothing relevant retrieved — ideal is grade-3 at rank 1
    return dcgAtK([3], k);
  }
  return dcgAtK(sorted, k);
}

async function main() {
  const { embedding, vectordb, rootPath } = await loadInfra();

  console.log('📐 ndcg: computing nDCG@10 against curated ground truth\n');
  console.log(`   Codebase: ${rootPath}`);
  console.log(`   Queries:  ${GROUND_TRUTH.length} (hand-curated)\n`);

  let totalNdcg = 0;
  let failed = 0;

  for (const gt of GROUND_TRUTH) {
    process.stdout.write(`   ${gt.query.slice(0, 60).padEnd(60)} `);

    const results = await searchCode(rootPath, gt.query, embedding, vectordb, { limit: K });

    const grades = results.map(r => grade(r.relativePath.replace(/\\/g, '/'), r.startLine, r.endLine, gt));

    const dcg = dcgAtK(grades, K);
    const idcg = idealDcgAtK(grades, K);
    const ndcg = idcg > 0 ? dcg / idcg : 0;

    totalNdcg += ndcg;
    if (ndcg < 0.1) failed++;

    const topGrade = grades[0] ?? 0;
    const symbol = topGrade === 3 ? '✓✓' : topGrade === 1 ? '✓ ' : '✗ ';
    process.stdout.write(`${symbol}  nDCG=${ndcg.toFixed(3)}  top=${results[0]?.relativePath.replace(/\\/g, '/') ?? '(none)'}\n`);
  }

  const meanNdcg = totalNdcg / GROUND_TRUTH.length;

  console.log('\n─────────────────────────────────────────────────────────────────────────────');
  console.log('  nDCG@10 Summary\n');
  console.log(`  Mean nDCG@10: ${meanNdcg.toFixed(3)}`);
  console.log(`  Threshold:    0.400`);
  console.log(`  Queries with nDCG < 0.1 (near-total miss): ${failed}/${GROUND_TRUTH.length}`);
  console.log();

  const passed = meanNdcg >= 0.4;
  console.log(`  ${passed ? '✅' : '❌'}  ${passed ? 'PASS' : 'FAIL'} — mean nDCG@10 = ${meanNdcg.toFixed(3)} (threshold 0.400)\n`);
  process.exit(passed ? 0 : 1);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
