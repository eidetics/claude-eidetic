---
name: cache-docs
description: Cache external documentation for cheap semantic search
---

# /cache-docs

Cache external docs so future queries use `search_documents` (~20 tokens/result) instead of re-fetching (~5K+ tokens).

Usage:
- `/eidetic:cache-docs <library>`
- `/eidetic:cache-docs <library> <topic>`

## Step 1: Parse Arguments

Extract `library` (required) and `topic` (optional). If no argument, ask: "Which library's docs would you like to cache?"

## Step 2: Check Existing Cache

```
search_documents(query="overview", library="<LIBRARY>")
```

- Results found and fresh: inform user, offer to refresh.
- Results found but stale: proceed to refresh.
- No results: proceed to Step 3.

## Step 3: Resolve Library

```
resolve-library-id(libraryName="<LIBRARY>")
```

Pick the best matching ID.

## Step 4: Fetch Docs

```
query-docs(libraryId="<LIBRARY_ID>", topic="<TOPIC or 'getting started'>")
```

## Step 5: Cache

```
index_document(
  content="<FETCHED_CONTENT>",
  source="context7:<LIBRARY_ID>/<TOPIC>",
  library="<LIBRARY>",
  topic="<TOPIC>",
  ttlDays=7
)
```

## Step 6: Verify

```
search_documents(query="<TOPIC or library>", library="<LIBRARY>", limit=3)
```

Report: chunks cached, TTL, search command.

Note: repeat Steps 4-5 with different topics to cache multiple topics for the same library.
