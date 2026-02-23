import { describe, it, expect, beforeEach } from 'vitest';
import { TOOL_DEFINITIONS } from '../tool-schemas.js';
import { extractSymbolInfo, isContainerType } from '../splitter/symbol-extract.js';
import {
  generateRepoMap,
  listSymbolsTable,
  matchesPathFilter,
  VectorDBSymbolSource,
} from '../core/repo-map.js';
import { MockVectorDB } from './mock-vectordb.js';
import type { SymbolEntry } from '../vectordb/types.js';

// ── extractSymbolInfo ────────────────────────────────────────────────────────

describe('extractSymbolInfo', () => {
  function makeNode(type: string, text: string, children: object[] = []) {
    return {
      type,
      startIndex: 0,
      endIndex: text.length,
      children: children as any[],
      text,
    };
  }

  function makeIdent(name: string, offset = 0) {
    return {
      type: 'identifier',
      startIndex: offset,
      endIndex: offset + name.length,
      children: [],
      text: name,
    };
  }

  const code = 'function greet(name: string): string { return name; }';

  it('extracts a function_declaration', () => {
    const ident = makeIdent('greet', 9);
    const node = { ...makeNode('function_declaration', code), children: [ident] };
    const result = extractSymbolInfo(node as any, code);
    expect(result).toBeTruthy();
    expect(result!.name).toBe('greet');
    expect(result!.kind).toBe('function');
    expect(result!.signature).toContain('function greet');
  });

  it('extracts a class_declaration', () => {
    const classCode = 'class Calculator { add() {} }';
    const ident = makeIdent('Calculator', 6);
    const node = { ...makeNode('class_declaration', classCode), children: [ident] };
    const result = extractSymbolInfo(node as any, classCode);
    expect(result).toBeTruthy();
    expect(result!.name).toBe('Calculator');
    expect(result!.kind).toBe('class');
  });

  it('extracts an interface_declaration', () => {
    const code = 'interface Config { apiKey: string; }';
    const ident = makeIdent('Config', 10);
    const node = { ...makeNode('interface_declaration', code), children: [ident] };
    const result = extractSymbolInfo(node as any, code);
    expect(result!.kind).toBe('interface');
    expect(result!.name).toBe('Config');
  });

  it('extracts a method_definition with parentName', () => {
    const methodCode = 'add(a: number, b: number): number { return a + b; }';
    const ident = makeIdent('add', 0);
    const node = { ...makeNode('method_definition', methodCode), children: [ident] };
    const result = extractSymbolInfo(node as any, methodCode, 'Calculator');
    expect(result!.kind).toBe('method');
    expect(result!.name).toBe('add');
  });

  it('recurses into export_statement', () => {
    const exportCode = 'export function greet() {}';
    const ident = makeIdent('greet', 16);
    const funcNode = { type: 'function_declaration', startIndex: 7, endIndex: exportCode.length, children: [ident] };
    const exportNode = { type: 'export_statement', startIndex: 0, endIndex: exportCode.length, children: [funcNode] };
    const result = extractSymbolInfo(exportNode as any, exportCode);
    expect(result).toBeTruthy();
    expect(result!.name).toBe('greet');
    expect(result!.kind).toBe('function');
  });

  it('returns undefined for unknown node type', () => {
    const node = makeNode('unknown_node', 'something');
    expect(extractSymbolInfo(node as any, 'something')).toBeUndefined();
  });

  it('returns undefined when no identifier found', () => {
    const node = makeNode('function_declaration', code);
    expect(extractSymbolInfo(node as any, code)).toBeUndefined();
  });

  it('truncates long signatures', () => {
    const longSig = 'function ' + 'a'.repeat(300) + '() {}';
    const ident = makeIdent('a'.repeat(300), 9);
    const node = { ...makeNode('function_declaration', longSig), children: [ident] };
    const result = extractSymbolInfo(node as any, longSig);
    expect(result!.signature.length).toBeLessThanOrEqual(201); // 200 + '…'
  });
});

