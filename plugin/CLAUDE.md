# Eidetic — Semantic Code Search

## Token Efficiency Rule
Use search_code for codebase exploration. Use Read only for files you already know you need.

- search_code: ~50 tokens/result (semantic snippets)
- Read: ~2000 tokens/file (full content)

## Available Tools

### Code Search
- `search_code(path, query)` — Semantic search over indexed codebase
- `index_codebase(path)` — Index a codebase directory
- `list_indexed()` — Show all indexed codebases
- `get_indexing_status(path)` — Check indexing progress
- `clear_index(path)` — Remove index for a codebase

### File Reading
- `read_file(path)` — Read file without line-number overhead (~15-20% fewer tokens for code, more for short-line files)
  - Use `offset` and `limit` to page through large files
  - Add `lineNumbers=true` when you need line references for editing

### Documentation Cache
- `index_document(content, source, library, topic)` — Cache fetched documentation for cheap search later
- `search_documents(query, library?)` — Search cached docs (~20 tokens/result vs ~5K+ per fetch)
