#!/usr/bin/env bash
# Eidetic PostToolUse hook — tracks file changes via shadow git index
# Runs on Write and Edit tool calls

INPUT=$(cat)
echo "$INPUT" | node "${CLAUDE_PLUGIN_ROOT}/dist/hooks/post-tool-use.js"
