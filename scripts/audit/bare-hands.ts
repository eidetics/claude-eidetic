#!/usr/bin/env tsx
/**
 * 🤲 bare-hands — Haiku Auditor #3
 *
 *   A test with no check
 *   runs but proves nothing at all —
 *   expect or delete
 *
 * Finds it() blocks that contain zero expect() calls.
 * These tests execute code but assert nothing — false confidence.
 */

import { globSync } from 'glob';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const src = path.join(ROOT, 'src');

const testFiles = globSync('**/*.test.ts', { cwd: src });

interface BareTest {
  file: string;
  line: number;
  name: string;
}

const bareTests: BareTest[] = [];

for (const file of testFiles) {
  const content = readFileSync(path.join(src, file), 'utf-8');
  const lines = content.split('\n');

  // Simple state machine: track it() blocks and expect() calls within them
  let inTest = false;
  let braceDepth = 0;
  let testStart = 0;
  let testName = '';
  let hasExpect = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (!inTest) {
      // Match: it('name', ...) or it("name", ...)
      const match = line.match(/\bit\s*\(\s*['"`]([^'"`]+)['"`]/);
      if (match) {
        inTest = true;
        braceDepth = 0;
        testStart = i + 1;
        testName = match[1];
        hasExpect = false;
      }
    }

    if (inTest) {
      // Count braces to find block end
      for (const ch of line) {
        if (ch === '{') braceDepth++;
        if (ch === '}') braceDepth--;
      }

      if (/\bexpect\s*\(/.test(line)) {
        hasExpect = true;
      }

      // Block ended
      if (braceDepth <= 0 && line.includes('}')) {
        if (!hasExpect) {
          bareTests.push({ file, line: testStart, name: testName });
        }
        inTest = false;
      }
    }
  }
}

console.log('🤲 bare-hands: tests without assertions\n');

if (bareTests.length === 0) {
  console.log(`  ✅ Every it() block contains at least one expect(). All tests assert.`);
} else {
  console.log(`  ⚠️  ${bareTests.length} test(s) have zero expect() calls:\n`);
  for (const t of bareTests) {
    console.log(`    • src/${t.file}:${t.line}  "${t.name}"`);
  }
}

console.log();
process.exit(bareTests.length > 0 ? 1 : 0);
