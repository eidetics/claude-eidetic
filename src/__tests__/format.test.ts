import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { textResult, formatIndexResult, formatPreview, formatListIndexed } from '../format.js';
import { listProjects } from '../state/registry.js';
import type { IndexResult, PreviewResult } from '../core/indexer.js';
import type { CodebaseState } from '../state/snapshot.js';

vi.mock('../state/registry.js', () => ({
  listProjects: vi.fn(() => ({})),
}));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('textResult', () => {
  it('wraps text in MCP content format', () => {
    const result = textResult('hello');
    expect(result).toEqual({
      content: [{ type: 'text', text: 'hello' }],
    });
  });
});

describe('formatIndexResult', () => {
  const baseResult: IndexResult = {
    totalFiles: 10,
    totalChunks: 50,
    addedFiles: 5,
    modifiedFiles: 2,
    removedFiles: 1,
    skippedFiles: 2,
    parseFailures: [],
    estimatedTokens: 15000,
    estimatedCostUsd: 0.003,
    durationMs: 2500,
  };

  it('includes all metric values as aligned key-value pairs', () => {
    const output = formatIndexResult(baseResult, '/test/path');
    expect(output).toContain('Total files:    10');
    expect(output).toContain('Total chunks:   50');
    expect(output).toContain('Added:          5');
    expect(output).toContain('Modified:       2');
    expect(output).toContain('Removed:        1');
    expect(output).toContain('Skipped:        2');
    expect(output).toContain('Tokens:         ~15K');
    expect(output).toContain('Cost:           $0.0030');
    expect(output).toContain('Duration:       2.5s');
  });

  it('does not contain markdown table syntax', () => {
    const output = formatIndexResult(baseResult, '/test/path');
    expect(output).not.toMatch(/\|.*\|/);
    expect(output).not.toContain('**');
  });

  it('includes the normalized path in header', () => {
    const output = formatIndexResult(baseResult, '/my/project');
    expect(output).toContain('Indexing complete for /my/project');
  });

  it('shows parse failures section', () => {
    const result = { ...baseResult, parseFailures: ['file1.ts', 'file2.ts'] };
    const output = formatIndexResult(result, '/test');
    expect(output).toContain('Parse failures:');
    expect(output).toContain('file1.ts');
    expect(output).toContain('file2.ts');
  });

  it('truncates parse failures at 10', () => {
    const failures = Array.from({ length: 15 }, (_, i) => `fail${i}.ts`);
    const result = { ...baseResult, parseFailures: failures };
    const output = formatIndexResult(result, '/test');
    expect(output).toContain('fail9.ts');
    expect(output).toContain('and 5 more');
    expect(output).not.toContain('fail10.ts');
  });

  it('hides parse failures list when none exist', () => {
    const output = formatIndexResult(baseResult, '/test');
    // The metric line "Parse failures: 0" exists, but the detailed list section should not
    const lines = output.split('\n');
    const failureListLines = lines.filter(l => l.startsWith('- ') || l === 'Parse failures:');
    expect(failureListLines).toEqual([]);
  });

  it('handles zero values', () => {
    const result: IndexResult = {
      totalFiles: 0, totalChunks: 0, addedFiles: 0, modifiedFiles: 0,
      removedFiles: 0, skippedFiles: 0, parseFailures: [],
      estimatedTokens: 0, estimatedCostUsd: 0, durationMs: 0,
    };
    const output = formatIndexResult(result, '/empty');
    expect(output).toContain('Total files:    0');
    expect(output).toContain('Tokens:         ~0K');
    expect(output).toContain('Duration:       0.0s');
  });

  it('handles large token counts', () => {
    const result = { ...baseResult, estimatedTokens: 5_500_000 };
    const output = formatIndexResult(result, '/big');
    expect(output).toContain('~5500K');
  });
});

