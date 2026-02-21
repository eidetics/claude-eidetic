import { randomUUID } from 'node:crypto';
import type { Embedding } from '../embedding/types.js';
import type { VectorDB } from '../vectordb/types.js';
import type { MemoryItem, MemoryAction, ExtractedFact } from './types.js';
import { MemoryHistory } from './history.js';
import { chatCompletion } from './llm.js';
import { buildSystemPrompt, buildExtractionPrompt } from './prompts.js';
import { hashMemory, reconcile, type ExistingMatch } from './reconciler.js';

const COLLECTION_NAME = 'eidetic_memory';
const SEARCH_CANDIDATES = 5;

// Data model mapping (reuses existing VectorDB/SearchResult fields):
//   content      → memory text (full-text search)
//   relativePath → memory UUID (enables deleteByPath for single-memory deletion)
//   fileExtension→ category (enables extensionFilter for category filtering)
//   language     → source
//   Additional payload: hash, memory, category, source, created_at, updated_at

export class MemoryStore {
  private initialized = false;

  constructor(
    private embedding: Embedding,
    private vectordb: VectorDB,
    private history: MemoryHistory,
  ) {}

  private async ensureCollection(): Promise<void> {
    if (this.initialized) return;
    const exists = await this.vectordb.hasCollection(COLLECTION_NAME);
    if (!exists) {
      await this.vectordb.createCollection(COLLECTION_NAME, this.embedding.dimension);
    }
    this.initialized = true;
  }

  async addMemory(content: string, source?: string): Promise<MemoryAction[]> {
    await this.ensureCollection();

    const facts = await this.extractFacts(content);
    if (facts.length === 0) return [];

    const actions: MemoryAction[] = [];

    for (const fact of facts) {
      const action = await this.processFact(fact, source);
      if (action) actions.push(action);
    }

    return actions;
  }

  async searchMemory(query: string, limit = 10, category?: string): Promise<MemoryItem[]> {
    await this.ensureCollection();

    const queryVector = await this.embedding.embed(query);
    const results = await this.vectordb.search(COLLECTION_NAME, {
      queryVector,
      queryText: query,
      limit,
      ...(category ? { extensionFilter: [category] } : {}),
    });

    // Enrich with full payload from getById
    const items: MemoryItem[] = [];
    for (const r of results) {
      const id = r.relativePath; // memory UUID stored in relativePath
      const point = await this.vectordb.getById(COLLECTION_NAME, id);
      if (!point) continue;
      items.push(payloadToMemoryItem(id, point.payload));
    }
    return items;
  }

  async listMemories(category?: string, limit = 50): Promise<MemoryItem[]> {
    await this.ensureCollection();

    const queryVector = await this.embedding.embed('developer knowledge');
    const results = await this.vectordb.search(COLLECTION_NAME, {
      queryVector,
      queryText: '',
      limit,
      ...(category ? { extensionFilter: [category] } : {}),
    });

    const items: MemoryItem[] = [];
    for (const r of results) {
      const id = r.relativePath;
      const point = await this.vectordb.getById(COLLECTION_NAME, id);
      if (!point) continue;
      items.push(payloadToMemoryItem(id, point.payload));
    }
    return items;
  }

  async deleteMemory(id: string): Promise<boolean> {
    await this.ensureCollection();

    const existing = await this.vectordb.getById(COLLECTION_NAME, id);
    if (!existing) return false;

    const memory = String(existing.payload.memory ?? existing.payload.content ?? '');
    await this.vectordb.deleteByPath(COLLECTION_NAME, id);
    this.history.log(id, 'DELETE', null, memory);
    return true;
  }

  getHistory(memoryId: string) {
    return this.history.getHistory(memoryId);
  }

  private async extractFacts(content: string): Promise<ExtractedFact[]> {
    const userMessage = buildExtractionPrompt(content);
    const response = await chatCompletion(buildSystemPrompt(), userMessage);

    try {
      const parsed = JSON.parse(response);
      const facts = parsed.facts;
      if (!Array.isArray(facts)) return [];
      return facts.filter(
        (f: unknown): f is ExtractedFact =>
          typeof f === 'object' && f !== null &&
          typeof (f as ExtractedFact).fact === 'string' &&
          typeof (f as ExtractedFact).category === 'string',
      );
    } catch {
      return [];
    }
  }

  private async processFact(fact: ExtractedFact, source?: string): Promise<MemoryAction | null> {
    const hash = hashMemory(fact.fact);
    const vector = await this.embedding.embed(fact.fact);

    const searchResults = await this.vectordb.search(COLLECTION_NAME, {
      queryVector: vector,
      queryText: fact.fact,
      limit: SEARCH_CANDIDATES,
    });

    const candidates: ExistingMatch[] = [];
    for (const result of searchResults) {
      const id = result.relativePath;
      if (!id) continue;
      const point = await this.vectordb.getById(COLLECTION_NAME, id);
      if (!point) continue;
      candidates.push({
        id,
        memory: result.content,
        hash: String(point.payload.hash ?? ''),
        vector: point.vector,
        score: result.score,
      });
    }

    const decision = reconcile(hash, vector, candidates);

    if (decision.action === 'NONE') return null;

    const now = new Date().toISOString();

    if (decision.action === 'UPDATE' && decision.existingId) {
      const existingPoint = await this.vectordb.getById(COLLECTION_NAME, decision.existingId);
      const createdAt = String(existingPoint?.payload.created_at ?? now);

      await this.vectordb.updatePoint(COLLECTION_NAME, decision.existingId, vector, {
        content: fact.fact,
        relativePath: decision.existingId,
        fileExtension: fact.category,
        language: source ?? '',
        startLine: 0,
        endLine: 0,
        hash,
        memory: fact.fact,
        category: fact.category,
        source: source ?? '',
        created_at: createdAt,
        updated_at: now,
      });

      this.history.log(decision.existingId, 'UPDATE', fact.fact, decision.existingMemory, source, now);

      return {
        event: 'UPDATE',
        id: decision.existingId,
        memory: fact.fact,
        previous: decision.existingMemory,
        category: fact.category,
        source,
      };
    }

    // ADD
    const id = randomUUID();
    await this.vectordb.updatePoint(COLLECTION_NAME, id, vector, {
      content: fact.fact,
      relativePath: id,
      fileExtension: fact.category,
      language: source ?? '',
      startLine: 0,
      endLine: 0,
      hash,
      memory: fact.fact,
      category: fact.category,
      source: source ?? '',
      created_at: now,
      updated_at: now,
    });

    this.history.log(id, 'ADD', fact.fact, null, source, now);

    return {
      event: 'ADD',
      id,
      memory: fact.fact,
      category: fact.category,
      source,
    };
  }
}

function payloadToMemoryItem(id: string, payload: Record<string, unknown>): MemoryItem {
  return {
    id,
    memory: String(payload.memory ?? payload.content ?? ''),
    hash: String(payload.hash ?? ''),
    category: String(payload.category ?? payload.fileExtension ?? ''),
    source: String(payload.source ?? payload.language ?? ''),
    created_at: String(payload.created_at ?? ''),
    updated_at: String(payload.updated_at ?? ''),
  };
}
