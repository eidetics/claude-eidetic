# ADR-002: CLI Router for Plugin Hooks

## Status

Accepted

## Date

2026-03-07

## Context

Plugin hooks delegate to compiled JS files via `node ${PLUGIN_ROOT}/dist/hooks/...js`, but `dist/` is gitignored and never reaches the plugin cache. The Claude Code plugin system copies files as-is from git with no build step. This causes `MODULE_NOT_FOUND` errors for 7 of 8 hooks that need compiled code.

The `claude-eidetic` npm binary already exists and is published/cached locally via `npx`. We need a way to invoke hook logic without relying on `dist/` being present in the plugin cache directory.

## Decision Drivers

- **Must have**: Hooks must work from the plugin cache without a build step
- **Must have**: No `dist/` committed to git (it's generated, large, and stale-prone)
- **Must have**: MCP server startup path unchanged (no regressions)
- **Should have**: Minimal code changes — reuse existing hook implementations
- **Nice to have**: Same Node startup cost as current approach (no extra latency)

## Considered Options

### Option 1: Commit `dist/` to git

- **Pros**: Zero code changes, hooks work immediately
- **Cons**: Stale artifacts, merge conflicts on generated code, bloats repo, violates standard gitignore conventions

### Option 2: Add a build step to plugin installation

- **Pros**: Clean separation, dist/ generated at install time
- **Cons**: Claude Code plugin system has no build hook — not supported by the platform

### Option 3: CLI subcommand router via published npm binary

- **Pros**: Uses already-published `npx claude-eidetic` binary, hooks become one-liner bash scripts, no dist/ needed in plugin cache, same Node startup cost, follows memsearch pattern
- **Cons**: Depends on npm package being installed (already required for MCP server)

## Decision

We will use **Option 3: CLI subcommand router**.

Add argument detection at the top of `src/index.ts`: if `process.argv[2] === 'hook'`, route to a thin dispatcher (`src/hooks/cli-router.ts`) instead of starting the MCP server. Plugin bash hooks become `cat | npx claude-eidetic hook <event>`.

## Rationale

Option 3 is the only viable approach given platform constraints (no build step in plugin system) and project conventions (dist/ stays gitignored). The `npx claude-eidetic` binary is already installed as part of the MCP server setup, so no new dependencies are introduced. The CLI router pattern is established in the ecosystem (memsearch uses the same approach).

## Consequences

### Positive

- All 8 hooks work from the plugin cache without dist/
- No generated code committed to git
- Hook bash scripts are trivial one-liners — easy to audit and debug
- Existing hook TypeScript modules are reused with minimal changes (export `run()` instead of self-executing)

### Negative

- `npx` resolution adds ~50-100ms on first invocation (cached thereafter)
- Hook modules must export a function instead of self-executing (minor refactor)

### Risks

- **npx cold-start latency**: First `npx` call downloads the package. Mitigated: package is already installed for MCP server. Subsequent calls resolve from cache with negligible overhead.
- **Version skew**: Plugin hooks invoke whichever `claude-eidetic` version is in the npm cache. Mitigated: plugin and npm package are released together.

## Implementation Notes

- CLI router in `src/hooks/cli-router.ts` — switch/case dispatcher mapping event names to hook modules
- Hook modules refactored: `main()` renamed to `run()`, exported, self-execution guarded behind `import.meta.url` check
- `session-start.sh` retains bash logic (env checks, MCP registration) but replaces `node dist/...` calls with `npx claude-eidetic hook ...`
- `hooks.json` updated: all `dist/` references replaced with bash script wrappers

## Related Decisions

- ADR-001: ChromaDB as Default Vector Database Provider — unrelated but establishes ADR conventions
