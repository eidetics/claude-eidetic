import { readFile, stat } from 'node:fs/promises';
import { normalizePath, pathToCollectionName } from './paths.js';
import { indexCodebase, previewCodebase, deleteSnapshot } from './core/indexer.js';
import { getConfig } from './config.js';
import { searchCode, formatSearchResults, formatCompactResults } from './core/searcher.js';
import { indexDocument } from './core/doc-indexer.js';
import { searchDocuments } from './core/doc-searcher.js';
import { StateManager } from './state/snapshot.js';
import { registerProject, resolveProject, listProjects } from './state/registry.js';
import type { Embedding } from './embedding/types.js';
import type { VectorDB } from './vectordb/types.js';
import { textResult, formatPreview, formatIndexResult, formatListIndexed, formatDocIndexResult, formatDocSearchResults, formatMemoryActions, formatMemorySearchResults, formatMemoryList, formatMemoryHistory } from './format.js';
import type { MemoryStore } from './memory/store.js';

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
  const prev = locks.get(key) ?? Promise.resolve();

  let resolve!: () => void;
  const current = new Promise<void>(r => { resolve = r; });
  locks.set(key, current);

  await prev;

  try {
    return await fn();
  } finally {
    resolve();
    if (locks.get(key) === current) {
      locks.delete(key);
    }
  }
}

export class ToolHandlers {
  private memoryStore: MemoryStore | null = null;

  constructor(
    private embedding: Embedding,
    private vectordb: VectorDB,
    private state: StateManager,
  ) {}

  setMemoryStore(store: MemoryStore): void {
    this.memoryStore = store;
  }

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

  async handleIndexDocument(args: Record<string, unknown>): Promise<{ content: { type: string; text: string }[] }> {
    const content = args.content as string | undefined;
    if (!content) return textResult('Error: "content" is required. Provide the documentation text to cache.');

    const source = args.source as string | undefined;
    if (!source) return textResult('Error: "source" is required. Provide the source URL or identifier.');

    const library = args.library as string | undefined;
    if (!library) return textResult('Error: "library" is required. Provide the library name (e.g., "react", "langfuse").');

    const topic = args.topic as string | undefined;
    if (!topic) return textResult('Error: "topic" is required. Provide the topic within the library (e.g., "hooks").');

    const ttlDays = (args.ttlDays as number) ?? 7;

    try {
      const result = await indexDocument(content, source, library, topic, this.embedding, this.vectordb, ttlDays);
      return textResult(formatDocIndexResult(result));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return textResult(`Error caching documentation: ${message}`);
    }
  }

  async handleSearchDocuments(args: Record<string, unknown>): Promise<{ content: { type: string; text: string }[] }> {
    const query = args.query as string | undefined;
    if (!query) return textResult('Error: "query" is required. Provide a natural language search query.');

    const library = args.library as string | undefined;
    const rawLimit = args.limit as number | undefined;
    const limit = (rawLimit !== undefined && Number.isFinite(rawLimit) && rawLimit >= 1)
      ? rawLimit
      : undefined;

    try {
      const results = await searchDocuments(query, this.embedding, this.vectordb, { library, limit });
      return textResult(formatDocSearchResults(results, query));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return textResult(`Error: ${message}`);
    }
  }

  async handleAddMemory(args: Record<string, unknown>): Promise<{ content: { type: string; text: string }[] }> {
    if (!this.memoryStore) return textResult('Error: Memory system not initialized.');

    const content = args.content as string | undefined;
    if (!content) return textResult('Error: "content" is required. Provide text containing developer knowledge to extract.');

    const source = args.source as string | undefined;

    try {
      const actions = await this.memoryStore.addMemory(content, source);
      return textResult(formatMemoryActions(actions));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return textResult(`Error adding memory: ${message}`);
    }
  }

  async handleSearchMemory(args: Record<string, unknown>): Promise<{ content: { type: string; text: string }[] }> {
    if (!this.memoryStore) return textResult('Error: Memory system not initialized.');

    const query = args.query as string | undefined;
    if (!query) return textResult('Error: "query" is required. Provide a natural language search query.');

    const limit = (args.limit as number | undefined) ?? 10;
    const category = args.category as string | undefined;

    try {
      const results = await this.memoryStore.searchMemory(query, limit, category);
      return textResult(formatMemorySearchResults(results, query));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return textResult(`Error searching memories: ${message}`);
    }
  }

