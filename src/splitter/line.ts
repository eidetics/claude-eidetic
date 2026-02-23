import type { Splitter, CodeChunk } from './types.js';
import { MAX_CHUNK_CHARS } from './types.js';

const DEFAULT_CHUNK_LINES = 60;
const OVERLAP_LINES = 5;

export class LineSplitter implements Splitter {
  private chunkLines: number;
  private overlapLines: number;

  constructor(chunkLines = DEFAULT_CHUNK_LINES, overlapLines = OVERLAP_LINES) {
    this.chunkLines = chunkLines;
    this.overlapLines = Math.min(overlapLines, chunkLines - 1);
  }

  split(code: string, language: string, filePath: string): CodeChunk[] {
    const lines = code.split('\n');
    if (lines.length === 0) return [];

    const raw: CodeChunk[] = [];
    let start = 0;

    while (start < lines.length) {
      const end = Math.min(start + this.chunkLines, lines.length);
      const content = lines.slice(start, end).join('\n');

      if (content.trim().length > 0) {
        raw.push({
          content,
          startLine: start + 1,
          endLine: end,
          language,
          filePath,
        });
      }

      start = Math.max(start + 1, end - this.overlapLines);
    }

    return this.refineChunks(raw);
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

    const flush = () => {
      if (current.trim().length > 0) {
        subChunks.push({
          content: current,
          startLine,
          endLine: startLine + lineCount - 1,
          language: chunk.language,
          filePath: chunk.filePath,
        });
      }
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const addition = i < lines.length - 1 ? line + '\n' : line;

      if (current.length + addition.length > MAX_CHUNK_CHARS && current.length > 0) {
        flush();
        current = '';
        startLine = chunk.startLine + i;
        lineCount = 0;
      }

      if (addition.length > MAX_CHUNK_CHARS) {
        if (current.length > 0) {
          flush();
          current = '';
          startLine = chunk.startLine + i;
          lineCount = 0;
        }
        const lineNum = chunk.startLine + i;
        for (let offset = 0; offset < addition.length; offset += MAX_CHUNK_CHARS) {
          const slice = addition.slice(offset, offset + MAX_CHUNK_CHARS);
          if (slice.trim().length > 0) {
            subChunks.push({
              content: slice,
              startLine: lineNum,
              endLine: lineNum,
              language: chunk.language,
              filePath: chunk.filePath,
            });
          }
        }
        startLine = chunk.startLine + i + 1;
        lineCount = 0;
      } else {
        current += addition;
        lineCount++;
      }
    }

    flush();
    return subChunks;
  }
}
