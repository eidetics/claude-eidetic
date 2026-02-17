---
name: catchup
description: Recover session context from Eidetic-searchable notes
---

# /catchup — Restore Previous Session Context

Recover context from previous sessions using Eidetic-indexed notes.

## Step 1: Detect Project

Run this command to get the project name and notes path:

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

- If user passed an argument (e.g., `/catchup myproject`), use that as PROJECT_NAME instead.
- If NO_GIT_REPO and no argument, ask user for the project name.
- If EXISTS=no or FILE_COUNT=0, inform user: "No session notes found for <PROJECT_NAME>. Run /wrapup at the end of a session to enable context recovery." Then stop.

## Step 2: Ensure Index is Fresh

Using the EXACT NOTES_DIR from Step 1:

```
index_codebase(path="<NOTES_DIR>")
```

This is cheap (incremental — only re-embeds changed files). Ensures any manually-edited notes are searchable.

## Step 3: Search for Context

Run these searches using the EXACT NOTES_DIR from Step 1:

```
search_code(path="<NOTES_DIR>", query="recent decisions and changes for <PROJECT_NAME>", limit=5)
search_code(path="<NOTES_DIR>", query="open questions next actions blockers", limit=5)
```

## Step 4: Read Top Notes

- Collect unique file paths from search results
- Sort by filename date (YYYY-MM-DD prefix) descending
- Read the top 2-3 most recent files in full

## Step 5: Present Summary

Format as concise summary (minimize context consumption):

```
## Catchup: <PROJECT_NAME>

**Last session:** <date of most recent note>
**Status:** <1-line status from most recent note>

**Key context:**
- [Most important decision or change]
- [Most critical open question]
- [Immediate next action]

**Open items:** <count> | **Recent notes:** <count> files covering <date range>
```

Only expand full details if user asks for more.

## Fallback

If Eidetic search fails (Qdrant down, indexing error, etc.):

```bash
ls -t "$NOTES_DIR"/*.md 2>/dev/null | head -3
```

Read those files directly and present the same summary format.
