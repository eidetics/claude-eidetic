#!/usr/bin/env tsx
/**
 * ⏳ timer-drift — Haiku Auditor #4
 *
 *   Fake time left in place
 *   the next test runs in a dream —
 *   restore what you take
 *
 * Checks that every vi.useFakeTimers() is paired with vi.useRealTimers().
 * Leaked fake timers poison subsequent tests with frozen clocks.
 */

import { globSync } from 'glob';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const src = path.join(ROOT, 'src');

const testFiles = globSync('**/*.test.ts', { cwd: src });

interface TimerIssue {
  file: string;
  fakeCount: number;
  realCount: number;
  fakeLines: number[];
  realLines: number[];
}

const issues: TimerIssue[] = [];

for (const file of testFiles) {
  const content = readFileSync(path.join(src, file), 'utf-8');
  const lines = content.split('\n');

  const fakeLines: number[] = [];
  const realLines: number[] = [];

  for (let i = 0; i < lines.length; i++) {
    if (/vi\.useFakeTimers\(\)/.test(lines[i])) fakeLines.push(i + 1);
    if (/vi\.useRealTimers\(\)/.test(lines[i])) realLines.push(i + 1);
  }

  if (fakeLines.length === 0) continue;

  // Each useFakeTimers should have a matching useRealTimers
  // (in afterEach, or inline per-test)
  if (fakeLines.length !== realLines.length) {
    issues.push({
      file,
      fakeCount: fakeLines.length,
      realCount: realLines.length,
      fakeLines,
      realLines,
    });
  }
}

console.log('⏳ timer-drift: fake timer balance\n');

if (issues.length === 0) {
  const total = testFiles.length;
  const withTimers = globSync('**/*.test.ts', { cwd: src })
    .filter(f => readFileSync(path.join(src, f), 'utf-8').includes('useFakeTimers'))
    .length;
  console.log(`  ✅ All ${withTimers} file(s) using fake timers restore them properly.`);
} else {
  console.log(`  ⚠️  ${issues.length} file(s) have mismatched timer calls:\n`);
  for (const issue of issues) {
    console.log(`    • src/${issue.file}`);
    console.log(`      useFakeTimers: ${issue.fakeCount}× (lines ${issue.fakeLines.join(', ')})`);
    console.log(`      useRealTimers: ${issue.realCount}× (lines ${issue.realLines.join(', ')})`);
  }
}

console.log();
process.exit(issues.length > 0 ? 1 : 0);
