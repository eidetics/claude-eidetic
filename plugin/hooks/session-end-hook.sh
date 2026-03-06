#!/usr/bin/env bash
# Eidetic SessionEnd hook — captures session state and extracts semantic memories
cat | npx claude-eidetic hook session-end
