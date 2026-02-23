import { describe, it, expect, vi, beforeEach } from 'vitest';
import { chatCompletion } from '../llm.js';

// Mock config module
vi.mock('../../config.js', () => ({
  getConfig: vi.fn(),
}));

// Module-level mock fns — referenced inside class bodies
const mockAnthropicCreate = vi.fn();
const mockOpenAICreate = vi.fn();

// Track constructor options for assertion
let lastAnthropicOptions: unknown;
let lastOpenAIOptions: unknown;

// Mock Anthropic SDK using class syntax (arrow functions can't be `new`-d)
vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = { create: mockAnthropicCreate };
    constructor(options: unknown) {
      lastAnthropicOptions = options;
    }
  },
}));

// Mock OpenAI SDK using class syntax
vi.mock('openai', () => ({
  default: class MockOpenAI {
    chat = { completions: { create: mockOpenAICreate } };
    constructor(options: unknown) {
      lastOpenAIOptions = options;
    }
  },
}));

import { getConfig } from '../../config.js';

const mockGetConfig = vi.mocked(getConfig);

describe('chatCompletion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastAnthropicOptions = undefined;
    lastOpenAIOptions = undefined;
  });

  describe('Anthropic provider', () => {
    it('calls Anthropic SDK with correct params', async () => {
      mockAnthropicCreate.mockResolvedValue({
        content: [{ type: 'text', text: '{"facts":[]}' }],
      });

      mockGetConfig.mockReturnValue({
        memoryLlmProvider: 'anthropic',
        memoryLlmModel: 'claude-haiku-4-5-20251001',
        memoryLlmApiKey: undefined,
        anthropicApiKey: 'test-anthropic-key',
        openaiApiKey: '',
        ollamaBaseUrl: '',
        memoryLlmBaseUrl: undefined,
      } as ReturnType<typeof getConfig>);

      const result = await chatCompletion('system prompt', 'user message');

      expect(lastAnthropicOptions).toEqual({ apiKey: 'test-anthropic-key' });
      expect(mockAnthropicCreate).toHaveBeenCalledWith({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2048,
        system: 'system prompt',
        messages: [{ role: 'user', content: 'user message' }],
      });
      expect(result).toBe('{"facts":[]}');
    });

    it('resolves API key: memoryLlmApiKey > anthropicApiKey > openaiApiKey', async () => {
      mockAnthropicCreate.mockResolvedValue({
        content: [{ type: 'text', text: '{}' }],
      });

      mockGetConfig.mockReturnValue({
        memoryLlmProvider: 'anthropic',
        memoryLlmModel: 'claude-haiku-4-5-20251001',
        memoryLlmApiKey: 'explicit-memory-key',
        anthropicApiKey: 'anthropic-key',
        openaiApiKey: 'openai-key',
        ollamaBaseUrl: '',
        memoryLlmBaseUrl: undefined,
      } as ReturnType<typeof getConfig>);

      await chatCompletion('sys', 'user');
      expect(lastAnthropicOptions).toEqual({ apiKey: 'explicit-memory-key' });
    });

    it('falls back to anthropicApiKey when memoryLlmApiKey not set', async () => {
      mockAnthropicCreate.mockResolvedValue({
        content: [{ type: 'text', text: '{}' }],
      });

      mockGetConfig.mockReturnValue({
        memoryLlmProvider: 'anthropic',
        memoryLlmModel: 'claude-haiku-4-5-20251001',
        memoryLlmApiKey: undefined,
        anthropicApiKey: 'anthropic-key',
        openaiApiKey: 'openai-key',
        ollamaBaseUrl: '',
        memoryLlmBaseUrl: undefined,
      } as ReturnType<typeof getConfig>);

      await chatCompletion('sys', 'user');
      expect(lastAnthropicOptions).toEqual({ apiKey: 'anthropic-key' });
    });

    it('returns {} when Anthropic response has no text block', async () => {
      mockAnthropicCreate.mockResolvedValue({ content: [] });

      mockGetConfig.mockReturnValue({
        memoryLlmProvider: 'anthropic',
        memoryLlmModel: 'claude-haiku-4-5-20251001',
        memoryLlmApiKey: 'key',
        anthropicApiKey: '',
        openaiApiKey: '',
        ollamaBaseUrl: '',
        memoryLlmBaseUrl: undefined,
      } as ReturnType<typeof getConfig>);

      const result = await chatCompletion('sys', 'user');
      expect(result).toBe('{}');
    });

    it('throws MemoryError when no API key configured', async () => {
      mockGetConfig.mockReturnValue({
        memoryLlmProvider: 'anthropic',
        memoryLlmModel: 'claude-haiku-4-5-20251001',
        memoryLlmApiKey: undefined,
        anthropicApiKey: '',
        openaiApiKey: '',
        ollamaBaseUrl: '',
        memoryLlmBaseUrl: undefined,
      } as ReturnType<typeof getConfig>);

      await expect(chatCompletion('sys', 'user')).rejects.toThrow('No API key configured');
    });
  });

  describe('OpenAI provider', () => {
    it('calls OpenAI SDK for openai provider', async () => {
      mockOpenAICreate.mockResolvedValue({
        choices: [{ message: { content: '{"facts":[]}' } }],
      });

      mockGetConfig.mockReturnValue({
        memoryLlmProvider: 'openai',
        memoryLlmModel: 'gpt-4o-mini',
        memoryLlmApiKey: 'openai-key',
        anthropicApiKey: '',
        openaiApiKey: '',
        ollamaBaseUrl: '',
        memoryLlmBaseUrl: undefined,
      } as ReturnType<typeof getConfig>);

      const result = await chatCompletion('sys', 'user');
      expect(mockOpenAICreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'gpt-4o-mini',
          response_format: { type: 'json_object' },
        }),
      );
      expect(result).toBe('{"facts":[]}');
    });
  });
});
