import { randomUUID } from 'node:crypto';
import type { Embedding } from '../embedding/types.js';
import type { VectorDB, CodeDocument } from '../vectordb/types.js';
import { LineSplitter } from '../splitter/line.js';
import { docCollectionName } from '../paths.js';
import { upsertDocEntry } from '../state/doc-metadata.js';
import { IndexingError } from '../errors.js';
import { getConfig } from '../config.js';

export interface DocIndexResult {
  library: string;
  topic: string;
  source: string;
  collectionName: string;
  totalChunks: number;
  estimatedTokens: number;
  durationMs: number;
}

export async function indexDocument(
  content: string,
  source: string,
  library: string,
  topic: string,
  embedding: Embedding,
  vectordb: VectorDB,
  ttlDays: number = 7,
): Promise<DocIndexResult> {
  const start = Date.now();

  if (!content || content.trim().length === 0) {
    throw new IndexingError('Document content is empty.');
  }
  if (!source) throw new IndexingError('Document source is required.');
  if (!library) throw new IndexingError('Library name is required.');
  if (!topic) throw new IndexingError('Topic is required.');

  const collection = docCollectionName(library);
  const config = getConfig();

  const splitter = new LineSplitter();
  const chunks = splitter.split(content, 'markdown', source);

  if (chunks.length === 0) {
    throw new IndexingError('Document produced no chunks after splitting.');
  }

  const exists = await vectordb.hasCollection(collection);
  if (!exists) {
    await vectordb.createCollection(collection, embedding.dimension);
  }

  try {
    await vectordb.deleteByPath(collection, source);
  } catch {
    // collection may be new with no matching docs
  }

  const batchSize = config.embeddingBatchSize;
  let totalChunks = 0;
  let totalTokens = 0;

  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    const texts = batch.map(c => c.content);

    const estimation = embedding.estimateTokens(texts);
    totalTokens += estimation.estimatedTokens;

    const vectors = await embedding.embedBatch(texts);

    const documents: CodeDocument[] = batch.map((chunk, j) => ({
      id: randomUUID(),
      content: chunk.content,
      vector: vectors[j],
      relativePath: source,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      fileExtension: '.md',
      language: 'markdown',
    }));

    await vectordb.insert(collection, documents);
    totalChunks += batch.length;
  }

  upsertDocEntry({
    library,
    topic,
    source,
    collectionName: collection,
    indexedAt: new Date().toISOString(),
    ttlDays,
    totalChunks,
  });

  return {
    library,
    topic,
    source,
    collectionName: collection,
    totalChunks,
    estimatedTokens: totalTokens,
    durationMs: Date.now() - start,
  };
}
