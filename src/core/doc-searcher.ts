import type { Embedding } from '../embedding/types.js';
import type { VectorDB, SearchResult } from '../vectordb/types.js';
import { docCollectionName } from '../paths.js';
import { loadDocMetadata, isStale, type DocEntry } from '../state/doc-metadata.js';
import { SearchError } from '../errors.js';
import { deduplicateResults } from './searcher.js';

export interface DocSearchResult extends SearchResult {
  library: string;
  topic: string;
  source: string;
  stale: boolean;
}

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;

export async function searchDocuments(
  query: string,
  embedding: Embedding,
  vectordb: VectorDB,
  options: { library?: string; limit?: number } = {},
): Promise<DocSearchResult[]> {
  if (!query || query.trim().length === 0) {
    throw new SearchError('Search query is required.');
  }

  const limit = Math.min(Math.max(1, options.limit ?? DEFAULT_LIMIT), MAX_LIMIT);
  const metadata = loadDocMetadata();

  let collectionsToSearch: { collection: string; entries: DocEntry[] }[];

  if (options.library) {
    const collection = docCollectionName(options.library);
    const entries = Object.values(metadata).filter((e) => e.collectionName === collection);
    if (entries.length === 0) {
      throw new SearchError(
        `No cached documentation found for library "${options.library}". ` +
          `Use index_document to cache documentation first.`,
      );
    }
    collectionsToSearch = [{ collection, entries }];
  } else {
    const collectionMap = new Map<string, DocEntry[]>();
    for (const entry of Object.values(metadata)) {
      const existing = collectionMap.get(entry.collectionName) ?? [];
      existing.push(entry);
      collectionMap.set(entry.collectionName, existing);
    }
    if (collectionMap.size === 0) {
      throw new SearchError(
        'No cached documentation found. Use index_document to cache documentation first.',
      );
    }
    collectionsToSearch = [...collectionMap.entries()].map(([collection, entries]) => ({
      collection,
      entries,
    }));
  }

  const queryVector = await embedding.embed(query);
  const overFetchLimit = Math.min(limit * 3, MAX_LIMIT);
  const allResults: DocSearchResult[] = [];

  for (const { collection, entries } of collectionsToSearch) {
    const exists = await vectordb.hasCollection(collection);
    if (!exists) continue;

    const results = await vectordb.search(collection, {
      queryVector,
      queryText: query,
      limit: overFetchLimit,
    });

    for (const r of results) {
      const matchingEntry = entries.find((e) => e.source === r.relativePath);
      allResults.push({
        ...r,
        library: matchingEntry?.library ?? 'unknown',
        topic: matchingEntry?.topic ?? 'unknown',
        source: r.relativePath,
        stale: matchingEntry ? isStale(matchingEntry) : false,
      });
    }
  }

  allResults.sort((a, b) => b.score - a.score);
  const deduped = deduplicateResults(allResults, limit);

  return deduped.map((r) => r as DocSearchResult);
}
