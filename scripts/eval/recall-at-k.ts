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
 * by query type. Requires a running Qdrant with the eidetic codebase indexed.
 */

import { searchCode } from '../../src/core/searcher.js';
import { loadInfra } from './_infra.js';

interface Query {
  type: 'identifier' | 'natural';
  text: string;
  expectedFile: string; // relative path from codebase root (forward slashes)
}

// ~15 identifier queries: exact function/class/const names from the codebase
const IDENTIFIER_QUERIES: Query[] = [
  { type: 'identifier', text: 'normalizePath', expectedFile: 'src/paths.ts' },
  { type: 'identifier', text: 'pathToCollectionName', expectedFile: 'src/paths.ts' },
  { type: 'identifier', text: 'loadConfig', expectedFile: 'src/config.ts' },
  { type: 'identifier', text: 'getConfig', expectedFile: 'src/config.ts' },
  { type: 'identifier', text: 'createEmbedding', expectedFile: 'src/embedding/factory.ts' },
  { type: 'identifier', text: 'rankByTermFrequency', expectedFile: 'src/vectordb/qdrant.ts' },
  { type: 'identifier', text: 'reciprocalRankFusion', expectedFile: 'src/vectordb/qdrant.ts' },
  { type: 'identifier', text: 'searchCode', expectedFile: 'src/core/searcher.ts' },
  { type: 'identifier', text: 'deduplicateResults', expectedFile: 'src/core/searcher.ts' },
  { type: 'identifier', text: 'extractPayload', expectedFile: 'src/vectordb/qdrant.ts' },
  { type: 'identifier', text: 'VectorDBError', expectedFile: 'src/errors.ts' },
  { type: 'identifier', text: 'EideticError', expectedFile: 'src/errors.ts' },
  { type: 'identifier', text: 'formatCompactResults', expectedFile: 'src/core/searcher.ts' },
  { type: 'identifier', text: 'getSnapshotDir', expectedFile: 'src/paths.ts' },
  { type: 'identifier', text: 'QdrantVectorDB', expectedFile: 'src/vectordb/qdrant.ts' },
];

// ~15 natural-language queries: descriptions of what the code does
const NATURAL_QUERIES: Query[] = [
  {
    type: 'natural',
    text: 'function that normalizes file paths to forward slashes',
    expectedFile: 'src/paths.ts',
  },
  {
    type: 'natural',
    text: 'error class for embedding failures',
    expectedFile: 'src/errors.ts',
  },
  {
    type: 'natural',
    text: 'reciprocal rank fusion scoring of dense and text search results',
    expectedFile: 'src/vectordb/qdrant.ts',
  },
  {
    type: 'natural',
    text: 'load and validate configuration from environment variables using zod',
    expectedFile: 'src/config.ts',
  },
  {
    type: 'natural',
    text: 'create embedding provider instance based on config provider field',
    expectedFile: 'src/embedding/factory.ts',
  },
  {
    type: 'natural',
    text: 'deduplicate overlapping search result chunks within the same file',
    expectedFile: 'src/core/searcher.ts',
  },
  {
    type: 'natural',
    text: 'insert documents into Qdrant vector collection in batches of 100',
    expectedFile: 'src/vectordb/qdrant.ts',
  },
  {
    type: 'natural',
    text: 'rank text match results by normalized term frequency score',
    expectedFile: 'src/vectordb/qdrant.ts',
  },
  {
    type: 'natural',
    text: 'convert absolute file path to safe Qdrant collection name',
    expectedFile: 'src/paths.ts',
  },
  {
    type: 'natural',
    text: 'split source code into AST chunks using tree-sitter',
    expectedFile: 'src/splitter/ast.ts',
  },
  {
    type: 'natural',
    text: 'bootstrap Qdrant Docker container if not running locally',
    expectedFile: 'src/infra/qdrant-bootstrap.ts',
  },
  {
    type: 'natural',
    text: 'expand tilde in file paths to home directory',
    expectedFile: 'src/paths.ts',
  },
  {
    type: 'natural',
    text: 'scan files and compute content hash for incremental indexing',
    expectedFile: 'src/core/sync.ts',
  },
  {
    type: 'natural',
    text: 'embed query and search using hybrid dense and text retrieval',
    expectedFile: 'src/core/searcher.ts',
  },
  {
    type: 'natural',
    text: 'track indexing status per codebase including progress percentage',
    expectedFile: 'src/state/snapshot.ts',
  },
];

const ALL_QUERIES = [...IDENTIFIER_QUERIES, ...NATURAL_QUERIES];
const K_VALUES = [1, 3, 5, 10];

interface QueryResult {
  query: Query;
  hitAtK: Record<number, boolean>;
  topFile: string | null;
}

async function main() {
  const { embedding, vectordb, rootPath } = await loadInfra();

  console.log('🎯 recall-at-k: measuring Recall@K for hybrid search\n');
  console.log(`   Codebase: ${rootPath}`);
  console.log(`   Queries: ${IDENTIFIER_QUERIES.length} identifier + ${NATURAL_QUERIES.length} natural-language\n`);

  const results: QueryResult[] = [];

  for (const query of ALL_QUERIES) {
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

  // Pass if overall Recall@5 >= 50%
  const recall5 = results.filter(r => r.hitAtK[5]).length / allTotal;
  const passed = recall5 >= 0.5;
  console.log(`  ${passed ? '✅' : '❌'}  Overall Recall@5: ${(recall5 * 100).toFixed(0)}% (threshold: 50%)\n`);
  process.exit(passed ? 0 : 1);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
