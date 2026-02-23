import { describe, it, expect, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';

/**
 * MCP protocol test — spawns the actual server process.
 *
 * Requires OPENAI_API_KEY set to a valid key (or use a mock server).
 * Tests are skipped if the server fails to start (e.g. no API key).
 */

const SERVER_PATH = path.resolve('dist/index.js');

interface JsonRpcResponse {
  jsonrpc: string;
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

class McpTestClient {
  private proc: ChildProcess;
  private buffer = '';
  private messageId = 0;
  private pendingResolves = new Map<number, (value: JsonRpcResponse) => void>();
  private ready: Promise<boolean>;

  constructor() {
    // Minimal env to avoid leaking credentials or hitting production services
    this.proc = spawn('node', [SERVER_PATH], {
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        USERPROFILE: process.env.USERPROFILE,
        SystemRoot: process.env.SystemRoot,
        NODE_PATH: process.env.NODE_PATH,
        OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? 'test-key',
        QDRANT_URL: 'http://localhost:6333',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.proc.stdout!.on('data', (data: Buffer) => {
      this.buffer += data.toString();
      this.processBuffer();
    });

    // Capture server ready by sending initialize
    this.ready = this.initialize();
  }

  private processBuffer(): void {
    // MCP uses Content-Length header framing
    while (true) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) break;

      const header = this.buffer.slice(0, headerEnd);
      const match = /Content-Length:\s*(\d+)/i.exec(header);
      if (!match) {
        // Skip invalid header
        this.buffer = this.buffer.slice(headerEnd + 4);
        continue;
      }

      const contentLength = parseInt(match[1], 10);
      const bodyStart = headerEnd + 4;
      if (this.buffer.length < bodyStart + contentLength) break; // incomplete body

      const body = this.buffer.slice(bodyStart, bodyStart + contentLength);
      this.buffer = this.buffer.slice(bodyStart + contentLength);

      try {
        const msg = JSON.parse(body) as JsonRpcResponse;
        const resolve = this.pendingResolves.get(msg.id);
        if (resolve) {
          this.pendingResolves.delete(msg.id);
          resolve(msg);
        }
      } catch {
        // Skip unparseable messages
      }
    }
  }

  private send(method: string, params: unknown = {}): Promise<JsonRpcResponse> {
    const id = ++this.messageId;
    const msg = JSON.stringify({ jsonrpc: '2.0', id, method, params });
    const frame = `Content-Length: ${Buffer.byteLength(msg)}\r\n\r\n${msg}`;

    return new Promise((resolve, reject) => {
      this.pendingResolves.set(id, resolve);

      const timeout = setTimeout(() => {
        this.pendingResolves.delete(id);
        reject(new Error(`Timeout waiting for response to ${method} (id=${id})`));
      }, 10_000);

      // Clear timeout when resolved
      const origResolve = this.pendingResolves.get(id)!;
      this.pendingResolves.set(id, (val) => {
        clearTimeout(timeout);
        origResolve(val);
      });

      this.proc.stdin!.write(frame);
    });
  }

  private async initialize(): Promise<boolean> {
    try {
      const resp = await this.send('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0.0' },
      });
      return resp.result !== undefined;
    } catch {
      return false;
    }
  }

  async isReady(): Promise<boolean> {
    return this.ready;
  }

  async listTools(): Promise<JsonRpcResponse> {
    return this.send('tools/list', {});
  }

  async callTool(name: string, args: unknown = {}): Promise<JsonRpcResponse> {
    return this.send('tools/call', { name, arguments: args });
  }

  kill(): void {
    this.proc.kill();
  }
}

// Only run if server can start (needs valid API key + Qdrant for full tests)
let client: McpTestClient | null = null;
let serverAvailable = false;

try {
  client = new McpTestClient();
  serverAvailable = await client.isReady();
} catch {
  serverAvailable = false;
}

const describeIfServer = serverAvailable ? describe : describe.skip;

afterAll(() => {
  client?.kill();
});

describeIfServer('MCP protocol', () => {
  it('tools/list returns 9 tools', async () => {
    const resp = await client!.listTools();
    expect(resp.error).toBeUndefined();
    const tools = (resp.result as { tools: { name: string }[] }).tools;
    expect(tools).toHaveLength(9);
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      '__IMPORTANT',
      'clear_index',
      'get_indexing_status',
      'index_codebase',
      'index_document',
      'list_indexed',
      'read_file',
      'search_code',
      'search_documents',
    ]);
  });

  it('tools/call list_indexed returns content', async () => {
    const resp = await client!.callTool('list_indexed');
    expect(resp.error).toBeUndefined();
    const result = resp.result as { content: { type: string; text: string }[] };
    expect(result.content).toBeDefined();
    expect(result.content[0].type).toBe('text');
  });

  it('tools/call get_indexing_status with missing path returns error text', async () => {
    const resp = await client!.callTool('get_indexing_status', {});
    expect(resp.error).toBeUndefined();
    const result = resp.result as { content: { type: string; text: string }[] };
    expect(result.content[0].text).toContain('Error');
  });

  it('unknown tool returns isError', async () => {
    const resp = await client!.callTool('nonexistent_tool', {});
    expect(resp.error).toBeUndefined(); // JSON-RPC level is fine
    const result = resp.result as { content: { type: string; text: string }[]; isError?: boolean };
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Unknown tool');
  });
});
