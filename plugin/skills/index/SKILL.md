---
name: index
description: Index a codebase for Eidetic semantic search
---

# /index — Index Codebase for Eidetic Search

Index the current project (or a specified path) for semantic code search.

## Usage

- `/eidetic:index` — index current project
- `/eidetic:index /path/to/project` — index a specific path

## Step 1: Detect Path

If user provided a path argument, use that. Otherwise:

```bash
git rev-parse --show-toplevel 2>/dev/null || echo "NO_GIT_REPO"
```

- If NO_GIT_REPO and no argument, ask user for the path to index.
- Store as PROJECT_PATH.

## Step 2: Dry Run

Preview what will be indexed:

```
index_codebase(path="<PROJECT_PATH>", dryRun=true)
```

Present the dry run results:

```
## Index Preview: <project-name>

**Files:** <count> across <extensions>
**Top directories:** <list>
**Estimated cost:** <if available>
```

If there are warnings (e.g., very large files, binary files), show them.

## Step 3: Index

```
index_codebase(path="<PROJECT_PATH>")
```

## Step 4: Verify

```
get_indexing_status(path="<PROJECT_PATH>")
```

Present the result:

```
## Indexed: <project-name>

**Files:** <count> | **Chunks:** <count>
**Status:** Ready for search

Try: `/eidetic:search <example query>`
```
