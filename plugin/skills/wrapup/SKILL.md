---
name: wrapup
description: Persist session state to searchable notes for future recovery
---

# /wrapup — Save Session Context

Save key context from this session to Eidetic-searchable notes.

## Step 1: Detect Project

Run this command to get the project name and notes path:

```bash
PROJECT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
if [ -n "$PROJECT_ROOT" ]; then
  PROJECT_NAME=$(basename "$PROJECT_ROOT")
  NOTES_DIR="$HOME/.eidetic/notes/$PROJECT_NAME"
  echo "PROJECT_NAME=$PROJECT_NAME"
  echo "NOTES_DIR=$NOTES_DIR"
else
  echo "NO_GIT_REPO"
fi
```

- If user passed an argument (e.g., `/wrapup myproject`), use that as PROJECT_NAME instead.
- If NO_GIT_REPO and no argument, ask user for the project name.
- Use the EXACT output values for all subsequent steps. Do not modify or guess paths.

## Step 2: Extract Facts

Scan the conversation and extract:
- **Decisions** made (with rationale and alternatives rejected)
- **Changes** implemented (exact file paths, what changed)
- **Numbers** (metrics, costs, counts, performance measurements)
- **Open questions** (mark OPEN or ASSUMED)
- **Next actions** (specific, actionable)
- **Blockers** (dependencies, issues)

If the conversation has no meaningful content to persist, inform user and stop.

## Step 3: Write Note

Create the directory and write the note file:

```bash
mkdir -p "$NOTES_DIR"
```

Write to `$NOTES_DIR/<YYYY-MM-DD>-<topic-slug>.md` where topic-slug is kebab-case, max 3 words, derived from the main work done. Use today's date.

**Note template** (follow exactly — date and project appear 4 times for search reliability):

```
---
project: <PROJECT_NAME>
date: <YYYY-MM-DD>
branch: <current git branch>
---

# <PROJECT_NAME> — <YYYY-MM-DD>: <Topic Title>

**Date:** <YYYY-MM-DD>
**Project:** <PROJECT_NAME>

## Decisions

- **[Title]**: [Choice]. Rationale: [why]. Rejected: [alternatives].

## Changes

- `path/to/file.ts`: [what changed and why]

## Numbers

- [Any measurements, counts, costs]

## Open Questions

- **OPEN**: [Needs user decision]
- **ASSUMED**: [Assumption made, needs validation]

## Next Actions

1. [Specific action]

---
*<PROJECT_NAME> session recorded <YYYY-MM-DD>*
```

## Step 4: Index

Call Eidetic MCP tool using the EXACT NOTES_DIR path from Step 1:

```
index_codebase(path="<NOTES_DIR>")
```

Do NOT use `force: true` — incremental indexing is sufficient and cheaper.

## Step 5: Confirm

Tell user:
- File path where note was saved
- What was captured (count of decisions, changes, open questions)
- That index was updated for future /catchup
