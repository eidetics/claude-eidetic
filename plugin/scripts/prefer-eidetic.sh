#!/bin/bash
INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name')

if [ "$TOOL_NAME" = "Grep" ]; then
  jq -n '{
    "hookSpecificOutput": {
      "hookEventName": "PreToolUse",
      "permissionDecision": "allow",
      "additionalContext": "STOP: Before using Grep to search code, use the search_code MCP tool instead. search_code provides semantic search at ~50 tokens/result vs Grep at ~100+ tokens. Only use Grep for exact string/regex matches where literal precision matters."
    }
  }'
elif [ "$TOOL_NAME" = "Read" ]; then
  jq -n '{
    "hookSpecificOutput": {
      "hookEventName": "PreToolUse",
      "permissionDecision": "allow",
      "additionalContext": "STOP: If you are reading this file to explore or search code, use the search_code MCP tool instead. search_code returns ~50 tokens/result vs ~2000 tokens for a full file Read. Only use Read for files you have already identified and need full content from."
    }
  }'
fi
