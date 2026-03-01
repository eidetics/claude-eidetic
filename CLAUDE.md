# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Run

```bash
npm install          # install deps (tree-sitter has native bindings)
npx tsc              # build to dist/
npm run dev          # watch mode (tsx)
npm start            # run MCP server on stdio
npm run typecheck    # type-check only, no emit
npm run lint         # eslint src/
npm run format       # prettier --write src/**/*.ts
```

## Workflow Orchestration
1. Plan Mode Default

Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions)
If something goes sideways, STOP and re-plan immediately — don't keep pushing
Use plan mode for verification steps, not just building
Write detailed specs upfront to reduce ambiguity

2. Subagent Strategy

Use subagents liberally to keep main context window clean
Offload research, exploration, and parallel analysis to subagents
For complex problems, throw more compute at it via subagents
One task per subagent for focused execution

3. Self-Improvement Loop

After ANY correction from the user: update tasks/lessons.md with the pattern
Write rules for yourself that prevent the same mistake
Ruthlessly iterate on these lessons until mistake rate drops
Review lessons at session start for relevant project

4. Verification Before Done

Never mark a task complete without proving it works
Diff behavior between main and your changes when relevant
Ask yourself: "Would a staff engineer approve this?"
Run tests, check logs, demonstrate correctness

5. Demand Elegance (Balanced)

For non-trivial changes: pause and ask "is there a more elegant way?"
If a fix feels hacky: "Knowing everything I know now, implement the elegant solution"
Skip this for simple, obvious fixes — don't over-engineer
Challenge your own work before presenting it

6. Autonomous Bug Fixing

When given a bug report: just fix it. Don't ask for hand-holding
Point at logs, errors, failing tests — then resolve them
Zero context switching required from the user
Go fix failing CI tests without being told how

Task Management

Plan First: Write plan to tasks/todo.md with checkable items
Verify Plan: Check in before starting implementation
Track Progress: Mark items complete as you go
Explain Changes: High-level summary at each step
Document Results: Add review section to tasks/todo.md
Capture Lessons: Update tasks/lessons.md after corrections

Core Principles

Simplicity First: Make every change as simple as possible. Impact minimal code.
No Laziness: Find root causes. No temporary fixes. Senior developer standards.
Minimal Impact: Changes should only touch what's necessary. Avoid introducing bugs.

## Testing

```bash
npm test                    # unit tests (vitest)
npm run test:watch          # watch mode
npm run test:coverage       # with coverage
npm run test:integration    # requires running Qdrant + OPENAI_API_KEY
npm run test:all            # unit + integration
```

Run a single test file: `npx vitest run src/core/searcher.test.ts`

Unit tests use mocks (see `src/__tests__/`) — no external services needed. The vitest config injects a dummy `OPENAI_API_KEY` for unit tests. Integration tests (`*.integration.test.ts`, `src/e2e/`) need Qdrant at `localhost:6333` and a real `OPENAI_API_KEY`.

Two vitest configs: `vitest.config.ts` (unit, excludes `*.integration.test.ts` and `e2e/`) and `vitest.integration.config.ts` (integration + e2e only).

## Architecture

Single ESM package. MCP server over stdio that indexes codebases into a vector DB and provides hybrid semantic search.

**Data flow:** `index_codebase` → scan files (`sync.ts`) → split into chunks (AST via tree-sitter, line-based fallback) → embed via OpenAI/Ollama → store in Qdrant/Milvus. `search_code` → embed query → hybrid search (dense vector + full-text, fused via RRF) → deduplicate overlapping chunks → return results.

