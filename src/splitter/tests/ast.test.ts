import { describe, it, expect } from 'vitest';
import { AstSplitter } from '../ast.js';

describe('AstSplitter', () => {
  const splitter = new AstSplitter();

  describe('isSupported', () => {
    it('supports typescript', () => {
      expect(AstSplitter.isSupported('typescript')).toBe(true);
      expect(AstSplitter.isSupported('ts')).toBe(true);
    });

    it('supports javascript', () => {
      expect(AstSplitter.isSupported('javascript')).toBe(true);
      expect(AstSplitter.isSupported('js')).toBe(true);
    });

    it('supports python', () => {
      expect(AstSplitter.isSupported('python')).toBe(true);
      expect(AstSplitter.isSupported('py')).toBe(true);
    });

    it('supports go, java, rust, cpp, csharp', () => {
      expect(AstSplitter.isSupported('go')).toBe(true);
      expect(AstSplitter.isSupported('java')).toBe(true);
      expect(AstSplitter.isSupported('rust')).toBe(true);
      expect(AstSplitter.isSupported('cpp')).toBe(true);
      expect(AstSplitter.isSupported('csharp')).toBe(true);
    });

    it('returns false for unsupported languages', () => {
      expect(AstSplitter.isSupported('haskell')).toBe(false);
      expect(AstSplitter.isSupported('unknown')).toBe(false);
    });
  });

  describe('split TypeScript', () => {
    it('extracts function and class chunks', () => {
      const code = `
function greet(name: string): string {
  return \`Hello, \${name}!\`;
}

class Calculator {
  add(a: number, b: number): number {
    return a + b;
  }
}

interface Config {
  host: string;
  port: number;
}
`.trimStart();

      const chunks = splitter.split(code, 'typescript', 'test.ts');
      expect(chunks.length).toBeGreaterThanOrEqual(2);

      // Should find function_declaration and class_declaration
      const contents = chunks.map(c => c.content);
      expect(contents.some(c => c.includes('greet'))).toBe(true);
      expect(contents.some(c => c.includes('Calculator'))).toBe(true);
    });

    it('preserves metadata', () => {
      const code = `export function hello() { return 1; }`;
      const chunks = splitter.split(code, 'typescript', 'src/hello.ts');
      expect(chunks.length).toBeGreaterThanOrEqual(1);
      expect(chunks[0].filePath).toBe('src/hello.ts');
      expect(chunks[0].language).toBe('typescript');
      expect(chunks[0].startLine).toBeGreaterThanOrEqual(1);
    });
  });

  describe('split Python', () => {
    it('extracts function and class definitions', () => {
      const code = `
def greet(name):
    return f"Hello, {name}!"

class Calculator:
    def add(self, a, b):
        return a + b
`.trimStart();

      const chunks = splitter.split(code, 'python', 'test.py');
      expect(chunks.length).toBeGreaterThanOrEqual(2);
      const contents = chunks.map(c => c.content);
      expect(contents.some(c => c.includes('greet'))).toBe(true);
      expect(contents.some(c => c.includes('Calculator'))).toBe(true);
    });
  });

  describe('split JavaScript', () => {
    it('extracts functions and classes', () => {
      const code = `
function add(a, b) {
  return a + b;
}

class Foo {
  bar() { return 1; }
}
`.trimStart();

      const chunks = splitter.split(code, 'javascript', 'test.js');
      expect(chunks.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('edge cases', () => {
    it('returns empty array for unsupported language', () => {
      const chunks = splitter.split('some code', 'haskell', 'test.hs');
      expect(chunks).toEqual([]);
    });

    it('returns empty array for empty input', () => {
      const chunks = splitter.split('', 'typescript', 'empty.ts');
      expect(chunks).toEqual([]);
    });

    it('sub-chunks large functions', () => {
      // Create a function with many lines
      const lines = Array.from({ length: 200 }, (_, i) => `  const x${i} = ${i};`);
      const code = `function bigFn() {\n${lines.join('\n')}\n}`;
      const chunks = splitter.split(code, 'javascript', 'big.js');

      // Should produce multiple sub-chunks from the single large function
      expect(chunks.length).toBeGreaterThan(1);
      for (const chunk of chunks) {
        expect(chunk.filePath).toBe('big.js');
        expect(chunk.language).toBe('javascript');
      }
    });
  });
});
