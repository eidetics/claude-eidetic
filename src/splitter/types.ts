export interface CodeChunk {
  content: string;
  startLine: number;
  endLine: number;
  language: string;
  filePath: string;
}

export interface Splitter {
  split(code: string, language: string, filePath: string): CodeChunk[];
}
