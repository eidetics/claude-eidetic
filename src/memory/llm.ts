import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { getConfig } from '../config.js';
import { MemoryError } from '../errors.js';

export async function chatCompletion(
  systemPrompt: string,
  userMessage: string,
): Promise<string> {
  const config = getConfig();

  if (config.memoryLlmProvider === 'anthropic') {
    const apiKey = config.memoryLlmApiKey ?? config.anthropicApiKey ?? config.openaiApiKey;
    if (!apiKey) {
      throw new MemoryError('No API key configured for memory LLM. Set MEMORY_LLM_API_KEY, ANTHROPIC_API_KEY, or OPENAI_API_KEY.');
    }

    const client = new Anthropic({ apiKey });

    try {
      const response = await client.messages.create({
        model: config.memoryLlmModel,
        max_tokens: 2048,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      });

      const block = response.content[0];
      return block?.type === 'text' ? block.text : '{}';
    } catch (err) {
      throw new MemoryError('Memory LLM call failed', err);
    }
  }

  // OpenAI / Ollama path
  const apiKey = config.memoryLlmApiKey ?? config.openaiApiKey;
  if (!apiKey) {
    throw new MemoryError('No API key configured for memory LLM. Set MEMORY_LLM_API_KEY or OPENAI_API_KEY.');
  }

  let baseURL: string | undefined;
  if (config.memoryLlmBaseUrl) {
    baseURL = config.memoryLlmBaseUrl;
  } else if (config.memoryLlmProvider === 'ollama') {
    baseURL = config.ollamaBaseUrl;
  }

  const client = new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) });

  try {
    const response = await client.chat.completions.create({
      model: config.memoryLlmModel,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      temperature: 0,
      response_format: { type: 'json_object' },
    });

    return response.choices[0]?.message?.content ?? '{}';
  } catch (err) {
    throw new MemoryError('Memory LLM call failed', err);
  }
}
