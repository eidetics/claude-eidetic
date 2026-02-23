# Eidetic — Semantic Code Search

## When to Use What
| Need | Use | Not |
|------|-----|-----|
| Understand codebase architecture | `browse_structure()` | Glob + Read cascade |
| Find implementations/patterns | `search_code(query)` | Grep with regex guessing |
| Read a specific known file | `read_file(path)` | Read (blocked by hook) |
| Exact string/regex match | Grep | — |
| Find file by exact name | Glob | — |

search_code: ~20 tokens/result. Grep: ~100+ tokens/result. Read: ~2000 tokens/file.

## Available Tools

### Code Search
- `search_code(path, query)` — Semantic search over indexed codebase
- `browse_structure(path)` — Architecture map: classes, functions, methods grouped by file
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
