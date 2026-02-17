import type { VectorDB, CodeDocument, HybridSearchParams, SearchResult } from '../vectordb/types.js';

export interface VectorDBCall {
  method: string;
  args: unknown[];
}

/**
 * In-memory mock VectorDB for testing.
 * Search does simple case-insensitive text matching on content.
 */
export class MockVectorDB implements VectorDB {
  readonly collections = new Map<string, { dimension: number; documents: CodeDocument[] }>();
  readonly calls: VectorDBCall[] = [];

  async createCollection(name: string, dimension: number): Promise<void> {
    this.calls.push({ method: 'createCollection', args: [name, dimension] });
    this.collections.set(name, { dimension, documents: [] });
  }

  async hasCollection(name: string): Promise<boolean> {
    this.calls.push({ method: 'hasCollection', args: [name] });
    return this.collections.has(name);
  }

  async dropCollection(name: string): Promise<void> {
    this.calls.push({ method: 'dropCollection', args: [name] });
    this.collections.delete(name);
  }

  async insert(name: string, documents: CodeDocument[]): Promise<void> {
    this.calls.push({ method: 'insert', args: [name, documents] });
    const col = this.collections.get(name);
    if (!col) throw new Error(`Collection "${name}" does not exist`);
    col.documents.push(...documents);
  }

  async search(name: string, params: HybridSearchParams): Promise<SearchResult[]> {
    this.calls.push({ method: 'search', args: [name, params] });
    const col = this.collections.get(name);
    if (!col) return [];

    const query = params.queryText.toLowerCase();
    const terms = query.split(/\s+/).filter(t => t.length > 0);

    let docs = col.documents;

    // Apply extension filter
    if (params.extensionFilter?.length) {
      docs = docs.filter(d => params.extensionFilter!.includes(d.fileExtension));
    }

    // Score by term match count
    const scored = docs.map(doc => {
      const content = doc.content.toLowerCase();
      const hits = terms.filter(t => content.includes(t)).length;
      return { doc, score: hits / Math.max(terms.length, 1) };
    });

    // Sort by score desc, take limit
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, params.limit).map(({ doc, score }) => ({
      content: doc.content,
      relativePath: doc.relativePath,
      startLine: doc.startLine,
      endLine: doc.endLine,
      fileExtension: doc.fileExtension,
      language: doc.language,
      score,
    }));
  }

  async deleteByPath(name: string, relativePath: string): Promise<void> {
    this.calls.push({ method: 'deleteByPath', args: [name, relativePath] });
    const col = this.collections.get(name);
    if (!col) return;
    col.documents = col.documents.filter(d => d.relativePath !== relativePath);
  }

  /** Reset all state for test isolation */
  reset(): void {
    this.collections.clear();
    this.calls.length = 0;
  }
}
