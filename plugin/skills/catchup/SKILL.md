---
name: catchup
description: Recover session context from Eidetic-searchable notes
---

# /catchup

## Step 1: Detect Project

```bash
PROJECT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
if [ -n "$PROJECT_ROOT" ]; then
  PROJECT_NAME=$(basename "$PROJECT_ROOT")
  NOTES_DIR="$HOME/.eidetic/notes/$PROJECT_NAME"
  echo "PROJECT_NAME=$PROJECT_NAME"
  echo "NOTES_DIR=$NOTES_DIR"
  echo "EXISTS=$([ -d "$NOTES_DIR" ] && echo yes || echo no)"
  echo "FILE_COUNT=$([ -d "$NOTES_DIR" ] && ls "$NOTES_DIR"/*.md 2>/dev/null | wc -l || echo 0)"
else
  echo "NO_GIT_REPO"
fi
```

- Argument overrides PROJECT_NAME (e.g. `/catchup myproject`).
- If NO_GIT_REPO and no argument, ask for project name.
- If EXISTS=no or FILE_COUNT=0: "No session notes for <PROJECT_NAME>. Run /wrapup to enable recovery." Stop.

## Step 2: Refresh Index

```
index_codebase(path="<NOTES_DIR>")
```

## Step 3: Search

```
search_code(path="<NOTES_DIR>", query="recent decisions and changes for <PROJECT_NAME>", limit=5)
search_code(path="<NOTES_DIR>", query="open questions next actions blockers", limit=5)
```

## Step 4: Read Top Notes

Collect unique file paths, sort by filename date descending, read top 2-3 in full.

## Step 5: Present Summary

```
## Catchup: <PROJECT_NAME>
**Last session:** <date> | **Status:** <1-line status>
- <Key decision or change>
- <Critical open question>
- <Next action>
**Open items:** <N> | **Notes:** <N> files, <date range>
```

Expand only if user asks.

## Fallback

If Eidetic fails, read the 3 most recent files directly:

```bash
ls -t "$NOTES_DIR"/*.md 2>/dev/null | head -3
```
