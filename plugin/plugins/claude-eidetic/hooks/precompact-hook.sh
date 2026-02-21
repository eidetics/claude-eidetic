#!/usr/bin/env bash
# Eidetic PreCompact hook — captures session state before context compaction
# Parses transcript, writes note, updates session index, spawns background indexer

INPUT=$(cat)
echo "$INPUT" | node "${CLAUDE_PLUGIN_ROOT}/dist/precompact/hook.js"