describe('isContainerType', () => {
  it('returns true for class_declaration', () => {
    expect(isContainerType('class_declaration')).toBe(true);
  });

  it('returns true for interface_declaration', () => {
    expect(isContainerType('interface_declaration')).toBe(true);
  });

  it('returns false for function_declaration', () => {
    expect(isContainerType('function_declaration')).toBe(false);
  });
});

// ── matchesPathFilter ────────────────────────────────────────────────────────

describe('matchesPathFilter', () => {
  it('matches exact path', () => {
    expect(matchesPathFilter('src/foo.ts', 'src/foo.ts')).toBe(true);
  });

  it('matches with * wildcard', () => {
    expect(matchesPathFilter('src/foo.ts', 'src/*.ts')).toBe(true);
    expect(matchesPathFilter('src/bar/foo.ts', 'src/*.ts')).toBe(false);
  });

  it('matches with ** wildcard', () => {
    expect(matchesPathFilter('src/bar/foo.ts', 'src/**/*.ts')).toBe(true);
    expect(matchesPathFilter('other/foo.ts', 'src/**')).toBe(false);
  });

  it('does not match wrong extension', () => {
    expect(matchesPathFilter('src/foo.js', 'src/*.ts')).toBe(false);
  });
});

// ── generateRepoMap ──────────────────────────────────────────────────────────

function makeDoc(overrides: Partial<import('../vectordb/types.js').CodeDocument>): import('../vectordb/types.js').CodeDocument {
  return {
    id: Math.random().toString(36).slice(2),
    content: 'code here',
    vector: [0.1],
    relativePath: 'src/foo.ts',
    startLine: 1,
    endLine: 10,
    fileExtension: '.ts',
    language: 'typescript',
    ...overrides,
  };
}

