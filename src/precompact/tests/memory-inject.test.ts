import { describe, it, expect } from 'vitest';
import { formatMemoryContext } from '../memory-inject.js';
import type { MemoryItem } from '../../memory/types.js';

const makeMemory = (overrides: Partial<MemoryItem> = {}): MemoryItem => ({
  id: 'test-id',
  memory: 'Docker build fails on M1; use --platform linux/amd64',
  hash: 'abc123',
  category: 'debugging',
  source: 'claude',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  ...overrides,
});

describe('formatMemoryContext', () => {
  it('renders section header', () => {
    const output = formatMemoryContext([makeMemory()]);
    expect(output).toContain('## Remembered Knowledge');
  });

  it('includes category prefix in brackets', () => {
    const output = formatMemoryContext([makeMemory({ category: 'debugging' })]);
    expect(output).toContain('[debugging]');
  });

  it('includes memory text', () => {
    const output = formatMemoryContext([makeMemory()]);
    expect(output).toContain('Docker build fails on M1; use --platform linux/amd64');
  });

  it('renders multiple memories as bullet list', () => {
    const memories = [
      makeMemory({ memory: 'First fact', category: 'tools' }),
      makeMemory({ memory: 'Second fact', category: 'workflow' }),
    ];
    const output = formatMemoryContext(memories);
    expect(output).toContain('- [tools] First fact');
    expect(output).toContain('- [workflow] Second fact');
  });

  it('omits category prefix when category is empty', () => {
    const output = formatMemoryContext([makeMemory({ category: '' })]);
    expect(output).not.toContain('[]');
    expect(output).toContain('- Docker build fails');
  });

  it('includes footer with search_memory and add_memory hints', () => {
    const output = formatMemoryContext([makeMemory()]);
    expect(output).toContain('search_memory(query)');
    expect(output).toContain('add_memory(facts)');
  });
});
