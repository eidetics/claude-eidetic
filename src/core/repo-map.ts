import type { VectorDB, SymbolEntry } from '../vectordb/types.js';
import { pathToCollectionName } from '../paths.js';

export interface RepoMapOptions {
  pathFilter?: string;
  kindFilter?: string;
  maxTokens?: number;
}

export interface ListSymbolsOptions {
  pathFilter?: string;
  kindFilter?: string;
  nameFilter?: string;
}

export interface SymbolSource {
  getSymbols(
    collectionName: string,
    options?: RepoMapOptions | ListSymbolsOptions,
  ): Promise<SymbolEntry[]>;
}

export class VectorDBSymbolSource implements SymbolSource {
  constructor(private vectordb: VectorDB) {}

  async getSymbols(
    collectionName: string,
    options?: RepoMapOptions | ListSymbolsOptions,
  ): Promise<SymbolEntry[]> {
    const all = await this.vectordb.listSymbols(collectionName);

    let result = all;

    const pathFilter = (options as RepoMapOptions | undefined)?.pathFilter;
    if (pathFilter) {
      result = result.filter((s) => matchesPathFilter(s.relativePath, pathFilter));
    }

    const kindFilter = (options as RepoMapOptions | undefined)?.kindFilter;
    if (kindFilter) {
      const kind = kindFilter.toLowerCase();
      result = result.filter((s) => s.kind.toLowerCase() === kind);
    }

    const nameFilter = (options as ListSymbolsOptions | undefined)?.nameFilter;
    if (nameFilter) {
      const lower = nameFilter.toLowerCase();
      result = result.filter((s) => s.name.toLowerCase().includes(lower));
    }

    return result;
  }
}

/**
 * Convert a glob-like pattern to a regex for path filtering.
 * Supports * (non-separator) and ** (any path segment).
 */
export function matchesPathFilter(relativePath: string, pattern: string): boolean {
  // Escape regex special chars except * which we handle
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '\uFFFD') // placeholder for **
    .replace(/\*/g, '[^/]*')
    .replace(/\uFFFD/g, '.*');
  const regex = new RegExp(`^${escaped}$`);
  return regex.test(relativePath);
}

/**
 * Deduplicate symbol entries: prefer those with a signature, then by first occurrence.
 */
function deduplicateSymbols(symbols: SymbolEntry[]): SymbolEntry[] {
  const seen = new Map<string, SymbolEntry>();
  for (const sym of symbols) {
    const key = `${sym.relativePath}:${sym.name}:${sym.kind}`;
    const existing = seen.get(key);
    if (!existing || (!existing.signature && sym.signature)) {
      seen.set(key, sym);
    }
  }
  return [...seen.values()];
}

/**
 * Generate a structured repo map grouped by file, with methods nested under classes.
 */
export async function generateRepoMap(
  rootPath: string,
  source: SymbolSource,
  options?: RepoMapOptions,
): Promise<string> {
  const collectionName = pathToCollectionName(rootPath);
  const maxTokens = options?.maxTokens ?? 4000;
  const maxChars = maxTokens * 4;

  const symbols = await source.getSymbols(collectionName, options);

  if (symbols.length === 0) {
    return '(no symbols found — codebase may not be indexed yet)';
  }

  const deduped = deduplicateSymbols(symbols);

  // Group by file
  const byFile = new Map<string, SymbolEntry[]>();
  for (const sym of deduped) {
    const list = byFile.get(sym.relativePath) ?? [];
    list.push(sym);
    byFile.set(sym.relativePath, list);
  }

  // Sort files
  const files = [...byFile.keys()].sort();

  const lines: string[] = [];
  let totalChars = 0;

  for (const file of files) {
    const fileSymbols = byFile.get(file) ?? [];

    // Separate top-level from methods (those with a parentName)
    const topLevel = fileSymbols.filter((s) => !s.parentName);
    const methods = fileSymbols.filter(
      (s): s is SymbolEntry & { parentName: string } => s.parentName !== undefined,
    );

    // Build method lookup by parent
    const methodsByParent = new Map<string, SymbolEntry[]>();
    for (const m of methods) {
      const list = methodsByParent.get(m.parentName) ?? [];
      list.push(m);
      methodsByParent.set(m.parentName, list);
    }

    const fileHeader = `${file}:`;
    if (totalChars + fileHeader.length > maxChars) break;
    lines.push(fileHeader);
    totalChars += fileHeader.length + 1;

    for (const sym of topLevel) {
      const sig = sym.signature ? ` ${sym.signature.trim()}` : ` ${sym.name}`;
      const line = `  [${sym.kind}]${sig}`;
      if (totalChars + line.length > maxChars) {
        lines.push('  ...(truncated)');
        return lines.join('\n');
      }
      lines.push(line);
      totalChars += line.length + 1;

      // Nest methods under this symbol if it's a container
      const children = methodsByParent.get(sym.name) ?? [];
      for (const child of children) {
        const childSig = child.signature ? ` ${child.signature.trim()}` : ` ${child.name}`;
        const childLine = `    [${child.kind}]${childSig}`;
        if (totalChars + childLine.length > maxChars) {
          lines.push('    ...(truncated)');
          return lines.join('\n');
        }
        lines.push(childLine);
        totalChars += childLine.length + 1;
      }
    }
  }

  return lines.join('\n');
}

/**
 * List symbols as a compact Name|Kind|Location table.
 */
export async function listSymbolsTable(
  rootPath: string,
  source: SymbolSource,
  options?: ListSymbolsOptions,
): Promise<string> {
  const collectionName = pathToCollectionName(rootPath);
  const symbols = await source.getSymbols(collectionName, options);

  if (symbols.length === 0) {
    return '(no symbols found)';
  }

  const deduped = deduplicateSymbols(symbols);
  deduped.sort((a, b) => {
    const pathCmp = a.relativePath.localeCompare(b.relativePath);
    if (pathCmp !== 0) return pathCmp;
    return a.startLine - b.startLine;
  });

  const header = 'Name | Kind | Location';
  const sep = '-----|------|--------';
  const rows = deduped.map((s) => {
    const location = `${s.relativePath}:${s.startLine}`;
    return `${s.name} | ${s.kind} | ${location}`;
  });

  return [header, sep, ...rows].join('\n');
}
