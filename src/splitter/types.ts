export const MAX_CHUNK_CHARS = 2500;

export interface CodeChunk {
  content: string;
  startLine: number;
  endLine: number;
  language: string;
  filePath: string;
  symbolName?: string;
  symbolKind?: string;
  symbolSignature?: string;
  parentSymbol?: string;
}

export interface Splitter {
  split(code: string, language: string, filePath: string): CodeChunk[];
}
