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

# Run tests as a local gate
echo "Running tests..."
npm run typecheck
npm test

# Bump version in package.json and create git tag
echo "Bumping $BUMP version..."
npm version "$BUMP" --no-git-tag-version
VERSION="$(node -p "require('./package.json').version")"
TAG="v$VERSION"

# Sync version into plugin.json
PLUGIN_JSON="plugin/plugins/claude-eidetic/.claude-plugin/plugin.json"
node -e "
const fs = require('fs');
const p = JSON.parse(fs.readFileSync('$PLUGIN_JSON', 'utf8'));
p.version = '$VERSION';
fs.writeFileSync('$PLUGIN_JSON', JSON.stringify(p, null, 2) + '\n');
"

echo "Version bumped to $VERSION, plugin.json synced."

# Commit package.json + plugin.json together
git add package.json "$PLUGIN_JSON"
git commit -m "chore(release): $TAG"

# Create the tag on the release commit
git tag "$TAG"

# Push commit and tag
echo "Pushing commit and tag $TAG..."
git push origin main
git push origin "$TAG"

echo "Done. GitHub Actions will now run tests, publish to npm, and create the release."
