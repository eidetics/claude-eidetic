import type { Embedding, EmbeddingVector, TokenEstimate } from '../embedding/types.js';

export interface EmbedCall {
  method: 'embed' | 'embedBatch';
  texts: string[];
}

/**
 * Deterministic mock embedding for testing.
 * Generates vectors from charCode values, normalized to unit length.
 */
export class MockEmbedding implements Embedding {
  readonly dimension: number;
  readonly calls: EmbedCall[] = [];

  constructor(dimension = 32) {
    this.dimension = dimension;
  }

  async initialize(): Promise<void> {
    // no-op
  }

  async embed(text: string): Promise<EmbeddingVector> {
    this.calls.push({ method: 'embed', texts: [text] });
    return this.deterministicVector(text);
  }

  async embedBatch(texts: string[]): Promise<EmbeddingVector[]> {
    this.calls.push({ method: 'embedBatch', texts });
    return texts.map(t => this.deterministicVector(t));
  }

  estimateTokens(texts: string[]): TokenEstimate {
    const totalChars = texts.reduce((sum, t) => sum + t.length, 0);
    const estimatedTokens = Math.ceil(totalChars / 4);
    return {
      totalChars,
      estimatedTokens,
      estimatedCostUsd: estimatedTokens * 0.00002 / 1000,
    };
  }

  private deterministicVector(text: string): EmbeddingVector {
    const vec = new Array(this.dimension).fill(0);
    for (let i = 0; i < text.length; i++) {
      vec[i % this.dimension] += text.charCodeAt(i);
    }
    // Normalize to unit length
    const magnitude = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
    if (magnitude === 0) return vec;
    return vec.map(v => v / magnitude);
  }
}
