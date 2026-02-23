#!/bin/bash
# Only inject guidance when the MCP server can actually serve requests
if [ -z "$OPENAI_API_KEY" ] && [ "${EMBEDDING_PROVIDER:-openai}" = "openai" ]; then
  exit 0
fi

cat <<'EOF'
{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"Eidetic code search is available for this project.\n- search_code(query) — semantic search, ~20 tokens/result. Try before Grep or Explore agents.\n- browse_structure() — architecture map in one call. Try before Glob cascades.\n- read_file(path) — raw file content, fewer tokens than Read.\nUse Grep only for exact string/regex matches. Use Glob only for exact filenames."}}
EOF
