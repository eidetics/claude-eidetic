#!/bin/bash
# PostToolUse memory nudge — prompts Claude to persist significant findings with add_memory.
# Only fires for WebFetch (high-signal, infrequent). Silent for all other tools.

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // ""')

if [ "$TOOL_NAME" != "WebFetch" ]; then
  exit 0
fi

jq -n '{
  "hookSpecificOutput": {
    "hookEventName": "PostToolUse",
    "additionalContext": "If this produced a significant finding (error + workaround, important URL, key discovery), persist it with add_memory(facts=[{\"fact\": \"...\", \"category\": \"debugging|tools|workflow\"}])."
  }
}'
