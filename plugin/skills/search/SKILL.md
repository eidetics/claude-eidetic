---
name: search
description: Semantic code search using Eidetic
---

# /search — Eidetic Semantic Code Search

Search the current project's codebase using semantic search.

## Usage

`/eidetic:search <query>` — e.g., `/eidetic:search auth middleware`

## Step 1: Parse Query

The user's argument after `/eidetic:search` is the search query. If no argument was provided, ask: "What would you like to search for?"

## Step 2: Detect Project Path

```bash
git rev-parse --show-toplevel 2>/dev/null || echo "NO_GIT_REPO"
```

- If NO_GIT_REPO, ask user for the path to search.
- Store as PROJECT_PATH.

## Step 3: Check Index Status

```
get_indexing_status(path="<PROJECT_PATH>")
```

- If not indexed, inform user: "This project hasn't been indexed yet. Run `/eidetic:index` first, or I can index it now."
- If user agrees, run `index_codebase(path="<PROJECT_PATH>")` then continue.
- If indexed, proceed.

## Step 4: Search

```
search_code(path="<PROJECT_PATH>", query="<USER_QUERY>", limit=10)
```

## Step 5: Present Results

Format results as:

```
## Search: "<query>" in <project-name>

1. `path/to/file.ts:42` — <snippet preview>
2. `path/to/other.ts:15` — <snippet preview>
...

**<N> results** | Index: <file count> files
```

If no results found, suggest:
- Different search terms
- Checking if the project is fully indexed
- Using Grep for exact string matches instead
