#!/usr/bin/env bash
# Eidetic SessionStart hook — checks for required configuration
# Message content lives in src/setup-message.ts (single source of truth)

if [ -z "$OPENAI_API_KEY" ] && [ "${EMBEDDING_PROVIDER:-openai}" = "openai" ]; then
  node "${CLAUDE_PLUGIN_ROOT}/dist/setup-message.js" "missing" "OPENAI_API_KEY is not set."
  exit 0
fi

# Key is set — no output needed (runtime errors handled by MCP server)
exit 0
