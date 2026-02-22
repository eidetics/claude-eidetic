#!/usr/bin/env tsx
/**
 * 🎯 recall-at-k — Search Eval #1
 *
 *   Does the right chunk rise?
 *   Identifier or plain English —
 *   rank reveals truth
 *
 * Measures Recall@K for two query types:
 *   - identifier:  exact function/class names extracted from the codebase
 *   - natural:     hand-written descriptions of what code does
 *
 * For each query, checks whether the expected source file appears in the
 * top-K results (K = 1, 3, 5, 10). Reports recall percentages broken down
 * by query type and source (hand vs generated). Requires a running Qdrant
 * with the eidetic codebase indexed.
 */

import { searchCode } from '../../src/core/searcher.js';
import { loadInfra } from './_infra.js';
import { loadGroundTruth, type EvalQuery } from './_queries.js';

const K_VALUES = [1, 3, 5, 10];

interface QueryResult {
  query: EvalQuery;
  hitAtK: Record<number, boolean>;
  topFile: string | null;
}

async function main() {
  const { embedding, vectordb, rootPath } = await loadInfra();
  const gt = loadGroundTruth();

  const identifiers = gt.queries.filter(q => q.type === 'identifier');
  const naturals = gt.queries.filter(q => q.type === 'natural');
  const allQueries = gt.queries;

  console.log('🎯 recall-at-k: measuring Recall@K for hybrid search\n');
  console.log(`   Codebase: ${rootPath}`);
  console.log(`   Queries: ${identifiers.length} identifier + ${naturals.length} natural-language (${allQueries.length} total)\n`);

  const results: QueryResult[] = [];

  for (const query of allQueries) {
    process.stdout.write(`   [${query.type.padEnd(10)}] ${query.text.slice(0, 60).padEnd(60)} `);

    const hits = await searchCode(rootPath, query.text, embedding, vectordb, { limit: 10 });
    const topFile = hits[0]?.relativePath.replace(/\\/g, '/') ?? null;

    const hitAtK: Record<number, boolean> = {};
    for (const k of K_VALUES) {
      hitAtK[k] = hits.slice(0, k).some(r => r.relativePath.replace(/\\/g, '/') === query.expectedFile);
    }

    const symbol = hitAtK[10] ? '✓' : '✗';
    const firstHit = K_VALUES.find(k => hitAtK[k]);
    process.stdout.write(`${symbol}  ${firstHit ? `hit@${firstHit}` : 'miss'}\n`);

    results.push({ query, hitAtK, topFile });
  }

  console.log('\n─────────────────────────────────────────────────────────────────────────────');
  console.log('  Recall@K Summary\n');

  for (const type of ['identifier', 'natural'] as const) {
    const subset = results.filter(r => r.query.type === type);
    const total = subset.length;
    console.log(`  ${type === 'identifier' ? '🔤 Identifier queries' : '💬 Natural-language queries'} (${total}):`);
    for (const k of K_VALUES) {
      const hits = subset.filter(r => r.hitAtK[k]).length;
      const pct = ((hits / total) * 100).toFixed(0).padStart(3);
      const bar = '█'.repeat(Math.round(hits / total * 20)).padEnd(20);
      console.log(`     Recall@${k.toString().padEnd(2)}: ${pct}%  ${bar}  (${hits}/${total})`);
    }
    console.log();
  }

  // Source breakdown: hand vs generated
  for (const source of ['hand', 'generated'] as const) {
    const subset = results.filter(r => r.query.source === source);
    if (subset.length === 0) continue;
    const total = subset.length;
    console.log(`  ${source === 'hand' ? '✋ Hand-curated' : '🤖 Generated'} queries (${total}):`);
    for (const k of K_VALUES) {
      const hits = subset.filter(r => r.hitAtK[k]).length;
      const pct = ((hits / total) * 100).toFixed(0).padStart(3);
      console.log(`     Recall@${k.toString().padEnd(2)}: ${pct}%  (${hits}/${total})`);
    }
    console.log();
  }

  const allTotal = results.length;
  console.log(`  📊 Overall (${allTotal}):`);
  for (const k of K_VALUES) {
    const hits = results.filter(r => r.hitAtK[k]).length;
    const pct = ((hits / allTotal) * 100).toFixed(0).padStart(3);
    console.log(`     Recall@${k.toString().padEnd(2)}: ${pct}%  (${hits}/${allTotal})`);
  }
  console.log();

  const misses = results.filter(r => !r.hitAtK[10]);
  if (misses.length > 0) {
    console.log(`  ⚠️  Misses (not in top-10):\n`);
    for (const m of misses) {
      console.log(`    • [${m.query.type}] "${m.query.text}"`);
      console.log(`      expected: ${m.query.expectedFile}`);
      console.log(`      got:      ${m.topFile?.replace(/\\/g, '/') ?? '(no results)'}`);
    }
    console.log();
  }

  // Pass/fail threshold applies to hand-curated subset only
  const handResults = results.filter(r => r.query.source === 'hand');
  const handTotal = handResults.length;
  const handRecall5 = handResults.filter(r => r.hitAtK[5]).length / handTotal;
  const passed = handRecall5 >= 0.5;
  console.log(`  ${passed ? '✅' : '❌'}  Hand-curated Recall@5: ${(handRecall5 * 100).toFixed(0)}% (threshold: 50%)\n`);
  process.exit(passed ? 0 : 1);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
