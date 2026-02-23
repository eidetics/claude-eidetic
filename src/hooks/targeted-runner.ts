#!/usr/bin/env node
/**
 * Standalone CLI for background targeted re-indexing.
 * Spawned as a detached child process by stop-hook.ts.
 *
 * Usage: node targeted-runner.js <manifest-json-path>
 *
 * Manifest JSON: { projectPath: string, modifiedFiles: string[] }
 */

import fs from 'node:fs';
import { indexFiles } from '../core/targeted-indexer.js';
import { createEmbedding } from '../embedding/factory.js';
import { QdrantVectorDB } from '../vectordb/qdrant.js';
import { bootstrapQdrant } from '../infra/qdrant-bootstrap.js';
import { loadConfig } from '../config.js';
import type { VectorDB } from '../vectordb/types.js';

async function main(): Promise<void> {
  const manifestPath = process.argv[2];
  if (!manifestPath) {
    process.stderr.write('Usage: targeted-runner.js <manifest-json-path>\n');
    process.exit(1);
  }

  let manifest: { projectPath: string; modifiedFiles: string[] };
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  } catch (err) {
    process.stderr.write(`[targeted-runner] Failed to read manifest: ${err}\n`);
    process.exit(1);
  }

  // Clean up manifest file
  try {
    fs.unlinkSync(manifestPath);
  } catch {
    // Ignore — best effort
  }

  const { projectPath, modifiedFiles } = manifest;

  if (!projectPath || !Array.isArray(modifiedFiles) || modifiedFiles.length === 0) {
    process.stderr.write('[targeted-runner] Empty or invalid manifest, nothing to do.\n');
    process.exit(0);
  }

  try {
    const config = loadConfig();
    const embedding = createEmbedding(config);
    await embedding.initialize();

    let vectordb: VectorDB;
    if (config.vectordbProvider === 'milvus') {
      const { MilvusVectorDB } = await import('../vectordb/milvus.js');
      vectordb = new MilvusVectorDB();
    } else {
      const qdrantUrl = await bootstrapQdrant();
      vectordb = new QdrantVectorDB(qdrantUrl, config.qdrantApiKey);
    }

    const result = await indexFiles(projectPath, modifiedFiles, embedding, vectordb);

    process.stderr.write(
      `[targeted-runner] Re-indexed ${result.processedFiles} files ` +
      `(${result.totalChunks} chunks, ${result.skippedFiles} deleted) ` +
      `in ${result.durationMs}ms\n`,
    );
  } catch (err) {
    process.stderr.write(`[targeted-runner] Failed: ${err}\n`);
    process.exit(1);
  }
}

main();
