#!/usr/bin/env tsx
/**
 * 🤖 generate-queries — Synthetic eval query generator
 *
 * Scans src/ for exported symbols, calls gpt-4o-mini to generate 2-3 search
 * queries per symbol (mix of identifier and natural), applies diversity
 * filters, then merges with hand-curated queries in ground-truth.json.
 *
 * Usage:
 *   npx tsx scripts/eval/generate-queries.ts           # generate, preserve existing
 *   npx tsx scripts/eval/generate-queries.ts --force   # regenerate all generated queries
 *   npx tsx scripts/eval/generate-queries.ts --dry-run # preview without writing
 */

import fs from 'node:fs';
import path from 'node:path';
import { glob } from 'glob';
import OpenAI from 'openai';
import { loadConfig } from '../../src/config.js';
import { loadGroundTruth, type EvalQuery, type GroundTruth } from './_queries.js';

const GROUND_TRUTH_PATH = path.join(import.meta.dirname, 'ground-truth.json');
const SRC_ROOT = path.join(import.meta.dirname, '../../src');

// Files to skip — tests, entry points, generated
const SKIP_PATTERNS = [
  '**/__tests__/**',
  '**/*.test.*',
  '**/*.spec.*',
  '**/e2e/**',
  '**/tests/**',
  'index.ts',
];

interface ExportedSymbol {
  name: string;
  startLine: number;
  endLine: number;
  kind: 'function' | 'class' | 'const' | 'enum' | 'interface' | 'type';
}

interface GeneratedQueryRaw {
  text: string;
  type: 'identifier' | 'natural';
  targetSymbol: string;
  expectedStartLine: number;
  expectedEndLine: number;
}

// Extract exported symbols from a TypeScript file
function extractExports(content: string): ExportedSymbol[] {
  const lines = content.split('\n');
  const symbols: ExportedSymbol[] = [];

  const exportRe = /^export\s+(?:async\s+)?(?:(function|class|const|enum|interface|type))\s+(\w+)/;

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(exportRe);
    if (!m) continue;

    const kind = m[1] as ExportedSymbol['kind'];
    const name = m[2];
    const startLine = i + 1; // 1-indexed

    // Estimate end line: scan for closing brace or next export
    let endLine = startLine;
    if (kind === 'function' || kind === 'class' || kind === 'const') {
      let depth = 0;
      let foundOpen = false;
      for (let j = i; j < Math.min(i + 150, lines.length); j++) {
        for (const ch of lines[j]) {
          if (ch === '{') { depth++; foundOpen = true; }
          else if (ch === '}') { depth--; }
        }
        if (foundOpen && depth === 0) {
          endLine = j + 1;
          break;
        }
      }
      if (endLine === startLine) {
        // Single-line or arrow function — scan for semicolon
        for (let j = i; j < Math.min(i + 30, lines.length); j++) {
          if (lines[j].trim().endsWith(';') || lines[j].trim().endsWith(',')) {
            endLine = j + 1;
            break;
          }
        }
      }
    } else {
      // interface/type/enum — scan for closing brace
      let depth = 0;
      let foundOpen = false;
      for (let j = i; j < Math.min(i + 80, lines.length); j++) {
        for (const ch of lines[j]) {
          if (ch === '{') { depth++; foundOpen = true; }
          else if (ch === '}') { depth--; }
        }
        if (foundOpen && depth === 0) {
          endLine = j + 1;
          break;
        }
      }
    }

    symbols.push({ name, startLine, endLine: Math.max(endLine, startLine), kind });
  }

  return symbols;
}

