#!/bin/bash
INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name')

if [ "$TOOL_NAME" = "Grep" ]; then
  PATTERN=$(echo "$INPUT" | jq -r '.tool_input.pattern // ""')

  # Allow only patterns with clear regex syntax:
  # Backslash sequences (\s \w \d \b \S \W \D \n \t), character classes [...],
  # groups with alternation (|), or regex quantifiers (.+ .* .?)
  if echo "$PATTERN" | grep -qP '\\[swdSWDbntr]|\[.*\]|\(.*\|.*\)|\.\+|\.\*|\.\?'; then
    # Clear regex — allow Grep
    exit 0
  else
    # Conceptual/literal search — deny and redirect to search_code
    jq -n --arg pattern "$PATTERN" '{
      "hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "deny",
        "permissionDecisionReason": ("BLOCKED: Use search_code(query=\"" + $pattern + "\") instead of Grep. search_code uses semantic search (~20 tokens/result vs ~100+ for Grep).\nGrep is only for regex patterns (e.g., \"function\\s+\\w+\", \"import.*from\").\nIf the codebase is not indexed, run index_codebase first.")
      }
    }'
  fi
fi
