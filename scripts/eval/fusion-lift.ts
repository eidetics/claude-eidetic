#!/usr/bin/env tsx
/**
 * 🔀 fusion-lift — Search Eval #2
 *
 *   Dense alone sees form,
 *   text alone sees the token —
 *   fusion sees both truths
 *
 * Decomposes the hybrid search pipeline into three paths:
 *   dense-only  — vector similarity only (no text filter)
 *   text-only   — keyword match ranked by TF (no dense vector)
 *   fused       — reciprocal rank fusion of both (normal pipeline)
 *
 * Per query, measures:
 *   - Which fused top-5 results came from dense, text, or both
 *   - Whether fusion changed the ordering vs dense-only
 *   - Whether fusion surfaced results absent from both individual top-5s
 *
 * Aggregate: mean fusion lift (new results surfaced), reorder rate.
 * Directly answers whether RRF fusion earns its latency cost.
 */

import {
  rankByTermFrequency,
  reciprocalRankFusion,
  extractPayload,
} from '../../src/vectordb/qdrant.js';
import { loadInfra } from './_infra.js';
import { allQueryTexts } from './_queries.js';

const FETCH_LIMIT = 20;
const TOP_K = 5;

interface PerQueryMetrics {
  query: string;
  denseIds: Set<string>;
  textIds: Set<string>;
  fusedIds: string[]; // ordered
  newInFused: number;       // in fused top-5 but absent from both dense top-5 and text top-5
  reordered: boolean;       // fused top-5 order differs from dense top-5 order
  fromDenseOnly: number;    // in fused, was in dense but not text top-5
  fromTextOnly: number;     // in fused, was in text but not dense top-5
  fromBoth: number;         // in fused, was in both top-5s
}

function topIds(results: { id: string | number }[], k: number): string[] {
  return results.slice(0, k).map(r => String(r.id));
}

async function main() {
  const { embedding, client, collectionName } = await loadInfra();
  const queries = allQueryTexts();

  console.log('🔀 fusion-lift: decomposing hybrid search pipeline\n');
  console.log(`   Queries: ${queries.length}   Top-K: ${TOP_K}   Fetch limit: ${FETCH_LIMIT}\n`);

  const metrics: PerQueryMetrics[] = [];

  for (const query of queries) {
    process.stdout.write(`   ${query.slice(0, 55).padEnd(55)} `);

    // 1. Embed the query
    const queryVector = await embedding.embed(query);

    // 2. Dense-only: vector search, no text filter
    const denseRaw = await client.search(collectionName, {
      vector: { name: 'dense', vector: queryVector },
      limit: FETCH_LIMIT,
      with_payload: true,
    });

    // 3. Text-only: keyword scroll + TF ranking
    const textResponse = await client.scroll(collectionName, {
      filter: { must: [{ key: 'content', match: { text: query } }] },
      limit: FETCH_LIMIT,
      with_payload: true,
    });
    const textRanked = rankByTermFrequency(textResponse.points, query);

    // 4. Fused: RRF of both
    const fusedResults = reciprocalRankFusion(denseRaw, textRanked, TOP_K);

    const denseTop = new Set(topIds(denseRaw, TOP_K));
    const textTop = new Set(topIds(textRanked, TOP_K));
    const fusedTop = fusedResults.map(r => {
      // fusedResults are SearchResult (no id); match back via relativePath + startLine
      const match = denseRaw.find(d => {
        const p = extractPayload(d);
        return p.relativePath === r.relativePath && p.startLine === r.startLine;
      }) ?? textRanked.find(t => {
        const p = extractPayload(t);
        return p.relativePath === r.relativePath && p.startLine === r.startLine;
      });
      return match ? String(match.id) : `${r.relativePath}:${r.startLine}`;
    });

    const denseTopOrdered = topIds(denseRaw, TOP_K);

    let newInFused = 0;
    let fromDenseOnly = 0;
    let fromTextOnly = 0;
    let fromBoth = 0;

    for (const id of fusedTop) {
      const inDense = denseTop.has(id);
      const inText = textTop.has(id);
      if (!inDense && !inText) newInFused++;
      else if (inDense && inText) fromBoth++;
      else if (inDense) fromDenseOnly++;
      else fromTextOnly++;
    }

    // Reordered: fused top-5 differs from dense top-5 (different order or different members)
    const reordered =
      fusedTop.length !== denseTopOrdered.length ||
      fusedTop.some((id, i) => id !== denseTopOrdered[i]);

    process.stdout.write(
      `lift=${newInFused} reorder=${reordered ? 'yes' : 'no '} [dense=${fromDenseOnly} text=${fromTextOnly} both=${fromBoth}]\n`,
    );

    metrics.push({
      query,
      denseIds: denseTop,
      textIds: textTop,
      fusedIds: fusedTop,
      newInFused,
      reordered,
      fromDenseOnly,
      fromTextOnly,
      fromBoth,
    });
  }

  const total = metrics.length;
  const meanLift = metrics.reduce((s, m) => s + m.newInFused, 0) / total;
  const reorderRate = metrics.filter(m => m.reordered).length / total;
  const meanFromBoth = metrics.reduce((s, m) => s + m.fromBoth, 0) / total;
  const meanFromDenseOnly = metrics.reduce((s, m) => s + m.fromDenseOnly, 0) / total;
  const meanFromTextOnly = metrics.reduce((s, m) => s + m.fromTextOnly, 0) / total;

  console.log('\n─────────────────────────────────────────────────────────────────────────────');
  console.log('  Fusion Lift Summary\n');
  console.log(`  Mean fusion lift (new results/query): ${meanLift.toFixed(2)}`);
  console.log(`  Reorder rate (fused ≠ dense order):  ${(reorderRate * 100).toFixed(0)}%`);
  console.log(`\n  Mean per-query source breakdown (of top-${TOP_K} fused):`);
  console.log(`    From dense only:  ${meanFromDenseOnly.toFixed(2)}`);
  console.log(`    From text only:   ${meanFromTextOnly.toFixed(2)}`);
  console.log(`    From both:        ${meanFromBoth.toFixed(2)}`);
  console.log(`    New (not in either): ${meanLift.toFixed(2)}`);
  console.log();

  const worthwhile = reorderRate >= 0.3 || meanLift >= 0.5;
  console.log(
    `  ${worthwhile ? '✅' : '⚠️ '} Fusion ${worthwhile ? 'earns its cost' : 'may not be earning its cost'} ` +
    `(reorder rate ${(reorderRate * 100).toFixed(0)}%, lift ${meanLift.toFixed(2)})\n`,
  );

  process.exit(0); // informational — no hard pass/fail threshold
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