describe('generateRepoMap', () => {
  let db: MockVectorDB;
  const path = '/project';
  const coll = 'project__'; // simplified — just need listSymbols to work

  beforeEach(() => {
    db = new MockVectorDB();
  });

  async function setupCollection(symbols: SymbolEntry[]) {
    const collName = Object.keys(Object.fromEntries(db.collections))[0] ?? 'col';
    // We bypass the collection name logic by directly inserting docs with symbol fields
    // Use the actual pathToCollectionName logic
    const { pathToCollectionName } = await import('../paths.js');
    const name = pathToCollectionName('/project');
    await db.createCollection(name, 2);
    for (const sym of symbols) {
      await db.insert(name, [makeDoc({
        relativePath: sym.relativePath,
        startLine: sym.startLine,
        symbolName: sym.name,
        symbolKind: sym.kind,
        symbolSignature: sym.signature,
        parentSymbol: sym.parentName,
      })]);
    }
    return name;
  }

  it('returns empty message when no symbols', async () => {
    const { pathToCollectionName } = await import('../paths.js');
    const name = pathToCollectionName('/project');
    await db.createCollection(name, 2);
    const source = new VectorDBSymbolSource(db);
    const result = await generateRepoMap('/project', source);
    expect(result).toContain('no symbols found');
  });

  it('groups symbols by file', async () => {
    await setupCollection([
      { name: 'greet', kind: 'function', relativePath: 'src/foo.ts', startLine: 1 },
      { name: 'MyClass', kind: 'class', relativePath: 'src/bar.ts', startLine: 5 },
    ]);
    const source = new VectorDBSymbolSource(db);
    const result = await generateRepoMap('/project', source);
    expect(result).toContain('src/foo.ts:');
    expect(result).toContain('src/bar.ts:');
    expect(result).toContain('[function]');
    expect(result).toContain('[class]');
  });

  it('nests methods under parent class', async () => {
    await setupCollection([
      { name: 'Calculator', kind: 'class', relativePath: 'src/calc.ts', startLine: 1 },
      { name: 'add', kind: 'method', relativePath: 'src/calc.ts', startLine: 3, parentName: 'Calculator' },
    ]);
    const source = new VectorDBSymbolSource(db);
    const result = await generateRepoMap('/project', source);
    const lines = result.split('\n');
    const classLine = lines.findIndex(l => l.includes('[class]') && l.includes('Calculator'));
    const methodLine = lines.findIndex(l => l.includes('[method]') && l.includes('add'));
    expect(classLine).toBeLessThan(methodLine);
    // Method should be more indented
    expect(lines[methodLine].startsWith('    ')).toBe(true);
  });

  it('applies pathFilter', async () => {
    await setupCollection([
      { name: 'greet', kind: 'function', relativePath: 'src/foo.ts', startLine: 1 },
      { name: 'other', kind: 'function', relativePath: 'lib/bar.ts', startLine: 1 },
    ]);
    const source = new VectorDBSymbolSource(db);
    const result = await generateRepoMap('/project', source, { pathFilter: 'src/**' });
    expect(result).toContain('src/foo.ts');
    expect(result).not.toContain('lib/bar.ts');
  });

  it('applies kindFilter', async () => {
    await setupCollection([
      { name: 'greet', kind: 'function', relativePath: 'src/foo.ts', startLine: 1 },
      { name: 'MyClass', kind: 'class', relativePath: 'src/foo.ts', startLine: 5 },
    ]);
    const source = new VectorDBSymbolSource(db);
    const result = await generateRepoMap('/project', source, { kindFilter: 'class' });
    expect(result).toContain('[class]');
    expect(result).not.toContain('[function]');
  });

  it('deduplicates symbols, preferring those with signatures', async () => {
    const { pathToCollectionName } = await import('../paths.js');
    const name = pathToCollectionName('/project');
    await db.createCollection(name, 2);
    // Two docs for same symbol - one with signature, one without
    await db.insert(name, [
      makeDoc({ relativePath: 'src/foo.ts', startLine: 1, symbolName: 'greet', symbolKind: 'function' }),
      makeDoc({ relativePath: 'src/foo.ts', startLine: 1, symbolName: 'greet', symbolKind: 'function', symbolSignature: 'function greet()' }),
    ]);
    const source = new VectorDBSymbolSource(db);
    const result = await generateRepoMap('/project', source);
    const matches = result.match(/\[function\]/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it('truncates output at maxTokens', async () => {
    const symbols: SymbolEntry[] = Array.from({ length: 100 }, (_, i) => ({
      name: `func${i}`,
      kind: 'function',
      relativePath: `src/file${i}.ts`,
      startLine: 1,
    }));
    await setupCollection(symbols);
    const source = new VectorDBSymbolSource(db);
    const result = await generateRepoMap('/project', source, { maxTokens: 50 });
    expect(result).toContain('(truncated)');
  });
});

// ── listSymbolsTable ─────────────────────────────────────────────────────────

describe('listSymbolsTable', () => {
  let db: MockVectorDB;

  beforeEach(() => {
    db = new MockVectorDB();
  });

  async function setup(symbols: SymbolEntry[]) {
    const { pathToCollectionName } = await import('../paths.js');
    const name = pathToCollectionName('/project');
    await db.createCollection(name, 2);
    for (const sym of symbols) {
      await db.insert(name, [makeDoc({
        relativePath: sym.relativePath,
        startLine: sym.startLine,
        symbolName: sym.name,
        symbolKind: sym.kind,
        symbolSignature: sym.signature,
        parentSymbol: sym.parentName,
      })]);
    }
  }

  it('returns empty message when no symbols', async () => {
    const { pathToCollectionName } = await import('../paths.js');
    const name = pathToCollectionName('/project');
    await db.createCollection(name, 2);
    const source = new VectorDBSymbolSource(db);
    const result = await listSymbolsTable('/project', source);
    expect(result).toContain('no symbols found');
  });

  it('formats as Name|Kind|Location table', async () => {
    await setup([
      { name: 'greet', kind: 'function', relativePath: 'src/foo.ts', startLine: 5 },
    ]);
    const source = new VectorDBSymbolSource(db);
    const result = await listSymbolsTable('/project', source);
    expect(result).toContain('Name | Kind | Location');
    expect(result).toContain('greet | function | src/foo.ts:5');
  });

  it('applies kind filter', async () => {
    await setup([
      { name: 'greet', kind: 'function', relativePath: 'src/foo.ts', startLine: 1 },
      { name: 'MyClass', kind: 'class', relativePath: 'src/foo.ts', startLine: 10 },
    ]);
    const source = new VectorDBSymbolSource(db);
    const result = await listSymbolsTable('/project', source, { kindFilter: 'class' });
    expect(result).toContain('MyClass');
    expect(result).not.toContain('greet');
  });

  it('applies nameFilter', async () => {
    await setup([
      { name: 'handleFoo', kind: 'function', relativePath: 'src/foo.ts', startLine: 1 },
      { name: 'handleBar', kind: 'function', relativePath: 'src/foo.ts', startLine: 5 },
      { name: 'calculate', kind: 'function', relativePath: 'src/foo.ts', startLine: 10 },
    ]);
    const source = new VectorDBSymbolSource(db);
    const result = await listSymbolsTable('/project', source, { nameFilter: 'handle' });
    expect(result).toContain('handleFoo');
    expect(result).toContain('handleBar');
    expect(result).not.toContain('calculate');
  });
});

// ── VectorDBSymbolSource ─────────────────────────────────────────────────────

describe('VectorDBSymbolSource', () => {
  let db: MockVectorDB;

  beforeEach(async () => {
    db = new MockVectorDB();
    const { pathToCollectionName } = await import('../paths.js');
    const name = pathToCollectionName('/project');
    await db.createCollection(name, 2);
    await db.insert(name, [
      makeDoc({ relativePath: 'src/a.ts', startLine: 1, symbolName: 'alpha', symbolKind: 'function' }),
      makeDoc({ relativePath: 'src/b.ts', startLine: 2, symbolName: 'Beta', symbolKind: 'class' }),
      makeDoc({ relativePath: 'lib/c.ts', startLine: 3, symbolName: 'gamma', symbolKind: 'function' }),
      makeDoc({ relativePath: 'src/a.ts', startLine: 5, symbolName: '', symbolKind: '' }),
    ]);
  });

  it('delegates to MockVectorDB.listSymbols', async () => {
    const { pathToCollectionName } = await import('../paths.js');
    const name = pathToCollectionName('/project');
    const source = new VectorDBSymbolSource(db);
    const syms = await source.getSymbols(name);
    expect(syms.length).toBe(3); // excludes empty symbolName doc
  });

  it('applies pathFilter', async () => {
    const { pathToCollectionName } = await import('../paths.js');
    const name = pathToCollectionName('/project');
    const source = new VectorDBSymbolSource(db);
    const syms = await source.getSymbols(name, { pathFilter: 'src/**' });
    expect(syms.every(s => s.relativePath.startsWith('src/'))).toBe(true);
  });

  it('applies kindFilter', async () => {
    const { pathToCollectionName } = await import('../paths.js');
    const name = pathToCollectionName('/project');
    const source = new VectorDBSymbolSource(db);
    const syms = await source.getSymbols(name, { kindFilter: 'class' });
    expect(syms.every(s => s.kind === 'class')).toBe(true);
    expect(syms.length).toBeGreaterThan(0);
  });
});

// ── tool schemas ─────────────────────────────────────────────────────────────

describe('tool schemas', () => {
  it('browse_structure uses "kind" not "kindFilter"', () => {
    const schema = TOOL_DEFINITIONS.find(t => t.name === 'browse_structure');
    const props = schema?.inputSchema.properties as Record<string, unknown> | undefined;
    expect(props).toHaveProperty('kind');
    expect(props).not.toHaveProperty('kindFilter');
  });
});
