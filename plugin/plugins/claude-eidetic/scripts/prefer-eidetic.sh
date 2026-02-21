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
  # Extract file_path from tool input
  FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // ""')
  EXT="${FILE_PATH##*.}"
  EXT_LOWER=$(echo "$EXT" | tr '[:upper:]' '[:lower:]')

  # Allow binary/media files through (Read handles images, PDFs, notebooks)
  case "$EXT_LOWER" in
    png|jpg|jpeg|gif|bmp|ico|svg|webp|pdf|ipynb|mp3|mp4|wav|avi|mov|woff|woff2|ttf|eot|zip|tar|gz|exe|dll|so|dylib|bin|dat)
      jq -n '{
        "hookSpecificOutput": {
          "hookEventName": "PreToolUse",
          "permissionDecision": "allow"
        }
      }'
      ;;
    *)
      # Block text/code files — redirect to read_file MCP tool
      jq -n '{
        "hookSpecificOutput": {
          "hookEventName": "PreToolUse",
          "permissionDecision": "deny",
          "additionalContext": "BLOCKED: Use read_file MCP tool instead of Read for text files. read_file returns raw content without line-number overhead (~15-20% fewer tokens for code). Example: read_file(path=\"...\"). Add lineNumbers=true only when you need line refs for editing."
        }
      }'
      ;;
  esac
fi
