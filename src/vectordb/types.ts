import type { EmbeddingVector } from '../embedding/types.js';

export interface CodeDocument {
  id: string;
  content: string;
  vector: EmbeddingVector;
  relativePath: string;
  startLine: number;
  endLine: number;
  fileExtension: string;
  language: string;
}

export interface HybridSearchParams {
  queryVector: EmbeddingVector;
  queryText: string;
  limit: number;
  extensionFilter?: string[];
}

export interface SearchResult {
  content: string;
  relativePath: string;
  startLine: number;
  endLine: number;
  fileExtension: string;
  language: string;
  score: number;
}

export interface VectorDB {
  createCollection(name: string, dimension: number): Promise<void>;
  hasCollection(name: string): Promise<boolean>;
  dropCollection(name: string): Promise<void>;
  insert(name: string, documents: CodeDocument[]): Promise<void>;
  search(name: string, params: HybridSearchParams): Promise<SearchResult[]>;
  deleteByPath(name: string, relativePath: string): Promise<void>;
}
