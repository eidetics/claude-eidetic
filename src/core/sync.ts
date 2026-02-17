import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { glob } from 'glob';

export interface FileSnapshot {
  [relativePath: string]: { contentHash: string };
}

export interface SyncResult {
  added: string[];
  modified: string[];
  removed: string[];
}

const DEFAULT_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.pyi',
  '.go',
  '.java',
  '.rs',
  '.cpp', '.cc', '.cxx', '.c', '.h', '.hpp',
  '.cs',
  '.scala',
  '.rb',
  '.php',
  '.swift',
  '.kt', '.kts',
  '.lua',
  '.sh', '.bash', '.zsh',
  '.sql',
  '.r', '.R',
  '.m', '.mm',  // Objective-C
  '.dart',
  '.ex', '.exs', // Elixir
  '.erl', '.hrl', // Erlang
  '.hs', // Haskell
  '.ml', '.mli', // OCaml
  '.vue', '.svelte', '.astro',
  '.yaml', '.yml',
  '.toml',
  '.json',
  '.md', '.mdx',
  '.html', '.css', '.scss', '.less',
]);

const DEFAULT_IGNORE = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/build/**',
  '**/.next/**',
  '**/target/**',
  '**/__pycache__/**',
  '**/.venv/**',
  '**/venv/**',
  '**/vendor/**',
  '**/.cache/**',
  '**/coverage/**',
  '**/*.min.js',
  '**/*.min.css',
  '**/package-lock.json',
  '**/pnpm-lock.yaml',
  '**/yarn.lock',
];

/**
 * Scan a directory and return relative paths of indexable files.
 * Respects .gitignore if present.
 */
export async function scanFiles(
  rootPath: string,
  customExtensions: string[] = [],
  customIgnore: string[] = [],
): Promise<string[]> {
  const extensions = new Set([...DEFAULT_EXTENSIONS, ...customExtensions]);

  // Read .gitignore patterns if present
  const gitignorePatterns = readGitignore(rootPath);

  const allIgnore = [...DEFAULT_IGNORE, ...gitignorePatterns, ...customIgnore];

  const files = await glob('**/*', {
    cwd: rootPath,
    nodir: true,
    dot: false,
    ignore: allIgnore,
    absolute: false,
  });

  return files
    .filter(f => extensions.has(path.extname(f).toLowerCase()))
    .sort();
}

/**
 * Compute a truncated SHA-256 hash of a file's contents.
 * 16 hex chars (64 bits) is sufficient for change detection — collisions
 * would only cause a redundant re-index, not data loss.
 */
function hashFileContent(fullPath: string): string {
  const content = fs.readFileSync(fullPath);
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

/**
 * Build a size+contentHash snapshot for a list of files.
 */
export function buildSnapshot(rootPath: string, relativePaths: string[]): FileSnapshot {
  const snapshot: FileSnapshot = {};
  for (const rel of relativePaths) {
    const fullPath = path.join(rootPath, rel);
    try {
      const contentHash = hashFileContent(fullPath);
      snapshot[rel] = { contentHash };
    } catch (err) {
      console.warn(`Skipping "${rel}": ${err}`);
    }
  }
  return snapshot;
}

/**
 * Compare current snapshot to a previous one. Returns added, modified, and removed files.
 * Uses content hash as the authoritative change signal — immune to git ops, IDE formatters,
 * NFS clock skew, and other mtime-only pitfalls.
 */
export function diffSnapshots(previous: FileSnapshot, current: FileSnapshot): SyncResult {
  const added: string[] = [];
  const modified: string[] = [];
  const removed: string[] = [];

  for (const [rel, cur] of Object.entries(current)) {
    const prev = previous[rel];
    if (!prev) {
      added.push(rel);
    } else if (prev.contentHash !== cur.contentHash) {
      modified.push(rel);
    }
  }

  for (const rel of Object.keys(previous)) {
    if (!(rel in current)) {
      removed.push(rel);
    }
  }

  return { added, modified, removed };
}

/**
 * Parse .gitignore content into glob patterns.
 * Pure function — no filesystem access.
 */
export function parseGitignorePatterns(content: string): string[] {
  return content
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#') && !line.startsWith('!'))
    .map(pattern => {
      // Strip trailing spaces (gitignore spec)
      pattern = pattern.replace(/\s+$/, '');
      // Directory-only patterns: trailing /
      if (pattern.endsWith('/')) {
        pattern = pattern.slice(0, -1);
      }
      // Rooted patterns: leading /
      if (pattern.startsWith('/')) return pattern.slice(1);
      // Unrooted patterns without / match anywhere
      if (!pattern.includes('/')) return `**/${pattern}`;
      return pattern;
    })
    .filter(p => p.length > 0);
}

function readGitignore(rootPath: string): string[] {
  const gitignorePath = path.join(rootPath, '.gitignore');
  try {
    const content = fs.readFileSync(gitignorePath, 'utf-8');
    return parseGitignorePatterns(content);
  } catch {
    return [];
  }
}

/**
 * Map file extension to language name for the splitter.
 */
export function extensionToLanguage(ext: string): string {
  const map: Record<string, string> = {
    '.ts': 'typescript', '.tsx': 'tsx',
    '.js': 'javascript', '.jsx': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
    '.py': 'python', '.pyi': 'python',
    '.go': 'go',
    '.java': 'java',
    '.rs': 'rust',
    '.cpp': 'cpp', '.cc': 'cpp', '.cxx': 'cpp', '.c': 'c', '.h': 'cpp', '.hpp': 'cpp',
    '.cs': 'csharp',
    '.scala': 'scala',
    '.rb': 'ruby', '.php': 'php', '.swift': 'swift',
    '.kt': 'kotlin', '.kts': 'kotlin',
    '.lua': 'lua', '.sh': 'bash', '.bash': 'bash', '.zsh': 'bash',
    '.sql': 'sql', '.r': 'r', '.R': 'r',
    '.dart': 'dart', '.ex': 'elixir', '.exs': 'elixir',
    '.hs': 'haskell', '.ml': 'ocaml',
    '.vue': 'vue', '.svelte': 'svelte', '.astro': 'astro',
    '.yaml': 'yaml', '.yml': 'yaml', '.toml': 'toml', '.json': 'json',
    '.md': 'markdown', '.mdx': 'markdown',
    '.html': 'html', '.css': 'css', '.scss': 'scss', '.less': 'less',
  };
  return map[ext.toLowerCase()] ?? 'unknown';
}
