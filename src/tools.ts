import { normalizePath, pathToCollectionName } from './paths.js';
import { indexCodebase, previewCodebase, deleteSnapshot } from './core/indexer.js';
import { getConfig } from './config.js';
import { searchCode, formatSearchResults, formatCompactResults } from './core/searcher.js';
import { StateManager } from './state/snapshot.js';
import { registerProject, resolveProject, listProjects } from './state/registry.js';
import type { Embedding } from './embedding/types.js';
import type { VectorDB } from './vectordb/types.js';
import { textResult, formatPreview, formatIndexResult, formatListIndexed } from './format.js';

function resolvePath(args: Record<string, unknown>): string | undefined {
  const pathArg = args.path as string | undefined;
  if (pathArg) return normalizePath(pathArg);

  const projectArg = args.project as string | undefined;
  if (projectArg) return resolveProject(projectArg);

  return undefined;
}

function noPathError(): { content: { type: string; text: string }[] } {
  const projects = listProjects();
  const names = Object.keys(projects);
  if (names.length > 0) {
    const list = names.map(n => `  - ${n} → ${projects[n]}`).join('\n');
    return textResult(`Error: provide \`path\` or \`project\`. Registered projects:\n${list}`);
  }
  return textResult('Error: provide \`path\` (absolute) or \`project\` (name). No projects registered yet — index a codebase first.');
}

const locks = new Map<string, Promise<void>>();

async function withMutex<T>(key: string, fn: () => Promise<T>): Promise<T> {
  // Chain onto any existing operation for this key (FIFO ordering, no race)
  const prev = locks.get(key) ?? Promise.resolve();

  let resolve!: () => void;
  const current = new Promise<void>(r => { resolve = r; });
  locks.set(key, current);

  // Wait for previous operation to complete
  await prev;

  try {
    return await fn();
  } finally {
    resolve();
    // Only delete if we're still the latest operation
    if (locks.get(key) === current) {
      locks.delete(key);
    }
  }
}

export class ToolHandlers {
  constructor(
    private embedding: Embedding,
    private vectordb: VectorDB,
    private state: StateManager,
  ) {}

  async handleIndexCodebase(args: Record<string, unknown>): Promise<{ content: { type: string; text: string }[] }> {
    const normalizedPath = resolvePath(args);
    if (!normalizedPath) return noPathError();
    const force = (args.force as boolean) ?? false;
    const dryRun = (args.dryRun as boolean) ?? false;
    const config = getConfig();
    const customExt = (args.customExtensions as string[]) ?? config.customExtensions;
    const customIgnore = (args.customIgnorePatterns as string[]) ?? config.customIgnorePatterns;
    const collectionName = pathToCollectionName(normalizedPath);

    if (dryRun) {
      try {
        const preview = await previewCodebase(normalizedPath, this.embedding, customExt, customIgnore);
        return textResult(formatPreview(preview, normalizedPath));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return textResult(`Error previewing ${normalizedPath}: ${message}`);
      }
    }

    return withMutex(normalizedPath, async () => {
      this.state.setIndexing(normalizedPath, collectionName);

      try {
        const result = await indexCodebase(
          normalizedPath,
          this.embedding,
          this.vectordb,
          force,
          (pct, msg) => this.state.updateProgress(normalizedPath, pct, msg),
          customExt,
          customIgnore,
        );

        this.state.setIndexed(normalizedPath, result.totalFiles, result.totalChunks);
        registerProject(normalizedPath);
        return textResult(formatIndexResult(result, normalizedPath));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.state.setError(normalizedPath, message);
        return textResult(`Error indexing ${normalizedPath}: ${message}`);
      }
    });
  }

  async handleSearchCode(args: Record<string, unknown>): Promise<{ content: { type: string; text: string }[] }> {
    const query = args.query as string | undefined;
    if (!query) return textResult('Error: "query" is required. Provide a natural language search query.');

    const normalizedPath = resolvePath(args);
    if (!normalizedPath) return noPathError();
    const rawLimit = args.limit as number | undefined;
    const limit = (rawLimit !== undefined && Number.isFinite(rawLimit) && rawLimit >= 1)
      ? rawLimit
      : undefined;
    const extensionFilter = args.extensionFilter as string[] | undefined;
    const compact = args.compact !== false; // default true

    try {
      const results = await searchCode(
        normalizedPath,
        query,
        this.embedding,
        this.vectordb,
        { limit, extensionFilter },
      );
      const formatted = compact
        ? formatCompactResults(results, query, normalizedPath)
        : formatSearchResults(results, query, normalizedPath);
      return textResult(formatted);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return textResult(`Error: ${message}`);
    }
  }

  async handleClearIndex(args: Record<string, unknown>): Promise<{ content: { type: string; text: string }[] }> {
    const normalizedPath = resolvePath(args);
    if (!normalizedPath) return noPathError();
    const collectionName = pathToCollectionName(normalizedPath);

    return withMutex(normalizedPath, async () => {
      try {
        await this.vectordb.dropCollection(collectionName);
        deleteSnapshot(normalizedPath);
        this.state.remove(normalizedPath);
        return textResult(`Index cleared for ${normalizedPath}.`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return textResult(`Error clearing index: ${message}`);
      }
    });
  }

  async handleGetIndexingStatus(args: Record<string, unknown>): Promise<{ content: { type: string; text: string }[] }> {
    const normalizedPath = resolvePath(args);
    if (!normalizedPath) return noPathError();
    const state = this.state.getState(normalizedPath);

    if (!state) {
      const collectionName = pathToCollectionName(normalizedPath);
      const exists = await this.vectordb.hasCollection(collectionName);
      if (exists) {
        return textResult(`Codebase at ${normalizedPath} is indexed (status loaded from vector DB).`);
      }
      return textResult(`Codebase at ${normalizedPath} is not indexed.`);
    }

    const lines: string[] = [`Status for ${normalizedPath}: **${state.status}**`];

    if (state.status === 'indexing' && state.progress !== undefined) {
      lines.push(`Progress: ${state.progress}% - ${state.progressMessage ?? ''}`);
    }
    if (state.status === 'indexed') {
      lines.push(`Last indexed: ${state.lastIndexed ?? 'unknown'}`);
      if (state.totalFiles) lines.push(`Files: ${state.totalFiles}`);
      if (state.totalChunks) lines.push(`Chunks: ${state.totalChunks}`);
    }
    if (state.status === 'error') {
      lines.push(`Error: ${state.error ?? 'unknown'}`);
    }

    return textResult(lines.join('\n'));
  }

  async handleListIndexed(): Promise<{ content: { type: string; text: string }[] }> {
    const states = this.state.getAllStates();
    if (states.length === 0) {
      return textResult('No codebases are currently indexed in this session.\n\nUse `index_codebase` to index a codebase first.');
    }
    return textResult(formatListIndexed(states));
  }
}
