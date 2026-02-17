import fs from 'node:fs';
import path from 'node:path';
import type { Embedding } from '../embedding/types.js';
import { scanFiles } from './sync.js';
import { normalizePath } from '../paths.js';

export interface PreviewResult {
  totalFiles: number;
  byExtension: Record<string, number>;
  topDirectories: { dir: string; count: number }[];
  estimatedTokens: number;
  estimatedCostUsd: number;
  warnings: string[];
}

export async function previewCodebase(
  rootPath: string,
  embedding: Embedding,
  customExtensions?: string[],
  customIgnorePatterns?: string[],
): Promise<PreviewResult> {
  const normalizedPath = normalizePath(rootPath);
  const filePaths = await scanFiles(normalizedPath, customExtensions, customIgnorePatterns);

  const byExtension: Record<string, number> = {};
  for (const f of filePaths) {
    const ext = path.extname(f).toLowerCase() || '(no ext)';
    byExtension[ext] = (byExtension[ext] ?? 0) + 1;
  }

  const dirCounts: Record<string, number> = {};
  for (const f of filePaths) {
    const firstSeg = f.split(/[/\\]/)[0];
    const dir = f.includes('/') || f.includes('\\') ? firstSeg : '(root)';
    dirCounts[dir] = (dirCounts[dir] ?? 0) + 1;
  }
  const topDirectories = Object.entries(dirCounts)
    .map(([dir, count]) => ({ dir, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // Estimate tokens from file sizes (rough: sum sizes / 4 chars-per-token)
  let totalBytes = 0;
  for (const f of filePaths) {
    try {
      const stat = fs.statSync(path.join(normalizedPath, f));
      totalBytes += stat.size;
    } catch {
      // File may have disappeared between scan and stat
    }
  }
  // Conservative estimate: ~3-4 chars per token for code.
  // May underestimate for dense code; will be refined during actual indexing.
  const estimatedTokens = Math.ceil(totalBytes / 3);
  const estimatedCostUsd = (estimatedTokens / 1_000_000) * 0.02;

  const warnings: string[] = [];
  if (filePaths.length === 0) {
    warnings.push('No indexable files found. Check file extension filters and ignore patterns.');
  }
  if (filePaths.length > 5000) {
    warnings.push(`Found ${filePaths.length.toLocaleString()} files. Most codebases have 100-5,000 source files. Consider adding ignore patterns.`);
  }
  if (topDirectories.length > 0 && filePaths.length > 0) {
    const topDir = topDirectories[0];
    const pct = Math.round((topDir.count / filePaths.length) * 100);
    if (pct > 50 && topDir.dir !== '(root)') {
      warnings.push(`Directory '${topDir.dir}/' contains ${pct}% of files -- consider ignoring if it contains build artifacts or dependencies.`);
    }
  }

  return {
    totalFiles: filePaths.length,
    byExtension,
    topDirectories,
    estimatedTokens,
    estimatedCostUsd,
    warnings,
  };
}