// Jaccard similarity between two strings (word-level)
function jaccardSimilarity(a: string, b: string): number {
  const setA = new Set(a.toLowerCase().split(/\W+/).filter(Boolean));
  const setB = new Set(b.toLowerCase().split(/\W+/).filter(Boolean));
  const intersection = [...setA].filter(w => setB.has(w)).length;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

// Diversity filter: remove low-quality or duplicate generated queries
function applyDiversityFilter(
  candidates: (GeneratedQueryRaw & { expectedFile: string })[],
  reference: (GeneratedQueryRaw & { expectedFile: string })[] = [],
): (GeneratedQueryRaw & { expectedFile: string })[] {
  const filtered: typeof candidates = [];

  for (const q of candidates) {
    // Reject natural queries containing the exact targetSymbol as a word
    if (q.type === 'natural') {
      const wordBoundary = new RegExp(`\\b${q.targetSymbol}\\b`, 'i');
      if (wordBoundary.test(q.text)) continue;
    }

    // Reject very short queries
    if (q.text.trim().length < 10) continue;

    // Jaccard dedup: check against both already-filtered candidates and the
    // reference list (e.g. preserved queries from a previous run) so that
    // near-duplicates across the preserved/new boundary are also caught.
    const isDup = [...reference, ...filtered].some(existing => {
      if (existing.expectedFile !== q.expectedFile) return false;
      const sim = jaccardSimilarity(existing.text, q.text);
      return sim > 0.7;
    });
    if (isDup) continue;

    filtered.push(q);
  }

  return filtered;
}

async function generateForFile(
  client: OpenAI,
  filePath: string,
  relativePath: string,
  symbols: ExportedSymbol[],
): Promise<(GeneratedQueryRaw & { expectedFile: string })[]> {
  if (symbols.length === 0) return [];

  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').slice(0, 200);
  const truncatedContent = lines.join('\n');

  const symbolList = symbols.map(s =>
    `  - ${s.name} (${s.kind}, lines ${s.startLine}-${s.endLine})`,
  ).join('\n');

  const prompt = `File: ${relativePath}

Exported symbols:
${symbolList}

File content (first 200 lines):
\`\`\`typescript
${truncatedContent}
\`\`\`

Generate 2-3 search queries per exported symbol. Return a JSON array with objects:
{
  "text": string,         // the query a developer would type
  "type": "identifier" | "natural",
  "targetSymbol": string, // which symbol this tests
  "expectedStartLine": number,
  "expectedEndLine": number
}

Rules:
- identifier queries: exact or partial name only (e.g. "reciprocalRankFusion")
- natural queries: behavioral description WITHOUT restating the function name
- Keep natural queries concise (5-15 words)
- Return only the JSON array, no markdown.`;

  try {
    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You generate search queries for a code search eval. Output only valid JSON arrays.',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.7,
      max_tokens: 1500,
    });

    const raw = response.choices[0]?.message?.content ?? '[]';
    // Strip markdown code fences if present
    const json = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
    const parsed = JSON.parse(json) as GeneratedQueryRaw[];

    return parsed
      .filter(q => q.text && q.type && q.targetSymbol)
      .map(q => ({ ...q, expectedFile: relativePath }));
  } catch (err) {
    console.error(`   ⚠️  Error generating for ${relativePath}: ${err}`);
    return [];
  }
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const dryRun = args.includes('--dry-run');

  const config = loadConfig();
  if (!config.openaiApiKey) {
    console.error('❌  OPENAI_API_KEY is not set. Export it and re-run.');
    process.exit(1);
  }

  const client = new OpenAI({ apiKey: config.openaiApiKey });

  console.log('🤖 generate-queries: synthesising eval queries via gpt-4o-mini\n');
  if (force) console.log('   --force: regenerating all generated queries\n');
  if (dryRun) console.log('   --dry-run: preview only, no writes\n');

  // Load existing ground truth
  const existing = loadGroundTruth();
  const handQueries = existing.queries.filter(q => q.source === 'hand');

  // Discover source files
  const srcFiles = await glob('**/*.ts', {
    cwd: SRC_ROOT,
    ignore: SKIP_PATTERNS,
    absolute: false,
  });
  srcFiles.sort();

  console.log(`   Found ${srcFiles.length} source files to scan\n`);

  // Track which files already have generated queries (to skip if not --force)
  const existingGenFiles = new Set(
    existing.queries
      .filter(q => q.source === 'generated')
      .map(q => q.expectedFile),
  );

  const allCandidates: (GeneratedQueryRaw & { expectedFile: string })[] = [];
  let filesProcessed = 0;

  for (const relFile of srcFiles) {
    const absPath = path.join(SRC_ROOT, relFile);
    const expectedFile = `src/${relFile.replace(/\\/g, '/')}`;

    if (!force && existingGenFiles.has(expectedFile)) {
      // Preserve existing generated queries for this file
      const preserved = existing.queries.filter(
        q => q.source === 'generated' && q.expectedFile === expectedFile,
      );
      for (const q of preserved) {
        allCandidates.push({
          text: q.text,
          type: q.type,
          targetSymbol: q.targetSymbol ?? '',
          expectedStartLine: q.expectedStartLine,
          expectedEndLine: q.expectedEndLine,
          expectedFile,
        });
      }
      continue;
    }

    const content = fs.readFileSync(absPath, 'utf-8');
    const symbols = extractExports(content);

    if (symbols.length === 0) continue;

    process.stdout.write(`   ${expectedFile.padEnd(50)} ${symbols.length} exports → `);

    const generated = await generateForFile(client, absPath, expectedFile, symbols);
    filesProcessed++;

    // Cap at 8 per file
    const capped = generated.slice(0, 8);
    allCandidates.push(...capped);
    process.stdout.write(`${capped.length} queries\n`);
  }

  console.log(`\n   Generated ${allCandidates.length} raw candidates from ${filesProcessed} files`);

  // Apply diversity filter to the newly generated (not preserved) ones
  const preserved = allCandidates.filter(q => {
    if (force) return false;
    return existingGenFiles.has(q.expectedFile);
  });
  const newCandidates = allCandidates.filter(q => !preserved.includes(q));

  const filtered = applyDiversityFilter(newCandidates, preserved);
  const allFiltered = [...preserved, ...filtered];

  // Ensure min 20 distinct files covered
  const coveredFiles = new Set(allFiltered.map(q => q.expectedFile));
  console.log(`   After diversity filter: ${allFiltered.length} queries across ${coveredFiles.size} files`);

  if (dryRun) {
    console.log('\n   [dry-run] Sample of generated queries:\n');
    for (const q of allFiltered.slice(0, 20)) {
      console.log(`   [${q.type.padEnd(10)}] ${q.text.slice(0, 60)} → ${q.expectedFile}`);
    }
    console.log('\n   [dry-run] No writes performed.');
    return;
  }

  // Assign stable IDs: gen-01, gen-02, ...
  const genQueries: EvalQuery[] = allFiltered.map((q, i) => ({
    id: `gen-${String(i + 1).padStart(2, '0')}`,
    text: q.text,
    type: q.type,
    source: 'generated' as const,
    expectedFile: q.expectedFile,
    expectedStartLine: q.expectedStartLine,
    expectedEndLine: q.expectedEndLine,
    ...(q.targetSymbol ? { targetSymbol: q.targetSymbol } : {}),
  }));

  const merged: GroundTruth = {
    version: 1,
    generated_at: new Date().toISOString(),
    queries: [...handQueries, ...genQueries],
  };

  fs.writeFileSync(GROUND_TRUTH_PATH, JSON.stringify(merged, null, 2) + '\n');

  console.log(`\n   ✅  Wrote ${merged.queries.length} total queries to ground-truth.json`);
  console.log(`       (${handQueries.length} hand + ${genQueries.length} generated)`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
