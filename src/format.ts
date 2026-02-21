import type { PreviewResult, IndexResult } from './core/indexer.js';
import type { DocIndexResult } from './core/doc-indexer.js';
import type { DocSearchResult } from './core/doc-searcher.js';
import type { CodebaseState } from './state/snapshot.js';
import type { MemoryItem, MemoryAction } from './memory/types.js';
import type { HistoryEntry } from './memory/history.js';
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

export function formatMemoryActions(actions: MemoryAction[]): string {
  if (actions.length === 0) {
    return 'No new facts extracted from the provided content.';
  }

  const lines: string[] = [`Processed ${actions.length} memory action(s):`, ''];

  for (const action of actions) {
    const icon = action.event === 'ADD' ? '+' : '~';
    lines.push(`  ${icon} [${action.event}] ${action.memory}`);
    lines.push(`    Category: ${action.category ?? 'unknown'} | ID: ${action.id}`);
    if (action.previous) {
      lines.push(`    Previous: ${action.previous}`);
    }
  }

  return lines.join('\n');
}

export function formatMemorySearchResults(items: MemoryItem[], query: string): string {
  if (items.length === 0) {
    return `No memories found for "${query}".`;
  }

  const lines: string[] = [`Found ${items.length} memory(ies) for "${query}":\n`];

  for (let i = 0; i < items.length; i++) {
    const m = items[i];
    lines.push(`${i + 1}. ${m.memory}`);
    lines.push(`   Category: ${m.category} | ID: ${m.id}`);
    if (m.source) lines.push(`   Source: ${m.source}`);
    if (m.created_at || m.updated_at) {
      lines.push(`   Created: ${m.created_at || 'unknown'} | Updated: ${m.updated_at || 'unknown'}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

export function formatMemoryList(items: MemoryItem[]): string {
  if (items.length === 0) {
    return 'No memories stored yet. Use `add_memory` to store developer knowledge.';
  }

  const lines: string[] = [`Stored Memories (${items.length}):\n`];

  const grouped = new Map<string, MemoryItem[]>();
  for (const m of items) {
    const cat = m.category || 'uncategorized';
    if (!grouped.has(cat)) grouped.set(cat, []);
    grouped.get(cat)!.push(m);
  }

  for (const [category, memories] of grouped) {
    lines.push(`### ${category} (${memories.length})`);
    for (const m of memories) {
      const updatedDate = m.updated_at ? ` (updated: ${m.updated_at.slice(0, 10)})` : '';
      lines.push(`  - ${m.memory}  [${m.id.slice(0, 8)}...]${updatedDate}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

export function formatMemoryHistory(entries: HistoryEntry[], memoryId: string): string {
  if (entries.length === 0) {
    return `No history found for memory ${memoryId}.`;
  }

  const lines: string[] = [`History for memory ${memoryId} (${entries.length} event(s)):\n`];

  for (const e of entries) {
    lines.push(`  [${e.event}] ${e.created_at}`);
    if (e.new_value) lines.push(`    Value: ${e.new_value}`);
    if (e.previous_value) lines.push(`    Previous: ${e.previous_value}`);
    if (e.source) lines.push(`    Source: ${e.source}`);
    lines.push('');
  }

  return lines.join('\n');
}