**Key interfaces** — the pluggable boundaries:
- `Embedding` (`src/embedding/types.ts`) — embed/embedBatch/estimateTokens. Single implementation (`OpenAIEmbedding`) reused for OpenAI, Ollama, and local providers via different connection params. Factory in `embedding/factory.ts`.
- `VectorDB` (`src/vectordb/types.ts`) — createCollection/insert/search/deleteByPath. Primary: Qdrant (hybrid search with RRF). Optional: Milvus (dynamic import).
- `Splitter` (`src/splitter/types.ts`) — split code into chunks. `AstSplitter` (tree-sitter, supports JS/TS/Python/Go/Java/Rust/C++/C#) tried first; `LineSplitter` as fallback. Large AST chunks (>2500 chars) are sub-split.

**Entrypoint:** `src/index.ts` — wires up embedding + vectordb + state, registers MCP tool handlers. Graceful degradation: if initialization fails, server starts in setup-required mode (all tool calls return setup instructions from `messages.yaml`).

**Concurrency control:** `tools.ts` has a per-path mutex (`withMutex`) preventing concurrent indexing of the same codebase.

**Incremental indexing:** `core/sync.ts` builds content-hash snapshots (SHA-256, truncated). On re-index, only added/modified files are re-embedded. Snapshots persist to `~/.eidetic/snapshots/`.

**State layers:**
- `state/snapshot.ts` — in-memory `StateManager` tracks indexing status per codebase (idle/indexing/indexed/error + progress)
- `core/snapshot-io.ts` — filesystem persistence of file-hash snapshots for incremental indexing
- `state/registry.ts` — project name → path mapping at `~/.eidetic/registry.json`

**Config:** `config.ts` — Zod-validated, entirely env-var driven. `loadConfig()` reads `process.env`, caches result. No config files parsed at runtime (except `messages.yaml` for user-facing setup text).

## Workflow

- **Feature work always starts in a new git worktree.** Use the `superpowers:using-git-worktrees` skill before beginning any feature implementation.

## Pre-commit / Pre-PR Checks

Before every git commit, run prettier:
```bash
npm run format          # prettier --write src/**/*.ts
```

Before creating a PR, run unit tests and ensure they pass:
```bash
npm test                # vitest unit tests
```

## Conventions

- **ESM only.** All imports use `.js` extensions.
- **TypeScript strict mode.** Target ES2022, module Node16.
- **Conventional commits.** `type(scope): description` — types: `feat`, `fix`, `docs`, `refactor`, `perf`, `chore`, `test`. Scopes: `embedding`, `vectordb`, `splitter`, `indexer`, `mcp`, `infra`, `config`.
- **No `process.cwd()` or `__dirname`.** Paths come from explicit arguments. `paths.ts` is the single source of truth for normalization (forward slashes, resolve to absolute, tilde expansion).
- **stdout is sacred.** `console.log`/`console.warn` are redirected to stderr at the top of `index.ts`. Only MCP JSON protocol goes to stdout.
- **Error hierarchy.** `EideticError` base class in `errors.ts` with typed subclasses: `ConfigError`, `EmbeddingError`, `VectorDBError`, `IndexingError`, `SearchError`, `BootstrapError`.
- **User-facing text lives in `messages.yaml`**, not in code. `setup-message.ts` reads it.

## Environment

Only `OPENAI_API_KEY` is required for default config. Qdrant auto-provisions via Docker (`infra/qdrant-bootstrap.ts`) if not running at `localhost:6333`. Key env vars:

- `EMBEDDING_PROVIDER` — `openai` (default), `ollama`, `local`
- `VECTORDB_PROVIDER` — `qdrant` (default), `milvus`
- `QDRANT_URL`, `QDRANT_API_KEY` — for remote Qdrant
- `EMBEDDING_MODEL` — defaults: `text-embedding-3-small` (openai), `nomic-embed-text` (ollama)
- `EIDETIC_DATA_DIR` — data root, defaults to `~/.eidetic/`
- `CUSTOM_EXTENSIONS`, `CUSTOM_IGNORE_PATTERNS` — JSON arrays for file inclusion/exclusion

## Plugin

`plugin/` contains a Claude Code plugin: `.mcp.json` (auto-starts the server), skills (`catchup`, `wrapup`, `search`, `index`, `cache-docs`), 8 hook events (SessionStart, PreCompact, SessionEnd, PostToolUse, Stop, UserPromptSubmit, 2× PreToolUse), and a plugin manifest. The Read PreToolUse hook **blocks** built-in Read for text/code files and redirects to `read_file`.
