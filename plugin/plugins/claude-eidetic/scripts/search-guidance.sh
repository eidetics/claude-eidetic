#!/bin/bash
# Only inject guidance when the MCP server can actually serve requests
if [ -z "$OPENAI_API_KEY" ] && [ "${EMBEDDING_PROVIDER:-openai}" = "openai" ]; then
  exit 0
fi

cat <<'EOF'
{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"IMPORTANT — Use search_code FIRST for any code search. It uses semantic search (~20 tokens/result).\n- search_code(query) — ALWAYS use this first for any concept, symbol, or keyword search.\n- browse_structure() — architecture map in one call. Use before Glob cascades or Explore agents.\n- read_file(path) — raw file content, fewer tokens than Read.\nUse Grep ONLY for exact regex patterns (e.g., \"function\\s+\\w+\", \"import.*from\"). Use Glob only for exact filenames."}}
EOF
