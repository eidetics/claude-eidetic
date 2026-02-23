#!/usr/bin/env bash
set -euo pipefail

BUMP="${1:-}"
if [[ -z "$BUMP" ]]; then
  echo "Usage: npm run release <patch|minor|major>" >&2
  exit 1
fi

if [[ "$BUMP" != "patch" && "$BUMP" != "minor" && "$BUMP" != "major" ]]; then
  echo "Error: bump must be patch, minor, or major (got: $BUMP)" >&2
  exit 1
fi

# Ensure working tree is clean
if [[ -n "$(git status --porcelain)" ]]; then
  echo "Error: working tree is not clean. Commit or stash changes first." >&2
  exit 1
fi

# Ensure on main branch
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$BRANCH" != "main" ]]; then
  echo "Error: must be on main branch to release (currently on: $BRANCH)" >&2
  exit 1
fi

echo "Triggering $BUMP release via GitHub Actions..."
gh workflow run release.yml -f bump="$BUMP"
echo "Monitor at: https://github.com/eidetics/claude-eidetic/actions/workflows/release.yml"
