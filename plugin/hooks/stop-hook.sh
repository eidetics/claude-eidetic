#!/usr/bin/env bash
# Eidetic Stop hook — commits shadow git index and triggers targeted re-indexing

INPUT=$(cat)
echo "$INPUT" | node "${CLAUDE_PLUGIN_ROOT}/dist/hooks/stop-hook.js"