describe('formatPreview', () => {
  const basePreview: PreviewResult = {
    totalFiles: 100,
    byExtension: { '.ts': 60, '.js': 30, '.py': 10 },
    topDirectories: [
      { dir: 'src', count: 70 },
      { dir: 'lib', count: 30 },
    ],
    estimatedTokens: 500_000,
    estimatedCostUsd: 0.01,
    warnings: [],
  };

  it('does not contain markdown table syntax', () => {
    const output = formatPreview(basePreview, '/project');
    expect(output).not.toMatch(/\|.*\|/);
    expect(output).not.toContain('**');
  });

  it('formats extensions sorted by count descending', () => {
    const output = formatPreview(basePreview, '/project');
    const tsIdx = output.indexOf('.ts');
    const jsIdx = output.indexOf('.js');
    const pyIdx = output.indexOf('.py');
    expect(tsIdx).toBeLessThan(jsIdx);
    expect(jsIdx).toBeLessThan(pyIdx);
  });

  it('aligns extension columns', () => {
    const preview: PreviewResult = {
      ...basePreview,
      byExtension: { '.ts': 60, '.yaml': 5 },
    };
    const output = formatPreview(preview, '/project');
    // .ts should be padded to match .yaml length
    expect(output).toMatch(/\.ts\s{3,}\d/);
  });

  it('formats top directories', () => {
    const output = formatPreview(basePreview, '/project');
    expect(output).toContain('src/: 70 files');
    expect(output).toContain('lib/: 30 files');
  });

  it('formats token estimate with K suffix', () => {
    const preview = { ...basePreview, estimatedTokens: 50_000 };
    const output = formatPreview(preview, '/project');
    expect(output).toContain('~50K tokens');
  });

  it('formats token estimate with M suffix for large codebases', () => {
    const preview = { ...basePreview, estimatedTokens: 2_500_000 };
    const output = formatPreview(preview, '/project');
    expect(output).toContain('~2.5M');
  });

  it('shows warnings or "None"', () => {
    const output = formatPreview(basePreview, '/project');
    expect(output).toContain('- None');

    const preview = { ...basePreview, warnings: ['Large directory detected'] };
    const withWarning = formatPreview(preview, '/project');
    expect(withWarning).toContain('Large directory detected');
  });

  it('shows multiple warnings', () => {
    const preview = { ...basePreview, warnings: ['Warn 1', 'Warn 2', 'Warn 3'] };
    const output = formatPreview(preview, '/project');
    expect(output).toContain('- Warn 1');
    expect(output).toContain('- Warn 2');
    expect(output).toContain('- Warn 3');
    expect(output).not.toContain('- None');
  });

  it('handles empty extension map', () => {
    const preview: PreviewResult = {
      ...basePreview, totalFiles: 0, byExtension: {}, topDirectories: [],
    };
    const output = formatPreview(preview, '/empty');
    expect(output).toContain('Total: 0 files');
    expect(output).not.toContain('Top directories:');
  });

  it('handles single extension', () => {
    const preview: PreviewResult = {
      ...basePreview, byExtension: { '.rs': 42 },
    };
    const output = formatPreview(preview, '/rust');
    expect(output).toContain('.rs');
    expect(output).toContain('42');
  });
});

describe('formatListIndexed', () => {
  it('shows heading with count', () => {
    const states: CodebaseState[] = [];
    const output = formatListIndexed(states);
    expect(output).toContain('Indexed Codebases (0)');
  });

  it('shows project name from registry', () => {
    vi.mocked(listProjects).mockReturnValue({ myproject: '/test/path' });
    const states: CodebaseState[] = [
      { path: '/test/path', collectionName: 'test_path', status: 'indexed', totalFiles: 10, totalChunks: 50, lastIndexed: '2024-01-01' },
    ];
    const output = formatListIndexed(states);
    expect(output).toContain('myproject');
    expect(output).toContain('/test/path');
  });

  it('does not contain markdown syntax', () => {
    vi.mocked(listProjects).mockReturnValue({});
    const states: CodebaseState[] = [
      { path: '/test/path', collectionName: 'test_path', status: 'indexed', totalFiles: 10, totalChunks: 50, lastIndexed: '2024-01-01' },
    ];
    const output = formatListIndexed(states);
    expect(output).not.toContain('**');
    expect(output).not.toContain('##');
    expect(output).not.toMatch(/\|.*\|/);
  });

  it('shows status, files, chunks as aligned key-value pairs', () => {
    vi.mocked(listProjects).mockReturnValue({});
    const states: CodebaseState[] = [
      { path: '/test/path', collectionName: 'test_path', status: 'indexed', totalFiles: 10, totalChunks: 50, lastIndexed: '2024-01-01' },
    ];
    const output = formatListIndexed(states);
    expect(output).toContain('Status:       indexed');
    expect(output).toContain('Files:        10');
    expect(output).toContain('Chunks:       50');
  });

  it('shows progress during indexing', () => {
    vi.mocked(listProjects).mockReturnValue({});
    const states: CodebaseState[] = [
      { path: '/p', collectionName: 'p', status: 'indexing', progress: 45, progressMessage: 'Processing files...' },
    ];
    const output = formatListIndexed(states);
    expect(output).toContain('45%');
    expect(output).toContain('Processing files...');
  });

  it('shows error', () => {
    vi.mocked(listProjects).mockReturnValue({});
    const states: CodebaseState[] = [
      { path: '/p', collectionName: 'p', status: 'error', error: 'Connection refused' },
    ];
    const output = formatListIndexed(states);
    expect(output).toContain('Connection refused');
  });
});
