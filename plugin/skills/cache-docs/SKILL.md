---
name: cache-docs
description: Cache external documentation for cheap semantic search
---

# /cache-docs — Cache Documentation in Eidetic

Cache external documentation so future queries use cheap semantic search (~20 tokens/result) instead of re-fetching (~5K+ tokens).

## Usage

`/eidetic:cache-docs <library>` — e.g., `/eidetic:cache-docs langfuse`

Optional: `/eidetic:cache-docs <library> <topic>` — e.g., `/eidetic:cache-docs react hooks`

## Step 1: Parse Arguments

Extract `library` (required) and `topic` (optional) from the user's argument. If no argument, ask: "Which library's documentation would you like to cache?"

## Step 2: Check Existing Cache

```
search_documents(query="overview", library="<LIBRARY>")
```

- If results found and fresh: "Documentation for `<LIBRARY>` is already cached. You can search it with `search_documents`. Would you like to refresh it?"
- If results found but stale: "Cached docs for `<LIBRARY>` are stale. Let me refresh them."
- If no results: proceed to Step 3.

## Step 3: Resolve Library

Use context7 to find the library:

```
resolve-library-id(libraryName="<LIBRARY>")
```

Pick the best matching library ID from the results.

## Step 4: Fetch Documentation

```
query-docs(libraryId="<LIBRARY_ID>", topic="<TOPIC or 'getting started'>")
```

Capture the returned content.

## Step 5: Cache with Eidetic

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
search_documents(query="<TOPIC or library name>", library="<LIBRARY>", limit=3)
```

Confirm results are returned, then report:

```
## Cached: <library>/<topic>

- Chunks: <N>
- Expires: <N> days
- Search with: `search_documents(query="...", library="<LIBRARY>")`
```

## Tips

- Cache multiple topics for the same library by repeating Steps 4-5 with different topics
- All topics for a library share one collection — searchable together
- Default TTL is 7 days; use longer for stable APIs, shorter for fast-moving projects
