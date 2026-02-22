/**
 * Shared infrastructure for eval scripts.
 *
 * Loads config, creates embedding + vectordb, resolves the eidetic codebase
 * collection name, and verifies the collection exists. Fails hard with a clear
 * error message if infra is not ready.
 *
 * Exports a single QdrantClient instance so fusion-lift can reuse it for
 * raw dense/text searches without creating a second conflicting connection.
 */

import path from 'node:path';
import { QdrantClient } from '@qdrant/js-client-rest';
import { loadConfig } from '../../src/config.js';
import { createEmbedding } from '../../src/embedding/factory.js';
import { QdrantVectorDB } from '../../src/vectordb/qdrant.js';
import { normalizePath, pathToCollectionName } from '../../src/paths.js';
import type { Embedding } from '../../src/embedding/types.js';
import type { VectorDB } from '../../src/vectordb/types.js';

export interface EvalInfra {
  embedding: Embedding;
  vectordb: VectorDB;
  client: QdrantClient;
  collectionName: string;
  rootPath: string;
}

export async function loadInfra(): Promise<EvalInfra> {
  const config = loadConfig();

  if (!config.openaiApiKey && config.embeddingProvider === 'openai') {
    console.error('❌  OPENAI_API_KEY is not set. Export it and re-run.');
    process.exit(1);
  }

  const embedding = createEmbedding(config);
  await embedding.initialize();

  // Single shared QdrantClient — reused by both QdrantVectorDB and fusion-lift
  // to avoid connection conflicts from multiple client instances.
  const client = new QdrantClient({
    url: config.qdrantUrl,
    ...(config.qdrantApiKey ? { apiKey: config.qdrantApiKey } : {}),
  });

  const vectordb = new QdrantVectorDB(config.qdrantUrl, config.qdrantApiKey);

  // The eidetic codebase itself — two levels up from scripts/eval/
  const rootPath = normalizePath(path.resolve(import.meta.dirname, '../..'));
  const collectionName = pathToCollectionName(rootPath);

  const exists = await client.collectionExists(collectionName)
    .then(r => r.exists)
    .catch(() => false);
  if (!exists) {
    console.error(`❌  Collection "${collectionName}" not found.`);
    console.error(`   Index the codebase first: use the index_codebase tool on "${rootPath}"`);
    process.exit(1);
  }

  return { embedding, vectordb, client, collectionName, rootPath };
}
