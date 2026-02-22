import { createRequire } from 'node:module';
import type { Splitter, CodeChunk } from './types.js';
import { extractSymbolInfo, isContainerType } from './symbol-extract.js';

// tree-sitter and language parsers are native CommonJS modules
const require = createRequire(import.meta.url);
const Parser = require('tree-sitter');

// Lazy-load language parsers to avoid startup cost for unused languages
const languageParsers: Record<string, () => unknown> = {
  javascript: () => require('tree-sitter-javascript'),
  js: () => require('tree-sitter-javascript'),
  typescript: () => require('tree-sitter-typescript').typescript,
  ts: () => require('tree-sitter-typescript').typescript,
  tsx: () => require('tree-sitter-typescript').tsx,
  python: () => require('tree-sitter-python'),
  py: () => require('tree-sitter-python'),
  go: () => require('tree-sitter-go'),
  java: () => require('tree-sitter-java'),
  rust: () => require('tree-sitter-rust'),
  rs: () => require('tree-sitter-rust'),
  cpp: () => require('tree-sitter-cpp'),
  'c++': () => require('tree-sitter-cpp'),
  c: () => require('tree-sitter-cpp'),
  csharp: () => require('tree-sitter-c-sharp'),
  cs: () => require('tree-sitter-c-sharp'),
};

// AST node types that represent logical code units per language
const SPLITTABLE_TYPES: Record<string, string[]> = {
  javascript: ['function_declaration', 'arrow_function', 'class_declaration', 'method_definition', 'export_statement'],
  typescript: ['function_declaration', 'arrow_function', 'class_declaration', 'method_definition', 'export_statement', 'interface_declaration', 'type_alias_declaration'],
  tsx: ['function_declaration', 'arrow_function', 'class_declaration', 'method_definition', 'export_statement', 'interface_declaration', 'type_alias_declaration'],
  python: ['function_definition', 'class_definition', 'decorated_definition', 'async_function_definition'],
  java: ['method_declaration', 'class_declaration', 'interface_declaration', 'constructor_declaration'],
  cpp: ['function_definition', 'class_specifier', 'namespace_definition', 'declaration'],
  go: ['function_declaration', 'method_declaration', 'type_declaration', 'var_declaration', 'const_declaration'],
  rust: ['function_item', 'impl_item', 'struct_item', 'enum_item', 'trait_item', 'mod_item'],
  csharp: ['method_declaration', 'class_declaration', 'interface_declaration', 'struct_declaration', 'enum_declaration'],
};

const LANG_CANONICAL: Record<string, string> = {
  js: 'javascript', ts: 'typescript', py: 'python',
  rs: 'rust', 'c++': 'cpp', c: 'cpp', cs: 'csharp',
};

const MAX_CHUNK_CHARS = 2500;

export class AstSplitter implements Splitter {
  private parser = new Parser();
  private currentLang = '';

  // Shared across all AstSplitter instances — one cache per process
  private static langCache = new Map<string, unknown>();

  private static resolveLanguage(lang: string): unknown | null {
    const canonical = LANG_CANONICAL[lang] ?? lang;

    const cached = AstSplitter.langCache.get(canonical);
    if (cached) return cached;

    const factory = languageParsers[canonical] ?? languageParsers[lang];
    if (!factory) return null;

    try {
      const mod = factory();
      AstSplitter.langCache.set(canonical, mod);
      return mod;
    } catch (err) {
      console.warn(`Failed to load tree-sitter parser for "${lang}": ${err}`);
      return null;
    }
  }

  split(code: string, language: string, filePath: string): CodeChunk[] {
    const lang = language.toLowerCase();
    const canonical = LANG_CANONICAL[lang] ?? lang;
    const langModule = AstSplitter.resolveLanguage(lang);

    if (!langModule) {
      return [];
    }

    try {
      if (canonical !== this.currentLang) {
        this.parser.setLanguage(langModule);
        this.currentLang = canonical;
      }
      const tree = this.parser.parse(code);

      if (!tree.rootNode) return [];

      const nodeTypes = SPLITTABLE_TYPES[canonical] ?? [];
      const rawChunks = this.extractChunks(tree.rootNode, code, nodeTypes, language, filePath);

      if (rawChunks.length === 0) return [];

      return this.refineChunks(rawChunks);
    } catch (err) {
      console.warn(`AST parse failed for "${filePath}" (${language}): ${err}`);
      return [];
    }
  }

  static isSupported(language: string): boolean {
    return language.toLowerCase() in languageParsers;
  }

  private extractChunks(
    node: { type: string; startPosition: { row: number }; endPosition: { row: number }; startIndex: number; endIndex: number; children: unknown[] },
    code: string,
    splittableTypes: string[],
    language: string,
    filePath: string,
  ): CodeChunk[] {
    const chunks: CodeChunk[] = [];

    const traverse = (current: typeof node, parentName?: string) => {
      if (splittableTypes.includes(current.type)) {
        const text = code.slice(current.startIndex, current.endIndex);
        if (text.trim().length > 0) {
          const symbolInfo = extractSymbolInfo(
            current as Parameters<typeof extractSymbolInfo>[0],
            code,
            language,
            parentName,
          );
          const chunk: CodeChunk = {
            content: text,
            startLine: current.startPosition.row + 1,
            endLine: current.endPosition.row + 1,
            language,
            filePath,
          };
          if (symbolInfo) {
            chunk.symbolName = symbolInfo.name;
            chunk.symbolKind = symbolInfo.kind;
            chunk.symbolSignature = symbolInfo.signature;
            if (parentName) chunk.parentSymbol = parentName;
          }
          chunks.push(chunk);

          // If this is a container, pass its name as parentName to children
          if (isContainerType(current.type) && symbolInfo?.name) {
            for (const child of current.children as typeof node[]) {
              traverse(child, symbolInfo.name);
            }
            return;
          }
        }
      }
      for (const child of current.children as typeof node[]) {
        traverse(child, parentName);
      }
    };

    traverse(node);
    return chunks;
  }

  private refineChunks(chunks: CodeChunk[]): CodeChunk[] {
    const result: CodeChunk[] = [];
    for (const chunk of chunks) {
      if (chunk.content.length <= MAX_CHUNK_CHARS) {
        result.push(chunk);
      } else {
        result.push(...this.splitLargeChunk(chunk));
      }
    }
    return result;
  }

  private splitLargeChunk(chunk: CodeChunk): CodeChunk[] {
    const lines = chunk.content.split('\n');
    const subChunks: CodeChunk[] = [];
    let current = '';
    let startLine = chunk.startLine;
    let lineCount = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const addition = i < lines.length - 1 ? line + '\n' : line;

      if (current.length + addition.length > MAX_CHUNK_CHARS && current.length > 0) {
        subChunks.push({
          content: current,
          startLine,
          endLine: startLine + lineCount - 1,
          language: chunk.language,
          filePath: chunk.filePath,
        });
        current = addition;
        startLine = chunk.startLine + i;
        lineCount = 1;
      } else {
        current += addition;
        lineCount++;
      }
    }

    if (current.trim().length > 0) {
      subChunks.push({
        content: current,
        startLine,
        endLine: startLine + lineCount - 1,
        language: chunk.language,
        filePath: chunk.filePath,
      });
    }

    return subChunks;
  }
}
