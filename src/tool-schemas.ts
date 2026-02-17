const INDEX_DESCRIPTION = `\
Index a codebase directory to enable semantic search using a configurable code splitter.

Provide either \`path\` (absolute) or \`project\` (name). Use \`list_indexed\` to see registered projects.

Usage Guidance:
- Use dryRun=true first to preview what files would be indexed and catch configuration issues before committing to a full index.
- This tool is typically used when search fails due to an unindexed codebase.
- If indexing is attempted on an already indexed path, and a conflict is detected, \
you MUST prompt the user to confirm whether to proceed with a force index.`;

const SEARCH_DESCRIPTION = `\
Search the indexed codebase using natural language queries.

Provide either \`path\` (absolute) or \`project\` (name). Use \`list_indexed\` to see registered projects.

When to Use:
- Code search: Find specific functions, classes, or implementations
- Context-aware assistance: Gather relevant code context before making changes
- Issue identification: Locate problematic code sections or bugs
- Code review: Understand existing implementations and patterns
- Refactoring: Find all related code pieces that need to be updated
- Feature development: Understand existing architecture and similar implementations
- Duplicate detection: Identify redundant or duplicated code patterns

If the codebase is not indexed, this tool will return a clear error message \
indicating that indexing is required first.`;

export const TOOL_DEFINITIONS = [
  {
    name: 'index_codebase',
    description: INDEX_DESCRIPTION,
    inputSchema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description: 'Absolute path to the codebase directory to index.',
        },
        project: {
          type: 'string',
          description: 'Project name (resolves via registry). Use list_indexed to see registered projects.',
        },
        force: {
          type: 'boolean',
          description: 'Force re-indexing even if already indexed',
          default: false,
        },
        dryRun: {
          type: 'boolean',
          description: 'Preview what would be indexed without actually indexing. Returns file counts by extension, top directories, estimated cost, and warnings.',
          default: false,
        },
        customExtensions: {
          type: 'array',
          items: { type: 'string' },
          description: 'Additional file extensions to include beyond defaults (e.g., [".dart", ".arb"]). Extensions should include the dot prefix.',
          default: [],
        },
        customIgnorePatterns: {
          type: 'array',
          items: { type: 'string' },
          description: 'Additional glob patterns to exclude (e.g., ["**/Pods/**", "**/DerivedData/**"]).',
          default: [],
        },
      },
      required: [],
    },
  },
  {
    name: 'search_code',
    description: SEARCH_DESCRIPTION,
    inputSchema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description: 'Absolute path to the codebase directory to search in.',
        },
        project: {
          type: 'string',
          description: 'Project name (resolves via registry). Use list_indexed to see registered projects.',
        },
        query: {
          type: 'string',
          description: 'Natural language query to search for in the codebase',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results to return',
          default: 10,
          maximum: 50,
        },
        extensionFilter: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional: List of file extensions to filter results (e.g., [".ts", ".py"]).',
          default: [],
        },
        compact: {
          type: 'boolean',
          description: 'Return compact table (file, lines, score, ~tokens) instead of full code snippets. Use Read tool to fetch interesting results. Default: true.',
          default: true,
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'clear_index',
    description: 'Clear the search index. Provide either `path` (absolute) or `project` (name). Use `list_indexed` to see registered projects.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description: 'Absolute path to the codebase directory to clear.',
        },
        project: {
          type: 'string',
          description: 'Project name (resolves via registry). Use list_indexed to see registered projects.',
        },
      },
      required: [],
    },
  },
  {
    name: 'get_indexing_status',
    description: 'Get the current indexing status of a codebase. Provide either `path` (absolute) or `project` (name). Use `list_indexed` to see registered projects.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description: 'Absolute path to the codebase directory to check status for.',
        },
        project: {
          type: 'string',
          description: 'Project name (resolves via registry). Use list_indexed to see registered projects.',
        },
      },
      required: [],
    },
  },
  {
    name: 'list_indexed',
    description: 'List all currently indexed codebases with their status. Returns paths, file/chunk counts, and indexing status for all known codebases in this session.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: '__IMPORTANT',
    description: 'Workflow guidance for efficient code search. ALWAYS index before searching. Use project names after first index. Use extensionFilter to narrow results.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
] as const;
