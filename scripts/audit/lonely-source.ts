#!/usr/bin/env tsx
/**
 * 🍂 lonely-source — Haiku Auditor #1
 *
 *   Source without a test
 *   like autumn leaf, unwitnessed —
 *   bugs hide in silence
 *
 * Finds production source files that have no corresponding test file.
 */

import { globSync } from 'glob';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const src = path.join(ROOT, 'src');

// Files we intentionally skip (entry points, pure types, infra)
const EXEMPT = new Set([
  'index.ts',           // MCP server entry — tested via e2e
  'types.ts',           // pure type declarations, no runtime
  'qdrant-bootstrap.ts', // Docker orchestration — integration-only
  'tool-schemas.ts',    // Zod schema declarations
]);

const sourceFiles = globSync('**/*.ts', {
  cwd: src,
  ignore: ['**/*.test.ts', '**/*.integration.test.ts', '__test__/**', 'e2e/**'],
}).filter(f => !EXEMPT.has(path.basename(f)));

const testFiles = new Set(
  globSync('**/*.test.ts', { cwd: src })
    .map(f => f.replace(/\.test\.ts$/, '.ts'))
);

const integrationFiles = new Set(
  globSync('**/*.integration.test.ts', { cwd: src })
    .map(f => f.replace(/\.integration\.test\.ts$/, '.ts'))
);

const lonely: string[] = [];
for (const file of sourceFiles) {
  if (!testFiles.has(file) && !integrationFiles.has(file)) {
    lonely.push(file);
  }
}

console.log('🍂 lonely-source: files without test companions\n');

if (lonely.length === 0) {
  console.log('  ✅ Every source file has a test. Nothing is lonely.');
} else {
  console.log(`  ⚠️  ${lonely.length} source file(s) have no tests:\n`);
  for (const f of lonely.sort()) {
    console.log(`    • src/${f}`);
  }
}

console.log();
process.exit(lonely.length > 0 ? 1 : 0);
