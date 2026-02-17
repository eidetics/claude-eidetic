import type { Config } from '../config.js';
import type { Embedding } from './types.js';
import { OpenAIEmbedding } from './openai.js';

/**
 * Create an Embedding instance based on the configured provider.
 *
 * - 'openai'  Uses the OpenAI API directly (requires OPENAI_API_KEY).
 * - 'ollama'  Uses Ollama's OpenAI-compatible /v1/embeddings endpoint.
 *             No API key required; defaults to model "nomic-embed-text".
 * - 'local'   Uses any OpenAI-compatible server at OPENAI_BASE_URL.
 *             Useful for LM Studio, vLLM, LocalAI, etc.
 *
 * The key insight is that Ollama and most local servers expose an
 * OpenAI-compatible embeddings API, so we reuse OpenAIEmbedding
 * with different connection parameters rather than creating separate classes.
 */
export function createEmbedding(config: Config): Embedding {
  switch (config.embeddingProvider) {
    case 'openai':
      return new OpenAIEmbedding();

    case 'ollama':
      // Ollama exposes OpenAI-compatible /v1/embeddings endpoint.
      // It ignores the API key but the OpenAI SDK requires a non-empty string.
      return new OpenAIEmbedding({
        apiKey: config.openaiApiKey || 'ollama',
        baseUrl: config.ollamaBaseUrl,
        model: config.embeddingModel,
      });

    case 'local':
      // Generic OpenAI-compatible endpoint (LM Studio, vLLM, LocalAI, etc.).
      // API key is optional (many local servers skip auth).
      return new OpenAIEmbedding({
        apiKey: config.openaiApiKey || 'local',
        baseUrl: config.openaiBaseUrl,
        model: config.embeddingModel,
      });

    default: {
      const _exhaustive: never = config.embeddingProvider;
      throw new Error(`Unknown embedding provider: ${_exhaustive}`);
    }
  }
}
