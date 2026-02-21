#!/bin/bash
# PreToolUse hook: Nudge toward cached docs when available.
# Intercepts query-docs and WebFetch calls, checks doc-metadata.json.

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name')

# Resolve data dir (respect EIDETIC_DATA_DIR, default to ~/.eidetic)
DATA_DIR="${EIDETIC_DATA_DIR:-$HOME/.eidetic}"
METADATA_FILE="$DATA_DIR/doc-metadata.json"

# If no metadata file exists, allow silently
if [ ! -f "$METADATA_FILE" ]; then
  exit 0
fi

LIBRARY=""

# Extract library from query-docs (look for libraryId in tool_input)
if echo "$TOOL_NAME" | grep -q "query-docs\|query_docs"; then
  # Try to extract library name from the libraryId or topic param
  LIBRARY=$(echo "$INPUT" | jq -r '.tool_input.topic // .tool_input.libraryId // ""' 2>/dev/null)
  # Normalize: take last segment after / if it looks like a path
  if echo "$LIBRARY" | grep -q '/'; then
    LIBRARY=$(echo "$LIBRARY" | rev | cut -d'/' -f1 | rev)
  fi
fi

# Extract URL from WebFetch (check if it matches a cached source)
if [ "$TOOL_NAME" = "WebFetch" ]; then
  URL=$(echo "$INPUT" | jq -r '.tool_input.url // ""' 2>/dev/null)
  if [ -n "$URL" ]; then
    # Check if this exact URL is cached as a source
    MATCH=$(jq -r --arg url "$URL" 'to_entries[] | select(.value.source == $url) | .value.library' "$METADATA_FILE" 2>/dev/null | head -1)
    if [ -n "$MATCH" ]; then
      LIBRARY="$MATCH"
    fi
  fi
fi

# If no library identified, allow silently
if [ -z "$LIBRARY" ]; then
  exit 0
fi

# Search metadata for matching entries (case-insensitive prefix match on key)
LIBRARY_LOWER=$(echo "$LIBRARY" | tr '[:upper:]' '[:lower:]')
ENTRIES=$(jq -r --arg lib "$LIBRARY_LOWER" '[to_entries[] | select(.key | startswith($lib + "::"))] | length' "$METADATA_FILE" 2>/dev/null)

if [ "$ENTRIES" = "0" ] || [ -z "$ENTRIES" ]; then
  # Not cached — allow silently
  exit 0
fi

# Check staleness: get the most recent entry for this library
INDEXED_AT=$(jq -r --arg lib "$LIBRARY_LOWER" '[to_entries[] | select(.key | startswith($lib + "::")) | .value.indexedAt] | sort | last' "$METADATA_FILE" 2>/dev/null)
TTL_DAYS=$(jq -r --arg lib "$LIBRARY_LOWER" '[to_entries[] | select(.key | startswith($lib + "::")) | .value.ttlDays] | first' "$METADATA_FILE" 2>/dev/null)

if [ -z "$INDEXED_AT" ] || [ "$INDEXED_AT" = "null" ]; then
  exit 0
fi

# Calculate age in days
INDEXED_EPOCH=$(date -d "$INDEXED_AT" +%s 2>/dev/null || date -j -f "%Y-%m-%dT%H:%M:%S" "${INDEXED_AT%%.*}" +%s 2>/dev/null || echo "0")
NOW_EPOCH=$(date +%s)
AGE_DAYS=$(( (NOW_EPOCH - INDEXED_EPOCH) / 86400 ))
TTL_DAYS=${TTL_DAYS:-7}

if [ "$AGE_DAYS" -gt "$TTL_DAYS" ]; then
  jq -n --arg lib "$LIBRARY" --arg days "$AGE_DAYS" '{
    "hookSpecificOutput": {
      "hookEventName": "PreToolUse",
      "permissionDecision": "allow",
      "additionalContext": ("STALE CACHE: Documentation for \"" + $lib + "\" was cached " + $days + " days ago (past TTL). Consider refreshing with index_document after fetching, or use search_documents(query=\"...\", library=\"" + $lib + "\") if staleness is acceptable.")
    }
  }'
else
  jq -n --arg lib "$LIBRARY" '{
    "hookSpecificOutput": {
      "hookEventName": "PreToolUse",
      "permissionDecision": "allow",
      "additionalContext": ("CACHED: Documentation for \"" + $lib + "\" is cached and fresh. Use search_documents(query=\"...\", library=\"" + $lib + "\") instead (~20 tokens/result vs ~5K+ tokens for a full fetch).")
    }
  }'
fi
