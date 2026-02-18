import type { PreviewResult, IndexResult } from './core/indexer.js';
import type { DocIndexResult } from './core/doc-indexer.js';
import type { DocSearchResult } from './core/doc-searcher.js';
import type { CodebaseState } from './state/snapshot.js';
import { listProjects } from './state/registry.js';

export function textResult(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

export function formatIndexResult(result: IndexResult, normalizedPath: string): string {
  const lines = [
    `Indexing complete for ${normalizedPath}`,
    '',
    `  Total files:    ${result.totalFiles}`,
    `  Total chunks:   ${result.totalChunks}`,
    `  Added:          ${result.addedFiles}`,
    `  Modified:       ${result.modifiedFiles}`,
    `  Removed:        ${result.removedFiles}`,
    `  Skipped:        ${result.skippedFiles}`,
    `  Parse failures: ${result.parseFailures.length}`,
    `  Tokens:         ~${(result.estimatedTokens / 1000).toFixed(0)}K`,
    `  Cost:           $${result.estimatedCostUsd.toFixed(4)}`,
    `  Duration:       ${(result.durationMs / 1000).toFixed(1)}s`,
  ];

  if (result.parseFailures.length > 0) {
    lines.push('');
    lines.push('Parse failures:');
    const toShow = result.parseFailures.slice(0, 10);
    for (const file of toShow) {
      lines.push(`- ${file}`);
    }
    if (result.parseFailures.length > 10) {
      lines.push(`- ... and ${result.parseFailures.length - 10} more`);
    }
  }

  return lines.join('\n');
}

export function formatPreview(preview: PreviewResult, rootPath: string): string {
  const lines: string[] = [`Preview for ${rootPath}:`, ''];

  const sorted = Object.entries(preview.byExtension)
    .sort((a, b) => b[1] - a[1]);

  if (sorted.length > 0) {
    const maxExt = Math.max(...sorted.map(([ext]) => ext.length));
    for (const [ext, count] of sorted) {
      lines.push(`  ${ext.padEnd(maxExt)}  ${count.toLocaleString()}`);
    }
  }

  lines.push(`Total: ${preview.totalFiles.toLocaleString()} files`, '');

  if (preview.topDirectories.length > 0) {
    lines.push('Top directories:');
    for (const { dir, count } of preview.topDirectories) {
      lines.push(`  ${dir}/: ${count.toLocaleString()} files`);
    }
    lines.push('');
  }

  const tokenStr = preview.estimatedTokens >= 1_000_000
    ? `~${(preview.estimatedTokens / 1_000_000).toFixed(1)}M`
    : `~${(preview.estimatedTokens / 1000).toFixed(0)}K`;
  lines.push(`Estimated: ${tokenStr} tokens (~$${preview.estimatedCostUsd.toFixed(4)})`, '');

  lines.push('Warnings:');
  if (preview.warnings.length === 0) {
    lines.push('- None');
  } else {
    for (const w of preview.warnings) {
      lines.push(`- ${w}`);
    }
  }

  return lines.join('\n');
}

export function formatListIndexed(states: CodebaseState[]): string {
  const registry = listProjects();
  const pathToProject = new Map(Object.entries(registry).map(([name, p]) => [p, name]));

  const lines: string[] = [`Indexed Codebases (${states.length})`, ''];
  for (const s of states) {
    const projectName = pathToProject.get(s.path);
    const heading = projectName ? `${s.path} (project: ${projectName})` : s.path;
    lines.push(heading);
    lines.push(`  Status:       ${s.status}`);
    if (s.totalFiles) lines.push(`  Files:        ${s.totalFiles}`);
    if (s.totalChunks) lines.push(`  Chunks:       ${s.totalChunks}`);
    if (s.lastIndexed) lines.push(`  Last indexed: ${s.lastIndexed}`);
    if (s.status === 'indexing' && s.progress !== undefined) {
      lines.push(`  Progress:     ${s.progress}% — ${s.progressMessage ?? ''}`);
    }
    if (s.error) lines.push(`  Error:        ${s.error}`);
    lines.push('');
  }
  return lines.join('\n');
}

export function formatDocIndexResult(result: DocIndexResult): string {
  const lines = [
    `Documentation cached: ${result.library}/${result.topic}`,
    '',
    `  Source:     ${result.source}`,
    `  Chunks:    ${result.totalChunks}`,
    `  Tokens:    ~${(result.estimatedTokens / 1000).toFixed(0)}K`,
    `  Duration:  ${(result.durationMs / 1000).toFixed(1)}s`,
    `  Collection: ${result.collectionName}`,
    '',
    `Use \`search_documents(query="...", library="${result.library}")\` to search this documentation.`,
  ];
  return lines.join('\n');
}

export function formatDocSearchResults(results: DocSearchResult[], query: string): string {
  if (results.length === 0) {
    return `No cached documentation found for "${query}".`;
  }

  const lines: string[] = [
    `Found ${results.length} result(s) for "${query}" in cached docs:\n`,
  ];

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const staleTag = r.stale ? ' **[STALE]**' : '';
    lines.push(`### Result ${i + 1}`);
    lines.push(`**Library:** ${r.library}/${r.topic} | **Source:** ${r.source}${staleTag}`);
    lines.push(`**Score:** ${r.score.toFixed(4)}`);
    lines.push('```markdown');
    lines.push(r.content);
    lines.push('```');
    lines.push('');
  }

  return lines.join('\n');
}
