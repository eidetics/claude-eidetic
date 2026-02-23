import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Embedding } from '../embedding/types.js';
import type { VectorDB, CodeDocument } from '../vectordb/types.js';
import type { CodeChunk } from '../splitter/types.js';
import { AstSplitter } from '../splitter/ast.js';
import { LineSplitter } from '../splitter/line.js';
import { extensionToLanguage, buildSnapshot } from './sync.js';
import { getConfig } from '../config.js';
import { normalizePath, pathToCollectionName } from '../paths.js';
import { classifyFileCategory } from './file-category.js';
import { loadSnapshot, saveSnapshot } from './snapshot-io.js';

export interface TargetedIndexResult {
  processedFiles: number;
  totalChunks: number;
  skippedFiles: number;
  durationMs: number;
}

/**
 * Re-index a specific set of files within a project.
 * For each file: delete stale vectors, re-split, re-embed, re-insert, update snapshot.
 *
 * @param rootPath       Absolute path to the project root
 * @param relativePaths  Relative paths (from rootPath) of files to re-index
 * @param embedding      Embedding provider
 * @param vectordb       Vector DB provider
 */
export async function indexFiles(
  rootPath: string,
  relativePaths: string[],
  embedding: Embedding,
  vectordb: VectorDB,
): Promise<TargetedIndexResult> {
  const start = Date.now();
  const normalizedRoot = normalizePath(rootPath);
  const collectionName = pathToCollectionName(normalizedRoot);
  const config = getConfig();

  // Skip if the collection doesn't exist (codebase never indexed)
  if (!(await vectordb.hasCollection(collectionName))) {
    process.stderr.write(
      `[targeted-indexer] No collection for ${normalizedRoot} — codebase not indexed, skipping.\n`,
    );
    return {
      processedFiles: 0,
      totalChunks: 0,
      skippedFiles: relativePaths.length,
      durationMs: Date.now() - start,
    };
  }

  const astSplitter = new AstSplitter();
  const lineSplitter = new LineSplitter();
  const allChunks: CodeChunk[] = [];
  const processedPaths: string[] = [];
  const deletedPaths: string[] = [];
  let skippedFiles = 0;

  // Step 1: delete stale vectors and split files
  const concurrency = config.indexingConcurrency;
  for (let i = 0; i < relativePaths.length; i += concurrency) {
    const batch = relativePaths.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(
        async (relPath): Promise<{ relPath: string; chunks: CodeChunk[]; deleted: boolean }> => {
          // Always remove stale vectors first
          await vectordb.deleteByPath(collectionName, relPath);

          const fullPath = path.join(normalizedRoot, relPath);
          let code: string;
          try {
            code = fs.readFileSync(fullPath, 'utf-8');
          } catch (err) {
            if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
              // File was deleted — vectors removed, skip re-embedding
              return { relPath, chunks: [], deleted: true };
            }
            throw err;
          }

          if (code.trim().length === 0) return { relPath, chunks: [], deleted: false };

          const ext = path.extname(relPath);
          const language = extensionToLanguage(ext);

          let chunks = astSplitter.split(code, language, relPath);
          if (chunks.length === 0) {
            chunks = lineSplitter.split(code, language, relPath);
          }
          return { relPath, chunks, deleted: false };
        },
      ),
    );

    for (const { relPath, chunks, deleted } of batchResults) {
      if (deleted) {
        deletedPaths.push(relPath);
        skippedFiles++;
      } else {
        allChunks.push(...chunks);
        processedPaths.push(relPath);
      }
    }
  }

  // Step 2: embed and insert chunks
  const batchSize = config.embeddingBatchSize;
  let totalChunks = 0;

  for (let i = 0; i < allChunks.length; i += batchSize) {
    const batch = allChunks.slice(i, i + batchSize);
    const texts = batch.map((c) => c.content);
    const vectors = await embedding.embedBatch(texts);

    const documents: CodeDocument[] = batch.map((chunk, j) => ({
      id: randomUUID(),
      content: chunk.content,
      vector: vectors[j],
      relativePath: chunk.filePath,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      fileExtension: path.extname(chunk.filePath),
      language: chunk.language,
      fileCategory: classifyFileCategory(chunk.filePath),
      symbolName: chunk.symbolName,
      symbolKind: chunk.symbolKind,
      symbolSignature: chunk.symbolSignature,
      parentSymbol: chunk.parentSymbol,
    }));

    await vectordb.insert(collectionName, documents);
    totalChunks += batch.length;
  }

  // Step 3: update snapshot — refresh hashes for processed files, remove deleted
  const snapshot = loadSnapshot(normalizedRoot);
  if (snapshot) {
    const freshSnapshot = buildSnapshot(normalizedRoot, processedPaths);
    for (const relPath of processedPaths) {
      if (freshSnapshot[relPath]) {
        snapshot[relPath] = freshSnapshot[relPath];
      }
    }
    for (const relPath of deletedPaths) {
      Reflect.deleteProperty(snapshot, relPath);
    }
    saveSnapshot(normalizedRoot, snapshot);
  }

  return {
    processedFiles: processedPaths.length,
    totalChunks,
    skippedFiles,
    durationMs: Date.now() - start,
  };
}
