import type { Config } from '../config.js';
import type { Embedding } from './types.js';
import { OpenAIEmbedding } from './openai.js';

export function createEmbedding(config: Config): Embedding {
  switch (config.embeddingProvider) {
    case 'openai':
      return new OpenAIEmbedding();

    case 'ollama':
      return new OpenAIEmbedding({
        apiKey: config.openaiApiKey || 'ollama',
        baseUrl: config.ollamaBaseUrl,
        model: config.embeddingModel,
      });

    case 'local':
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
