#!/usr/bin/env bash
# Eidetic SessionEnd hook — captures session state and extracts semantic memories
# Parses transcript, writes note (if not already captured by PreCompact), runs memory extraction

INPUT=$(cat)
echo "$INPUT" | node "${CLAUDE_PLUGIN_ROOT}/dist/precompact/hook.js"
