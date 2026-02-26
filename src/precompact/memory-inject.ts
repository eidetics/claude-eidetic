#!/usr/bin/env node
/**
 * Inject stored memories at SessionStart.
 * Called by session-start hook to surface previously learned knowledge.
 *
 * Outputs markdown to stdout for hook to capture and inject into session.
 */

import { execSync } from 'node:child_process';
import path from 'node:path';
import type { MemoryItem } from '../memory/types.js';

async function main(): Promise<void> {
  try {
    // Get cwd from environment (set by Claude Code) or detect from git
    const cwd = process.env.CLAUDE_CWD || process.cwd();

    // Detect project root from git
    const projectPath = detectProjectRoot(cwd);
    if (!projectPath) {
      // Not in a git repo, nothing to inject
      return;
    }

    const projectName = path.basename(projectPath);

    // Dynamic imports — avoid loading heavy deps if not needed
    const [{ loadConfig }, { createEmbedding }, { QdrantVectorDB }, { MemoryHistory }, { MemoryStore }] =
      await Promise.all([
        import('../config.js'),
        import('../embedding/factory.js'),
        import('../vectordb/qdrant.js'),
        import('../memory/history.js'),
        import('../memory/store.js'),
      ]);

    const config = loadConfig();
    const embedding = createEmbedding(config);
    const vectordb = new QdrantVectorDB();

    // Quick-exit if no memory collection exists
    const exists = await vectordb.hasCollection('eidetic_memory');
    if (!exists) {
      return;
    }

    const { getMemoryDbPath } = await import('../paths.js');
    const history = new MemoryHistory(getMemoryDbPath());
    const store = new MemoryStore(embedding, vectordb, history);

    const memories = await store.searchMemory(`${projectName} development knowledge`, 7);
    if (memories.length === 0) {
      return;
    }

    process.stdout.write(formatMemoryContext(memories));
  } catch (err) {
    // Write to stderr for debugging, but don't break session start
    process.stderr.write(`Memory inject failed: ${String(err)}\n`);
  }
}

function detectProjectRoot(cwd: string): string | null {
  try {
    const result = execSync('git rev-parse --show-toplevel', {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return result.trim();
  } catch {
    return null;
  }
}

export function formatMemoryContext(memories: MemoryItem[]): string {
  const lines: string[] = [];

  lines.push('## Remembered Knowledge');

  for (const m of memories) {
    const category = m.category ? `[${m.category}] ` : '';
    lines.push(`- ${category}${m.memory}`);
  }

  lines.push('');
  lines.push('_search_memory(query) for more. add_memory(facts) to save new findings._');
  lines.push('');

  return lines.join('\n');
}

main();
