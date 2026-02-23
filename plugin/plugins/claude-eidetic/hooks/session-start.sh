#!/usr/bin/env bash
# Eidetic SessionStart hook — checks config, injects last-session context
# Message content lives in src/setup-message.ts (single source of truth)

if [ -z "$OPENAI_API_KEY" ] && [ "${EMBEDDING_PROVIDER:-openai}" = "openai" ]; then
  node "${CLAUDE_PLUGIN_ROOT}/dist/setup-message.js" "missing" "OPENAI_API_KEY is not set."
  exit 0
fi

# Inject Tier-0 context from most recent session (non-blocking, best-effort)
node "${CLAUDE_PLUGIN_ROOT}/dist/precompact/tier0-inject.js" 2>/dev/null || true
