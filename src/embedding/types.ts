export type EmbeddingVector = number[];

export interface TokenEstimate {
  totalChars: number;
  estimatedTokens: number;
  estimatedCostUsd: number;
}

export interface Embedding {
  /**
   * Validate provider connectivity and detect embedding dimension.
   * Must be called once before any embed/embedBatch operations.
   */
  initialize(): Promise<void>;
  embed(text: string): Promise<EmbeddingVector>;
  embedBatch(texts: string[]): Promise<EmbeddingVector[]>;
  estimateTokens(texts: string[]): TokenEstimate;
  readonly dimension: number;
}
