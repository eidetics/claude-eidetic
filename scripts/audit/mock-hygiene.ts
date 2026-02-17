#!/usr/bin/env tsx
/**
 * 🧹 mock-hygiene — Haiku Auditor #2
 *
 *   Mocks left standing tall
 *   bleed into the next test's world —
 *   clean hands, clean results
 *
 * Checks that test files using vi.fn() also call
 * vi.clearAllMocks() or vi.restoreAllMocks() in beforeEach/afterEach.
 *
 * Static vi.mock() factories without vi.fn() are stateless and exempt —
 * the real risk is vi.fn() accumulating call history across tests.
 */

import { globSync } from 'glob';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const src = path.join(ROOT, 'src');

const testFiles = globSync('**/*.test.ts', { cwd: src });

interface Finding {
  file: string;
  hasCleanup: boolean;
  hasMockFn: boolean;
  hasMocked: boolean;
  hasSpyOn: boolean;
}

const findings: Finding[] = [];

for (const file of testFiles) {
  const content = readFileSync(path.join(src, file), 'utf-8');

  // Stateful mocking: vi.fn(), vi.mocked(), vi.spyOn()
  const hasMockFn = /vi\.fn\(/.test(content);
  const hasMocked = /vi\.mocked\(/.test(content);
  const hasSpyOn = /vi\.spyOn\(/.test(content);
  const hasStatefulMocking = hasMockFn || hasMocked || hasSpyOn;

  if (!hasStatefulMocking) continue;

  const hasClear = /vi\.clearAllMocks\(\)/.test(content);
  const hasRestore = /vi\.restoreAllMocks\(\)/.test(content);
  const hasReset = /vi\.resetAllMocks\(\)/.test(content);
  const hasResetModules = /vi\.resetModules\(\)/.test(content);
  const hasCleanup = hasClear || hasRestore || hasReset || hasResetModules;

  findings.push({ file, hasCleanup, hasMockFn, hasMocked, hasSpyOn });
}

const dirty = findings.filter(f => !f.hasCleanup);

console.log('🧹 mock-hygiene: mock cleanup in test files\n');

if (dirty.length === 0) {
  console.log(`  ✅ All ${findings.length} files with stateful mocks have proper cleanup.`);
} else {
  console.log(`  ⚠️  ${dirty.length} of ${findings.length} file(s) with stateful mocks missing cleanup:\n`);
  for (const f of dirty) {
    const signals = [
      f.hasMockFn && 'vi.fn()',
      f.hasMocked && 'vi.mocked()',
      f.hasSpyOn && 'vi.spyOn()',
    ].filter(Boolean).join(', ');
    console.log(`    • src/${f.file}`);
    console.log(`      uses: ${signals}`);
    console.log(`      needs: vi.clearAllMocks() or vi.restoreAllMocks() in beforeEach/afterEach`);
  }
}

console.log();
process.exit(dirty.length > 0 ? 1 : 0);
