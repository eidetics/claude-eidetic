#!/usr/bin/env tsx
/**
 * 📐 ndcg — Search Eval #3
 *
 *   Ground truth holds still;
 *   ranked list shifts above it —
 *   nDCG tells all
 *
 * Computes nDCG@10 against the natural-language queries in ground-truth.json.
 * Each query has an expected file, a line range, and a relevance grade for
 * grading system results. Grades are human-judged, not derived from the index.
 *
 * Grading scheme:
 *   3 = result overlaps expected line range in expected file (exact match)
 *   1 = result is in expected file but different section
 *   0 = result is in a different file (miss)
 *
 * Pass threshold: mean nDCG@10 >= 0.4 (conservative baseline).
 * Threshold applies to hand-curated queries only; generated is informational.
 */

import { searchCode } from '../../src/core/searcher.js';
import { loadInfra } from './_infra.js';
import { loadGroundTruth, type EvalQuery } from './_queries.js';

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
  q: EvalQuery,
): number {
  if (relativePath.replace(/\\/g, '/') !== q.expectedFile) return 0;
  if (rangesOverlap(startLine, endLine, q.expectedStartLine, q.expectedEndLine)) return 3;
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
  const gt = loadGroundTruth();

  // nDCG grading uses line ranges, so restrict to natural-language queries
  const queries = gt.queries.filter(q => q.type === 'natural');
  const handQueries = queries.filter(q => q.source === 'hand');
  const genQueries = queries.filter(q => q.source === 'generated');

  console.log('📐 ndcg: computing nDCG@10 against curated ground truth\n');
  console.log(`   Codebase: ${rootPath}`);
  console.log(`   Queries:  ${queries.length} natural-language (${handQueries.length} hand + ${genQueries.length} generated)\n`);

  const ndcgByQuery = new Map<string, number>();

  for (const q of queries) {
    process.stdout.write(`   ${q.text.slice(0, 60).padEnd(60)} `);

    const results = await searchCode(rootPath, q.text, embedding, vectordb, { limit: K });

    const grades = results.map(r => grade(r.relativePath.replace(/\\/g, '/'), r.startLine, r.endLine, q));

    const dcg = dcgAtK(grades, K);
    const idcg = idealDcgAtK(grades, K);
    const ndcg = idcg > 0 ? dcg / idcg : 0;

    ndcgByQuery.set(q.id, ndcg);

    const topGrade = grades[0] ?? 0;
    const symbol = topGrade === 3 ? '✓✓' : topGrade === 1 ? '✓ ' : '✗ ';
    process.stdout.write(`${symbol}  nDCG=${ndcg.toFixed(3)}  top=${results[0]?.relativePath.replace(/\\/g, '/') ?? '(none)'}\n`);
  }

  console.log('\n─────────────────────────────────────────────────────────────────────────────');
  console.log('  nDCG@10 Summary\n');

  function summarize(label: string, subset: EvalQuery[]): number | undefined {
    if (subset.length === 0) return undefined;
    const total = subset.length;
    const totalNdcg = subset.reduce((s, q) => s + (ndcgByQuery.get(q.id) ?? 0), 0);
    const mean = totalNdcg / total;
    const failed = subset.filter(q => (ndcgByQuery.get(q.id) ?? 0) < 0.1).length;
    console.log(`  ${label} (${total}):`);
    console.log(`    Mean nDCG@10: ${mean.toFixed(3)}`);
    console.log(`    Queries with nDCG < 0.1 (near-total miss): ${failed}/${total}`);
    console.log();
    return mean;
  }

  const handMean = summarize('✋ Hand-curated', handQueries);
  summarize('🤖 Generated (informational)', genQueries);

  if (queries.length !== handQueries.length) {
    const allTotal = queries.length;
    const allMean = [...ndcgByQuery.values()].reduce((s, v) => s + v, 0) / allTotal;
    console.log(`  📊 Overall mean nDCG@10: ${allMean.toFixed(3)}\n`);
  }

  const threshold = 0.4;
  const mean = handMean ?? 0;
  const passed = mean >= threshold;
  console.log(`  ${passed ? '✅' : '❌'}  ${passed ? 'PASS' : 'FAIL'} — hand-curated mean nDCG@10 = ${mean.toFixed(3)} (threshold ${threshold.toFixed(3)})\n`);
  process.exit(passed ? 0 : 1);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