  async handleListMemories(args: Record<string, unknown>): Promise<{ content: { type: string; text: string }[] }> {
    if (!this.memoryStore) return textResult('Error: Memory system not initialized.');

    const category = args.category as string | undefined;
    const limit = (args.limit as number | undefined) ?? 50;

    try {
      const results = await this.memoryStore.listMemories(category, limit);
      return textResult(formatMemoryList(results));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return textResult(`Error listing memories: ${message}`);
    }
  }

  async handleDeleteMemory(args: Record<string, unknown>): Promise<{ content: { type: string; text: string }[] }> {
    if (!this.memoryStore) return textResult('Error: Memory system not initialized.');

    const id = args.id as string | undefined;
    if (!id) return textResult('Error: "id" is required. Provide the UUID of the memory to delete.');

    try {
      const deleted = await this.memoryStore.deleteMemory(id);
      if (!deleted) return textResult(`Memory not found: ${id}`);
      return textResult(`Memory deleted: ${id}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return textResult(`Error deleting memory: ${message}`);
    }
  }

  async handleMemoryHistory(args: Record<string, unknown>): Promise<{ content: { type: string; text: string }[] }> {
    if (!this.memoryStore) return textResult('Error: Memory system not initialized.');

    const id = args.id as string | undefined;
    if (!id) return textResult('Error: "id" is required. Provide the UUID of the memory to view history for.');

    try {
      const entries = this.memoryStore.getHistory(id);
      return textResult(formatMemoryHistory(entries, id));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return textResult(`Error retrieving memory history: ${message}`);
    }
  }
}

const MAX_LINES = 10_000;
const DEFAULT_LINES = 5_000;
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export async function handleReadFile(args: Record<string, unknown>): Promise<{ content: { type: string; text: string }[] }> {
  const rawPath = args.path as string | undefined;
  if (!rawPath) return textResult('Error: "path" is required. Provide an absolute file path.');

  const filePath = normalizePath(rawPath);
  const offset = Math.max(0, (args.offset as number | undefined) ?? 0);
  const limit = Math.min(MAX_LINES, Math.max(1, (args.limit as number | undefined) ?? DEFAULT_LINES));
  const lineNumbers = (args.lineNumbers as boolean | undefined) ?? false;

  let raw: string;
  try {
    const fileStat = await stat(filePath);
    if (fileStat.isDirectory()) return textResult(`Error: Path is a directory, not a file: ${filePath}`);
    if (fileStat.size > MAX_FILE_SIZE) {
      return textResult(`Error: File too large (${(fileStat.size / 1024 / 1024).toFixed(1)}MB). Maximum: 10MB.`);
    }
    raw = await readFile(filePath, 'utf-8');
  } catch (err: unknown) {
    const nodeErr = err as NodeJS.ErrnoException;
    if (nodeErr.code === 'ENOENT') return textResult(`Error: File not found: ${filePath}`);
    if (nodeErr.code === 'EACCES' || nodeErr.code === 'EPERM') return textResult(`Error: Permission denied: ${filePath}`);
    if (nodeErr.code === 'EISDIR') return textResult(`Error: Path is a directory, not a file: ${filePath}`);
    const message = err instanceof Error ? err.message : String(err);
    return textResult(`Error reading file: ${message}`);
  }

  if (raw.includes('\x00')) return textResult(`Error: Binary file detected: ${filePath}`);

  if (raw.length === 0) {
    return textResult(`File: ${filePath} | Lines: 0 total | (empty file)`);
  }

  const allLines = raw.split('\n');
  const totalLines = allLines.length;

  // offset is 1-based line number; convert to 0-based index
  const startIndex = offset > 0 ? offset - 1 : 0;
  const sliced = allLines.slice(startIndex, startIndex + limit);
  const startLine = startIndex + 1;
  const endLine = startIndex + sliced.length;

  let content: string;
  if (lineNumbers) {
    const pad = String(endLine).length;
    content = sliced.map((line, i) => `${String(startLine + i).padStart(pad)} ${line}`).join('\n');
  } else {
    content = sliced.join('\n');
  }

  let meta = `File: ${filePath} | Lines: ${totalLines} total | Showing: ${startLine}–${endLine}`;
  if (endLine < totalLines) {
    meta += ` | Next: read_file(path="${filePath}", offset=${endLine + 1})`;
  }

  return textResult(meta + '\n\n' + content);
}
