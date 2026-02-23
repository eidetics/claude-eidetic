# claude-eidetic


[![tests](https://img.shields.io/github/actions/workflow/status/eidetics/claude-eidetic/ci.yml?style=flat-square&label=tests)](https://github.com/eidetics/claude-eidetic/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/claude-eidetic)](https://www.npmjs.com/package/claude-eidetic)
[![MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Semantic code search and persistent memory for Claude Code.

---

## 🔥 The Problem

Every new Claude Code session starts cold. You re-explain the architecture. You re-fetch the same docs. Claude reads the same files repeatedly, burning tokens just to get back to where you were.

On an active codebase, a single "understand this module" session can spend 10,000+ tokens on file reads. The next session spends the same 10,000 again.

**Eidetic stops the repetition.**

| Task | Without Eidetic | With Eidetic |
|---|---|---|
| Find where auth errors are handled | Grep cascade, read 8 files, ~10,700 tokens | `search_code("auth error handling")` ~220 tokens |
| Resume after context compaction | Re-explain 20 min of context, ~2,000 tokens | `/catchup` ~200 tokens |
| Look up React hooks docs | Fetch docs page, ~5,000 tokens | `search_documents("React useEffect")` ~20 tokens |
| Read a 400-line file | Built-in Read with line numbers, ~900 tokens | `read_file(path)` ~740 tokens |

---

## 💡 Why Eidetic?

**One plugin, not three.** Most tools make you choose: semantic search, or memory, or session continuity. Eidetic does all of them, and they compound: search results surface in memory, session summaries reference code, cached docs are semantically searchable.

**Sessions that survive.** When Claude Code compacts your context, a `PreCompact` hook captures what happened (files changed, tasks, commands) before they're lost. When you start fresh, `/catchup` reconstructs exactly where you left off. Automatic, not manual.

**Memory that learns.** `add_memory` uses an LLM to extract structured facts from conversation text (coding style, architecture decisions, debugging insights, preferences) and deduplicates them semantically. Not a static config file you forget to update.

**Token-efficient by design.** `search_code` returns ~20 tokens per result (vs ~100+ for Grep, ~2,000 per file read). Documentation cached once via `index_document` costs ~20 tokens to retrieve instead of ~5,000 to re-fetch. `read_file` strips line-number overhead for 15-20% savings on every file read.

**Works invisibly.** Hooks intercept expensive operations automatically. A nudge toward `search_code` appears when you reach for Read. Session state saves on exit. The codebase re-indexes when it changes. Zero behavior change required. It just makes everything cheaper.

---

## 🚀 Quick Start

**1. Install the plugin**

```bash
claude plugin install eidetics/claude-eidetic
```

**2. Set your API keys**

```bash
export OPENAI_API_KEY=sk-...         # for embeddings (default)
export ANTHROPIC_API_KEY=sk-ant-...  # for memory extraction (default)
# or use Ollama for both (see Configuration)
```

**3. Start Claude Code and ask a question**

```
> How does authentication work in this codebase?
```

Before searching, index your codebase once:

```
index_codebase(path="/your/project")
```

Subsequent searches use cached embeddings; no re-embedding unless files change.

---

## ✨ Features

### 🔍 Semantic Code Search

Hybrid dense-vector + full-text search fused with RRF. AST-aware chunking via tree-sitter keeps functions and classes intact. Incremental re-indexing via SHA-256 snapshots; only changed files are re-embedded on subsequent indexes.

```
search_code("how does the retry logic work")
search_code("authentication middleware", extensionFilter=[".ts"])
search_code(project="backend", query="auth flow")   # search any indexed project by name
```

### 🏗️ Architecture at a Glance

`browse_structure` returns a condensed map of every class, function, and method with signatures, grouped by file. One call instead of a Glob + Read cascade.

```
browse_structure(path="/my/project", kind="class")
list_symbols(path="/my/project", nameFilter="handle")
```

### 📚 Documentation Cache

Fetch docs once, search forever. `index_document` stores external documentation as searchable embeddings. `search_documents` retrieves relevant passages at ~20 tokens per result. A TTL tracks staleness; stale docs still return results but are flagged.

```
# After fetching React docs:
index_document(content=..., library="react", topic="hooks", source="https://...")
# Later, in any session:
search_documents("React useCallback dependencies", library="react")
```

### 🧠 Persistent Memory

`add_memory` extracts structured facts from conversation text using an LLM, categorizes them, and deduplicates semantically. Memories persist across sessions in a local SQLite database. Seven categories: `coding_style`, `tools`, `architecture`, `conventions`, `debugging`, `workflow`, `preferences`.

```
add_memory("Always use absolute imports, never relative")
search_memory("how does this team handle errors")
```

### 🔄 Session Continuity

**Automatic.** When a session ends, a `SessionEnd` hook parses the conversation transcript and writes a structured note to `~/.eidetic/notes/<project>/`, then indexes it. The note captures what actually happened: files modified, tasks created/completed, bash commands run, and the user's requests. When context compaction fires mid-session, a `PreCompact` hook does the same thing first. No user action required.

**With decisions.** `/wrapup` goes further: it reads the conversation and extracts decisions with rationale, rejected alternatives, open questions, and next actions. Run it at the end of any session where you made meaningful choices. `/catchup` at the start of a new session searches all indexed notes and reconstructs where you left off in ~200 tokens.

At `SessionStart`, the most recent session note is automatically injected into context, so every session opens knowing what changed last time.

### 👻 Invisible Optimizations

Eight hook events fire automatically with zero user action:

| Hook | Trigger | What it does |
|---|---|---|
| `SessionStart` | Session opens | Validates config, injects last-session context |
| `UserPromptSubmit` | Every message | Nudges toward `search_code` over Grep/Explore for conceptual queries |
| `PreToolUse` (Read) | Before every Read | Blocks Read for text files, redirects to `read_file` for 15-20% token savings |
| `PreToolUse` (WebFetch / query-docs) | Before doc fetches | Suggests `search_documents` if library is cached (allows fetch either way) |
| `PostToolUse` (Write / Edit) | After every file write | Tracks changed files in a shadow git index |
| `Stop` | After Claude responds | Commits shadow index; triggers targeted re-index of changed files only |
| `PreCompact` | Before context compaction | Captures session state to notes before memory is lost |
| `SessionEnd` | Session closes | Writes session note (files, tasks, commands); extracts developer memories via LLM |

---

## 🗺️ When to Use What

| Need | Use | Notes |
|---|---|---|
| Find implementations by concept | `search_code` | ~20 tokens/result, semantic |
| Exact string or regex match | Grep | Grep wins for exact matches |
| Find file by exact name | Glob | Glob wins for name patterns |
| Understand module structure | `browse_structure` | One call vs Glob + Read cascade |
| Read a specific known file | `read_file` | 15-20% cheaper than built-in Read |
| Search cached documentation | `search_documents` | ~250x cheaper than re-fetching |
| Recall project conventions | `search_memory` | Global across all projects and sessions |

---

## 📖 Skills Reference

| Skill | What it does |
|---|---|
| `/search` | Guided semantic search with best-practice prompts |
| `/index` | Index or re-index a codebase with dry-run option |
| `/cache-docs` | Fetch and cache external documentation |
| `/catchup` | Search session notes and reconstruct where you left off |
| `/wrapup` | Extract decisions, rationale, open questions, and next actions from the conversation |

---

## 📦 Installation

### Plugin (recommended)

```bash
claude plugin install eidetics/claude-eidetic
```

The plugin auto-starts the MCP server, installs skills, and configures hooks.

### npx (manual MCP config)

Add to your `.mcp.json`:

```json
{
  "mcpServers": {
    "claude-eidetic": {
      "command": "npx",
      "args": ["-y", "claude-eidetic"],
      "env": {
        "OPENAI_API_KEY": "sk-...",
        "ANTHROPIC_API_KEY": "sk-ant-..."
      }
    }
  }
}
```

`ANTHROPIC_API_KEY` is needed for the memory LLM (default provider). Omit it if using `MEMORY_LLM_PROVIDER=openai` or `ollama`.

### Global install

```bash
npm install -g claude-eidetic
```

### From source

```bash
git clone https://github.com/eidetics/claude-eidetic
cd claude-eidetic
npm install
npx tsc
npm start
```

### Requirements

- Node.js >= 20.0.0
- An API key (OpenAI for embeddings, Anthropic for memory extraction, or Ollama for both free)
- Docker (optional): Qdrant auto-provisions via Docker if not already running
- C/C++ build tools: required by tree-sitter native bindings (`node-gyp`)

---

## ⚙️ Configuration

All configuration is via environment variables. No config files.

### Using Ollama (free, local)

```bash
export EMBEDDING_PROVIDER=ollama
export MEMORY_LLM_PROVIDER=ollama
# No API keys needed
```

Eidetic uses `nomic-embed-text` for embeddings and `llama3.2` for memory extraction by default with Ollama.

### Full configuration reference

| Variable | Default | Description |
|---|---|---|
| `OPENAI_API_KEY` | _(required for openai)_ | OpenAI API key for embeddings and/or memory |
| `ANTHROPIC_API_KEY` | _(required for anthropic memory)_ | Anthropic API key for memory LLM |
| `EMBEDDING_PROVIDER` | `openai` | `openai`, `ollama`, or `local` |
| `EMBEDDING_MODEL` | `text-embedding-3-small` (openai) / `nomic-embed-text` (ollama) | Embedding model name |
| `EMBEDDING_BATCH_SIZE` | `100` | Batch size for embedding requests (1-2048) |
| `INDEXING_CONCURRENCY` | `8` | Parallel file indexing workers (1-32) |
| `OPENAI_BASE_URL` | _(none)_ | Custom OpenAI-compatible endpoint |
| `OLLAMA_BASE_URL` | `http://localhost:11434/v1` | Ollama server URL |
| `VECTORDB_PROVIDER` | `qdrant` | `qdrant` or `milvus` |
| `QDRANT_URL` | `http://localhost:6333` | Qdrant server URL |
| `QDRANT_API_KEY` | _(none)_ | Qdrant API key (for remote/cloud instances) |
| `MILVUS_ADDRESS` | `localhost:19530` | Milvus server address |
| `MILVUS_TOKEN` | _(none)_ | Milvus authentication token |
| `EIDETIC_DATA_DIR` | `~/.eidetic/` | Data root for snapshots, memory DB, registry |
| `CUSTOM_EXTENSIONS` | `[]` | JSON array of extra file extensions to index (e.g., `[".dart",".arb"]`) |
| `CUSTOM_IGNORE_PATTERNS` | `[]` | JSON array of glob patterns to exclude |
| `MEMORY_LLM_PROVIDER` | `anthropic` | `anthropic`, `openai`, or `ollama` |
| `MEMORY_LLM_MODEL` | `claude-haiku-4-5-20251001` (anthropic) / `gpt-4o-mini` (openai) / `llama3.2` (ollama) | Model for memory extraction |
| `MEMORY_LLM_BASE_URL` | _(none)_ | Custom base URL for memory LLM |
| `MEMORY_LLM_API_KEY` | _(none)_ | API key override for memory LLM |

---

## 🔧 Tool Reference

### 🔍 Code Search

| Tool | Description |
|---|---|
| `search_code` | Hybrid semantic search over indexed codebase. Returns compact table by default (~20 tokens/result). |
| `index_codebase` | Index a directory. Supports `dryRun`, `force`, `customExtensions`, `customIgnorePatterns`. |
| `list_indexed` | List all indexed codebases with file/chunk counts and status. |
| `get_indexing_status` | Check indexing progress for a path or project. |
| `clear_index` | Remove the search index for a codebase. |
| `cleanup_vectors` | Remove orphaned vectors for deleted files. No re-embedding cost. |
| `browse_structure` | Condensed structural map: classes, functions, methods with signatures, grouped by file. |
| `list_symbols` | Compact symbol table with name/kind/file/line. Supports name, kind, and path filters. |

### 📄 File Reading

| Tool | Description |
|---|---|
| `read_file` | Read file without line-number overhead. ~15-20% fewer tokens than built-in Read for code files. |

### 📚 Documentation Cache

| Tool | Description |
|---|---|
| `index_document` | Cache external documentation for semantic search. Supports TTL for staleness tracking. |
| `search_documents` | Search cached docs (~20 tokens/result vs ~5,000+ to re-fetch). |

### 🧠 Memory

| Tool | Description |
|---|---|
| `add_memory` | LLM-extracted facts from text. Auto-deduplicates. Seven categories. |
| `search_memory` | Semantic search over stored memories. Filterable by category. |
| `list_memories` | List all memories, optionally filtered by category. |
| `delete_memory` | Delete a specific memory by UUID. |
| `memory_history` | View change history for a memory (additions, updates, deletions). |

## 🌐 Supported Languages

**AST-aware** -- functions and classes chunked intact via tree-sitter:

<p>
  <img src="https://img.shields.io/badge/JavaScript-F7DF1E?style=flat-square&logo=javascript&logoColor=black" alt="JavaScript"/>
  <img src="https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript"/>
  <img src="https://img.shields.io/badge/React_(JSX/TSX)-61DAFB?style=flat-square&logo=react&logoColor=black" alt="JSX/TSX"/>
  <img src="https://img.shields.io/badge/Python-3776AB?style=flat-square&logo=python&logoColor=white" alt="Python"/>
  <img src="https://img.shields.io/badge/Go-00ADD8?style=flat-square&logo=go&logoColor=white" alt="Go"/>
  <img src="https://img.shields.io/badge/Java-ED8B00?style=flat-square&logo=openjdk&logoColor=white" alt="Java"/>
  <img src="https://img.shields.io/badge/Rust-000000?style=flat-square&logo=rust&logoColor=white" alt="Rust"/>
  <img src="https://img.shields.io/badge/C-A8B9CC?style=flat-square&logo=c&logoColor=black" alt="C"/>
  <img src="https://img.shields.io/badge/C++-00599C?style=flat-square&logo=cplusplus&logoColor=white" alt="C++"/>
  <img src="https://img.shields.io/badge/C%23-512BD4?style=flat-square&logo=csharp&logoColor=white" alt="C#"/>
</p>

**Line-based fallback** -- sliding window chunking for everything else:

<p>
  <img src="https://img.shields.io/badge/Markdown-000000?style=flat-square&logo=markdown&logoColor=white" alt="Markdown"/>
  <img src="https://img.shields.io/badge/YAML-CB171E?style=flat-square&logo=yaml&logoColor=white" alt="YAML"/>
  <img src="https://img.shields.io/badge/JSON-000000?style=flat-square&logo=json&logoColor=white" alt="JSON"/>
  <img src="https://img.shields.io/badge/Ruby-CC342D?style=flat-square&logo=ruby&logoColor=white" alt="Ruby"/>
  <img src="https://img.shields.io/badge/PHP-777BB4?style=flat-square&logo=php&logoColor=white" alt="PHP"/>
  <img src="https://img.shields.io/badge/Swift-F05138?style=flat-square&logo=swift&logoColor=white" alt="Swift"/>
  <img src="https://img.shields.io/badge/Kotlin-7F52FF?style=flat-square&logo=kotlin&logoColor=white" alt="Kotlin"/>
  <img src="https://img.shields.io/badge/and_more...-30363d?style=flat-square" alt="and more"/>
</p>

---

## 🛠️ Development

```bash
npm install          # install deps (tree-sitter has native bindings)
npx tsc              # build to dist/
npm run dev          # watch mode (tsx)
npm start            # run MCP server on stdio
npm run typecheck    # type-check only, no emit
```

```bash
npm test                    # unit tests (vitest, no external services needed)
npm run test:watch          # watch mode
npm run test:coverage       # with coverage
npm run test:integration    # requires Qdrant at localhost:6333 + OPENAI_API_KEY
npm run test:all            # unit + integration
```

**Commit format:** `type(scope): description`

Types: `feat`, `fix`, `docs`, `refactor`, `perf`, `chore`, `test`

Scopes: `embedding`, `vectordb`, `splitter`, `indexer`, `mcp`, `infra`, `config`

---

## 🙏 Acknowledgements

Heavily inspired by [mem0](https://github.com/mem0ai/mem0), [claude-mem](https://github.com/thedotmack/claude-mem), and [claude-context](https://github.com/zilliztech/claude-context). Documentation retrieval powered by [context7](https://github.com/upstash/context7).

---

## 📄 License

MIT