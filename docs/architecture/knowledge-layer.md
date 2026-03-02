# Knowledge Layer Architecture

## Overview

The knowledge layer automatically generates high-level architectural summaries from indexed code using RAPTOR (Recursive Abstractive Processing for Tree-Organized Retrieval). After `index_codebase` embeds code chunks, RAPTOR clusters them, LLM-summarizes each cluster, and stores summaries for cross-project discovery.

## Three-Tier Data Flow

```
index_codebase → code chunks in eidetic_<path>
                        ↓
              RAPTOR clusters + LLM summarize
                        ↓
              eidetic_<project>_knowledge
                        ↓
              eidetic_global_concepts (replicated)
                        ↓
              search_memory / UserPromptSubmit hook
```

## Collections

| Collection | Purpose | Populated by |
|------------|---------|-------------|
| `eidetic_<path>` | Raw code chunks | `index_codebase` |
| `eidetic_<project>_knowledge` | Cluster summaries per project | RAPTOR pipeline |
| `eidetic_global_concepts` | Cross-project summaries | Replication from knowledge |

## RAPTOR Pipeline (`src/core/raptor.ts`)

1. **Scroll** all code chunks from the project's code collection via `scrollAll`
2. **Cluster** using K-means (Lloyd's algorithm, k-means++ init)
   - `k = max(3, floor(sqrt(n/2)))`, maxIter=20
3. **Hash** each cluster: SHA-256 of sorted member chunk IDs (truncated to 16 chars)
4. **Cache check**: lookup hash in `raptor.db` SQLite — skip LLM if cached
5. **Summarize** via OpenAI chat completions (configurable model, default `gpt-4o-mini`)
6. **Embed** summary and store in `_knowledge` collection
7. **Replicate** to `eidetic_global_concepts` via `global-concepts.ts`

Timeout: configurable `RAPTOR_TIMEOUT_MS` (default 60s). Pipeline stops gracefully and returns partial results.

## RAPTOR Cache (`src/core/raptor-cache.ts`)

SQLite at `~/.eidetic/raptor.db`, following `snapshot-io.ts` singleton pattern.

```sql
CREATE TABLE raptor_clusters (
  cluster_hash TEXT PRIMARY KEY,
  summary TEXT NOT NULL,
  project TEXT NOT NULL,
  level INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
)
```

Re-indexing the same unchanged codebase hits cache for all clusters (no LLM calls).

## Global Concepts (`src/core/global-concepts.ts`)

After RAPTOR stores knowledge summaries:
1. Scroll all points from `_knowledge` collection
2. Delete stale entries for this project from `eidetic_global_concepts`
3. Upsert current summaries with project tag

This enables cross-project search without knowing which project to query.

## Search Integration

`MemoryStore.searchMemory` in `src/memory/store.ts`:
- Searches project `_memory` + global `_memory` collections (existing behavior)
- **Also** searches `eidetic_global_concepts` with 0.8x weight discount
- Works even when no memory collections exist (concepts-only mode)

## Hook Integration

`UserPromptSubmit` hook (`src/hooks/user-prompt-inject.ts`):
- Embeds user prompt, searches `eidetic_global_concepts` (limit=5, threshold 0.3)
- Injects matching concepts as `additionalContext` in hook output
- 3s internal timeout via `Promise.race`

## Configuration

| Env var | Default | Description |
|---------|---------|-------------|
| `RAPTOR_ENABLED` | `true` | Enable RAPTOR after indexing |
| `RAPTOR_TIMEOUT_MS` | `60000` | Max time for RAPTOR pipeline |
| `RAPTOR_LLM_MODEL` | `gpt-4o-mini` | Model for cluster summarization |

## Key Files

- `src/core/raptor.ts` — K-means clustering, LLM summarization, pipeline orchestration
- `src/core/raptor-cache.ts` — SQLite cache for cluster summaries
- `src/core/global-concepts.ts` — Replication to global concepts collection
- `src/hooks/user-prompt-inject.ts` — UserPromptSubmit context injection
- `src/paths.ts` — `knowledgeCollectionName()`, `globalConceptsCollectionName()`, `getRaptorDbPath()`
- `src/errors.ts` — `RaptorError`
