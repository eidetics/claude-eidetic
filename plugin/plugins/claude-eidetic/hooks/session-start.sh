#!/usr/bin/env bash
# Eidetic SessionStart hook — checks config, injects last-session context
# Message content lives in src/setup-message.ts (single source of truth)

if [ -z "$OPENAI_API_KEY" ] && [ "${EMBEDDING_PROVIDER:-openai}" = "openai" ]; then
  node "${CLAUDE_PLUGIN_ROOT}/dist/setup-message.js" "missing" "OPENAI_API_KEY is not set."
  exit 0
fi

# Self-register MCP server at user scope if not already registered
if ! node -e "
  const fs = require('fs'), path = require('path'), os = require('os');
  try {
    const p = path.join(os.homedir(), '.claude.json');
    const d = JSON.parse(fs.readFileSync(p, 'utf8'));
    process.exit(d.mcpServers && d.mcpServers['claude-eidetic'] ? 0 : 1);
  } catch (e) { process.exit(1); }
" 2>/dev/null; then
  _env_args=()
  [ -n "$OPENAI_API_KEY" ]     && _env_args+=(-e "OPENAI_API_KEY=$OPENAI_API_KEY")
  [ -n "$EMBEDDING_PROVIDER" ] && _env_args+=(-e "EMBEDDING_PROVIDER=$EMBEDDING_PROVIDER")
  [ -n "$OPENAI_BASE_URL" ]    && _env_args+=(-e "OPENAI_BASE_URL=$OPENAI_BASE_URL")
  [ -n "$OLLAMA_BASE_URL" ]    && _env_args+=(-e "OLLAMA_BASE_URL=$OLLAMA_BASE_URL")
  [ -n "$QDRANT_URL" ]         && _env_args+=(-e "QDRANT_URL=$QDRANT_URL")
  [ -n "$QDRANT_API_KEY" ]     && _env_args+=(-e "QDRANT_API_KEY=$QDRANT_API_KEY")
  [ -n "$VECTORDB_PROVIDER" ]  && _env_args+=(-e "VECTORDB_PROVIDER=$VECTORDB_PROVIDER")
  claude mcp add -s user "${_env_args[@]}" -- claude-eidetic npx claude-eidetic 2>/dev/null || true
fi

# Inject Tier-0 context from most recent session (non-blocking, best-effort)
node "${CLAUDE_PLUGIN_ROOT}/dist/precompact/tier0-inject.js" 2>/dev/null || true

# Inject stored memories from vector DB (non-blocking, best-effort)
node "${CLAUDE_PLUGIN_ROOT}/dist/precompact/memory-inject.js" 2>/dev/null || true
