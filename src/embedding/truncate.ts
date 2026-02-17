// Safety margin below 8,191 token limit (~4 chars/token for code)
const MAX_EMBED_CHARS = 6000;

/**
 * Truncate text to stay within the embedding model's token limit.
 * Cuts at the last newline boundary to avoid splitting mid-line.
 */
export function truncateToSafeLength(text: string): string {
  if (text.length <= MAX_EMBED_CHARS) return text;

  const truncated = text.slice(0, MAX_EMBED_CHARS);
  const lastNewline = truncated.lastIndexOf('\n');
  return lastNewline > 0 ? truncated.slice(0, lastNewline) : truncated;
}
