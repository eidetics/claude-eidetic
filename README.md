# Eidetic

[![Node.js >=20](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org) [![npm](https://img.shields.io/npm/v/claude-eidetic)](https://www.npmjs.com/package/claude-eidetic) [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Semantic code search and documentation caching for Claude Code. Index your codebase once, then search by meaning — not just keywords — with compact, token-efficient results.

## Get started

> **Note:** An `OPENAI_API_KEY` is required for the default embedding provider. Alternatively, use [Ollama](#embedding-providers) for free local embeddings.

**As a Claude Code plugin (recommended):**

```shell
claude plugin add /path/to/eidetic/plugin
```

The plugin auto-starts the MCP server, registers skills and hooks, and configures everything. No manual setup needed.

**As a standalone MCP server:**

```shell
npm install -g claude-eidetic
export OPENAI_API_KEY="sk-..."
claude-eidetic
```

**First use:**

```
index_codebase(path="/your/project")   # Index once (~30s for a typical project)
search_code(query="auth middleware")    # Search by meaning
```

Qdrant (the vector database) is auto-provisioned via Docker if not already running. Zero configuration required.

## What it does

Eidetic is an MCP server that indexes codebases into a vector database and provides hybrid semantic search. It combines dense vector similarity with full-text keyword matching, fused via Reciprocal Rank Fusion (RRF), then deduplicates overlapping chunks. Results are compact — roughly 50 tokens per result in default mode.

```
scan files → split (AST or line-based) → embed → store in vector DB
                                                        ↓
              deduplicate ← RRF fusion ← hybrid search (dense + full-text)
                   ↓
            compact results (~50 tokens each)
```

Indexing is incremental. On re-index, only added or modified files are re-embedded, using content-hash snapshots to detect changes.

## MCP tools

Eidetic exposes 8 MCP tools.

### Code search

**`index_codebase`** — Index a directory for semantic search.

| Parameter | Type | Description |
|-----------|------|-------------|
| `path` | string | Absolute path to index |
| `project` | string | Project name (resolves via registry) |
| `force` | boolean | Force full re-index (default: false) |
| `dryRun` | boolean | Preview files, cost estimate, warnings (default: false) |
| `customExtensions` | string[] | Extra file extensions to include (e.g., `[".dart"]`) |
| `customIgnorePatterns` | string[] | Extra glob patterns to exclude |

Incremental by default — only changed files are re-embedded. Use `dryRun` first to preview what would be indexed and get a cost estimate.

**`search_code`** — Hybrid semantic search over an indexed codebase.

| Parameter | Type | Description |
|-----------|------|-------------|
| `path` | string | Absolute path to search |
| `project` | string | Project name (resolves via registry) |
| `query` | string | Natural language query (required) |
| `limit` | number | Max results, up to 50 (default: 10) |
| `extensionFilter` | string[] | Filter by file extension (e.g., `[".ts"]`) |
| `compact` | boolean | Compact table output (default: true) |

Default compact mode returns a table of file, lines, score, and token estimate. Use the `Read` tool to fetch full content for interesting results.

**`get_indexing_status`** — Poll indexing progress with live percentage.

**`list_indexed`** — List all tracked codebases with status, file counts, and chunk counts.

**`clear_index`** — Delete a codebase's index and snapshot.

### Documentation cache

**`index_document`** — Cache external documentation for cheap search later.

| Parameter | Type | Description |
|-----------|------|-------------|
| `content` | string | Full text content to cache (required) |
| `source` | string | Source URL or identifier (required) |
| `library` | string | Library name for grouping (required) |
| `topic` | string | Topic within the library (required) |
| `ttlDays` | number | Days before content is considered stale (default: 7) |

**`search_documents`** — Search cached documentation.

| Parameter | Type | Description |
|-----------|------|-------------|
| `query` | string | Natural language query (required) |
| `library` | string | Limit to a specific library (optional — omit to search all) |
| `limit` | number | Max results, up to 20 (default: 5) |

### Reference

**`__IMPORTANT`** — Workflow guidance card with best practices for efficient search.

## Documentation caching

Fetching library documentation costs roughly 5,000+ tokens each time. Repeated lookups for the same library waste tokens on identical content.

Eidetic solves this by caching documentation once and serving results at approximately 20 tokens per result.

**Workflow:**

```
# 1. Fetch docs from any source (context7, WebFetch, etc.)
# 2. Cache them
index_document(
  content="<fetched docs>",
  source="context7:react/hooks",
  library="react",
  topic="hooks"
)

# 3. Search cheaply (~20 tokens/result vs ~5K+ tokens/fetch)
search_documents(query="useEffect cleanup", library="react")

# 4. Search across ALL cached libraries
search_documents(query="auth token handling")
```

**Key features:**

- **Per-library collections** — Each library gets its own collection (`doc_react`, `doc_langfuse`), searchable individually or together
- **TTL-based freshness** — Default 7 days. Stale docs still return results but are flagged `[STALE]`
- **Cross-library search** — Omit `library` to search across all cached documentation
- **Upsert on refresh** — Re-caching the same source replaces old chunks automatically
- **Automated workflow** — The `/eidetic:cache-docs` skill handles resolve, fetch, cache, and verify in one command

## Session persistence

Claude Code sessions are ephemeral. Decisions, context, and progress are lost between sessions.

Eidetic provides two skills that persist and recover session context using semantically searchable notes.

**`/wrapup` — end of session:**

Extracts key facts from the conversation and writes a structured note to `~/.eidetic/notes/<project>/`:

- Decisions made (with rationale and rejected alternatives)
- File changes (exact paths and descriptions)
- Numbers and metrics
- Open questions (marked `OPEN` or `ASSUMED`)
- Next actions and blockers

The notes directory is then incrementally indexed for semantic search.

**`/catchup` — start of next session:**

Searches saved notes semantically, reads the most recent files, and presents a compact summary:

```
## Catchup: my-project

**Last session:** 2026-02-18
**Status:** Implemented auth middleware

**Key context:**
- JWT over sessions (rationale: stateless API)
- Rate limiting strategy still OPEN
- Next: add refresh tokens

**Open items:** 2 | **Recent notes:** 3 files covering Feb 15-18
```

**Key features:**

- **Semantic recovery** — Search notes by meaning, not filename
- **Project-scoped** — Notes are organized per project under `~/.eidetic/notes/`
- **Incremental indexing** — Re-indexing notes after `/wrapup` is near-instant
- **Structured template** — Consistent format ensures reliable retrieval
- **Filesystem fallback** — If Eidetic is unavailable, `/catchup` falls back to reading recent files directly

## Claude Code plugin

The `plugin/` directory provides a full Claude Code plugin with skills, hooks, and auto-start configuration.

### Skills

| Skill | Description |
|-------|-------------|
| `/catchup` | Recover session context from previous notes |
| `/wrapup` | Persist session state to searchable notes |
| `/eidetic:search <query>` | Semantic code search |
| `/eidetic:index [path]` | Index a codebase |
| `/eidetic:cache-docs <library> [topic]` | Fetch, cache, and verify library documentation |

### Hooks

| Event | Trigger | Behavior |
|-------|---------|----------|
| `SessionStart` | Every session | Validates `OPENAI_API_KEY`, shows setup instructions if missing |
| `PreToolUse` | `Grep` or `Read` calls | Advisory nudge to use `search_code` instead for exploration |

Hooks are advisory — they add context messages but never block tool execution.

### Auto-start

The plugin's `.mcp.json` starts the MCP server automatically with each Claude Code session. The server passes through `OPENAI_API_KEY` from the environment.

## Supported languages

### AST-aware splitting (tree-sitter)

Splits code into semantic chunks: functions, classes, methods, interfaces, type declarations.

| Language | Extensions |
|----------|-----------|
| JavaScript | `.js`, `.jsx`, `.mjs`, `.cjs` |
| TypeScript | `.ts`, `.tsx` |
| Python | `.py`, `.pyi` |
| Go | `.go` |
| Java | `.java` |
| Rust | `.rs` |
| C/C++ | `.c`, `.h`, `.cpp`, `.cc`, `.cxx`, `.hpp` |
| C# | `.cs` |

### Line-based fallback

All other supported extensions use line-based splitting (60 lines per chunk, 5 lines overlap). This covers 50+ additional file types:

Scala, Ruby, PHP, Swift, Kotlin, Lua, Shell/Bash, SQL, R, Objective-C, Dart, Elixir, Erlang, Haskell, OCaml, Vue, Svelte, Astro, YAML, TOML, JSON, Markdown, HTML, CSS, SCSS, Less, and more.

Custom extensions can be added per-index with the `customExtensions` parameter or globally with the `CUSTOM_EXTENSIONS` environment variable.

## Embedding providers

| Provider | Config | Default Model | API Key | Cost |
|----------|--------|---------------|---------|------|
| OpenAI | `EMBEDDING_PROVIDER=openai` | `text-embedding-3-small` | `OPENAI_API_KEY` (required) | ~$0.02/M tokens |
| Ollama | `EMBEDDING_PROVIDER=ollama` | `nomic-embed-text` | None | Free (local) |
| Local | `EMBEDDING_PROVIDER=local` | Configurable | Optional | Free (local) |

The local provider works with any OpenAI-compatible embedding endpoint (LM Studio, vLLM, LocalAI). Set `OPENAI_BASE_URL` to point at your server.

## Vector databases

### Qdrant (default)

Auto-provisioned via Docker if not running at `localhost:6333`. Zero configuration required.

- **Hybrid search:** Dense vectors (cosine) + full-text (term frequency), fused with client-side RRF (k=60, alpha=0.7)
- **Qdrant Cloud:** Set `QDRANT_URL` and `QDRANT_API_KEY` for hosted instances

### Milvus (optional)

Set `VECTORDB_PROVIDER=milvus` to use Milvus instead.

- **Server-side RRF** with BM25 sparse vectors (Milvus >= 2.4)
- Falls back to dense-only search on older versions
- Requires manual install: `npm install @zilliz/milvus2-sdk-node`
- **Zilliz Cloud:** Set `MILVUS_ADDRESS` and `MILVUS_TOKEN`

## Configuration

All configuration is via environment variables. No config files.

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENAI_API_KEY` | -- | Required for OpenAI embedding provider |
| `EMBEDDING_PROVIDER` | `openai` | `openai`, `ollama`, or `local` |
| `EMBEDDING_MODEL` | Per provider | Override embedding model name |
| `OPENAI_BASE_URL` | -- | Custom OpenAI-compatible endpoint |
| `OLLAMA_BASE_URL` | `http://localhost:11434/v1` | Ollama API endpoint |
| `EMBEDDING_BATCH_SIZE` | `100` | Texts per embedding API call (1-2048) |
| `INDEXING_CONCURRENCY` | `8` | Parallel file processing workers (1-32) |
| `VECTORDB_PROVIDER` | `qdrant` | `qdrant` or `milvus` |
| `QDRANT_URL` | `http://localhost:6333` | Qdrant endpoint |
| `QDRANT_API_KEY` | -- | For Qdrant Cloud authentication |
| `MILVUS_ADDRESS` | `localhost:19530` | Milvus gRPC address |
| `MILVUS_TOKEN` | -- | For Zilliz Cloud authentication |
| `EIDETIC_DATA_DIR` | `~/.eidetic` | Root directory for all Eidetic data |
| `CUSTOM_EXTENSIONS` | `[]` | JSON array of additional file extensions |
| `CUSTOM_IGNORE_PATTERNS` | `[]` | JSON array of additional ignore globs |

## Architecture

**Pluggable interfaces:** Three boundaries define the system — `Embedding` (embed text to vectors), `VectorDB` (store and search), `Splitter` (split code into chunks). Each has a primary implementation and at least one alternative.

**Embedding cache:** Two-layer cache reduces API calls. An in-memory LRU cache (10K entries) sits in front of a disk-based cache at `~/.eidetic/cache/`. Content is hashed (SHA-256) for deduplication.

**Incremental indexing:** Content-hash snapshots in `~/.eidetic/snapshots/` track what has been indexed. On re-index, only files with changed hashes are re-embedded.

**Concurrency safety:** A per-path mutex prevents concurrent indexing of the same codebase.

**Graceful degradation:** If initialization fails (missing API key, Qdrant unavailable), the server starts in setup-required mode. All tool calls return actionable setup instructions instead of crashing.

**Data directory layout:**

```
~/.eidetic/
  snapshots/          # File-hash snapshots for incremental indexing
  cache/              # Embedding cache (disk layer)
  qdrant-data/        # Qdrant persistent storage (if auto-provisioned)
  notes/              # Session notes per project (/wrapup, /catchup)
  registry.json       # Project name -> path mapping
  doc-metadata.json   # Documentation cache metadata and TTL tracking
```

## Development

```bash
npm install            # Install dependencies (tree-sitter has native bindings)
npx tsc                # Build to dist/
npm run dev            # Watch mode (tsx)
npm start              # Run MCP server on stdio
npm run typecheck      # Type-check only, no emit
```

**Testing:**

```bash
npm test               # Unit tests (vitest, mocked — no external services)
npm run test:watch     # Watch mode
npm run test:coverage  # With coverage
npm run test:integration  # Requires running Qdrant + OPENAI_API_KEY
npm run test:all       # Unit + integration
npm run test:audit     # Custom code quality audits
```

Run a single test file: `npx vitest run src/core/tests/searcher.test.ts`

**Commits:** Conventional format — `type(scope): description`. Types: `feat`, `fix`, `docs`, `refactor`, `perf`, `chore`, `test`. Scopes: `embedding`, `vectordb`, `splitter`, `indexer`, `mcp`, `infra`, `config`.

## License

MIT
