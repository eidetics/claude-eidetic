#!/bin/bash
INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name')

if [ "$TOOL_NAME" = "Grep" ]; then
  jq -n '{
    "hookSpecificOutput": {
      "hookEventName": "PreToolUse",
      "permissionDecision": "allow",
      "additionalContext": "REMINDER: For semantic/conceptual code search, prefer search_code MCP tool over Grep. search_code returns compact results at ~20 tokens/result vs ~100+ for Grep. Use Grep only for exact string/regex matches."
    }
  }'
elif [ "$TOOL_NAME" = "Read" ]; then
  jq -n '{
    "hookSpecificOutput": {
      "hookEventName": "PreToolUse",
      "permissionDecision": "allow",
      "additionalContext": "REMINDER: If exploring/searching code, prefer search_code MCP tool over Read. search_code returns compact results at ~20 tokens/result vs ~2000 for a full file read. Only use Read for files you already know you need."
    }
  }'
fi
