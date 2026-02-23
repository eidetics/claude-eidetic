import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { indexCodebase } from '../src/core/indexer.js';
import { createEmbedding } from '../src/embedding/factory.js';
import { QdrantVectorDB } from '../src/vectordb/qdrant.js';

const config = loadConfig();
const embedding = createEmbedding(config);
await embedding.initialize();
const vectordb = new QdrantVectorDB(config.qdrantUrl, config.qdrantApiKey);

const rootPath = path.resolve(import.meta.dirname, '..');
console.error(`Force re-indexing ${rootPath} ...`);
const result = await indexCodebase(
  rootPath,
  embedding,
  vectordb,
  true,
  (pct, msg) => process.stderr.write(`\r  ${pct}% ${msg}          `),
);
console.error('\n');
console.error(`Done: ${result.totalFiles} files, ${result.totalChunks} chunks, ${result.addedFiles} added`);
