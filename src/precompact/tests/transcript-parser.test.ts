import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { parseTranscript } from '../transcript-parser.js';
import { createTempCodebase, cleanupTempDir } from '../../__tests__/fixtures.js';
import fs from 'node:fs';
import path from 'node:path';

describe('parseTranscript', () => {
  let tmpDir: string;
  let transcriptPath: string;

  beforeAll(() => {
    tmpDir = createTempCodebase({});
    transcriptPath = path.join(tmpDir, 'transcript.jsonl');
  });

  afterAll(() => cleanupTempDir(tmpDir));

  const writeTranscript = (lines: string[]) => {
    fs.writeFileSync(transcriptPath, lines.join('\n'), 'utf-8');
  };

  describe('file extraction', () => {
    it('extracts file paths from Write tool calls', async () => {
      writeTranscript([
        '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Write","input":{"file_path":"/src/a.ts"}}]}}',
      ]);
      const result = await parseTranscript(transcriptPath, 'sess1', 'proj', '/proj');
      expect(result.filesModified).toContain('/src/a.ts');
    });

    it('extracts file paths from Edit tool calls', async () => {
      writeTranscript([
        '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Edit","input":{"file_path":"/src/b.ts"}}]}}',
      ]);
      const result = await parseTranscript(transcriptPath, 'sess1', 'proj', '/proj');
      expect(result.filesModified).toContain('/src/b.ts');
    });

    it('deduplicates multiple edits to same file', async () => {
      writeTranscript([
        '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Edit","input":{"file_path":"/src/a.ts"}}]}}',
        '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Edit","input":{"file_path":"/src/a.ts"}}]}}',
      ]);
      const result = await parseTranscript(transcriptPath, 'sess1', 'proj', '/proj');
      expect(result.filesModified).toEqual(['/src/a.ts']);
    });

    it('sorts file paths alphabetically', async () => {
      writeTranscript([
        '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Write","input":{"file_path":"/z.ts"}}]}}',
        '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Write","input":{"file_path":"/a.ts"}}]}}',
      ]);
      const result = await parseTranscript(transcriptPath, 'sess1', 'proj', '/proj');
      expect(result.filesModified).toEqual(['/a.ts', '/z.ts']);
    });
  });

  describe('bash command extraction', () => {
    it('extracts bash commands', async () => {
      writeTranscript([
        '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"npm test"}}]}}',
      ]);
      const result = await parseTranscript(transcriptPath, 'sess1', 'proj', '/proj');
      expect(result.bashCommands).toContain('npm test');
    });

    it('truncates long commands to 120 chars with ellipsis', async () => {
      const longCmd = 'x'.repeat(200);
      writeTranscript([
        `{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"${longCmd}"}}]}}`,
      ]);
      const result = await parseTranscript(transcriptPath, 'sess1', 'proj', '/proj');
      expect(result.bashCommands[0]).toHaveLength(120);
      expect(result.bashCommands[0].endsWith('…')).toBe(true);
    });

    it('limits to max 20 commands', async () => {
      const lines = Array.from({ length: 30 }, (_, i) =>
        `{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"cmd${i}"}}]}}`
      );
      writeTranscript(lines);
      const result = await parseTranscript(transcriptPath, 'sess1', 'proj', '/proj');
      expect(result.bashCommands).toHaveLength(20);
    });
  });

  describe('task extraction', () => {
    it('extracts TaskCreate subjects', async () => {
      writeTranscript([
        '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"TaskCreate","input":{"subject":"Fix bug"}}]}}',
      ]);
      const result = await parseTranscript(transcriptPath, 'sess1', 'proj', '/proj');
      expect(result.tasksCreated).toContain('Fix bug');
    });

    it('extracts TaskUpdate with status', async () => {
      writeTranscript([
        '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"TaskUpdate","input":{"subject":"Fix bug","status":"completed"}}]}}',
      ]);
      const result = await parseTranscript(transcriptPath, 'sess1', 'proj', '/proj');
      expect(result.tasksUpdated).toContain('Fix bug → completed');
    });

    it('handles TaskUpdate without subject gracefully', async () => {
      writeTranscript([
        '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"TaskUpdate","input":{"taskId":"1","status":"completed"}}]}}',
      ]);
      const result = await parseTranscript(transcriptPath, 'sess1', 'proj', '/proj');
      expect(result.tasksUpdated).toEqual([]);
    });
  });

  describe('MCP tool extraction', () => {
    it('extracts unique MCP tool names', async () => {
      writeTranscript([
        '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"mcp__eidetic__search_code","input":{}}]}}',
        '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"mcp__eidetic__search_code","input":{}}]}}',
        '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"mcp__slack__send_message","input":{}}]}}',
      ]);
      const result = await parseTranscript(transcriptPath, 'sess1', 'proj', '/proj');
      expect(result.mcpToolsCalled).toHaveLength(2);
      expect(result.mcpToolsCalled).toContain('mcp__eidetic__search_code');
      expect(result.mcpToolsCalled).toContain('mcp__slack__send_message');
    });
  });

  describe('metadata extraction', () => {
    it('extracts git branch from first entry with gitBranch', async () => {
      writeTranscript([
        '{"type":"user","gitBranch":"feat/auth","message":{"content":[]}}',
        '{"type":"user","gitBranch":"main","message":{"content":[]}}',
      ]);
      const result = await parseTranscript(transcriptPath, 'sess1', 'proj', '/proj');
      expect(result.branch).toBe('feat/auth');
    });

    it('extracts start and end timestamps', async () => {
      writeTranscript([
        '{"type":"user","timestamp":"2026-02-19T10:00:00Z","message":{"content":[]}}',
        '{"type":"user","timestamp":"2026-02-19T11:30:00Z","message":{"content":[]}}',
      ]);
      const result = await parseTranscript(transcriptPath, 'sess1', 'proj', '/proj');
      expect(result.startTime).toBe('2026-02-19T10:00:00Z');
      expect(result.endTime).toBe('2026-02-19T11:30:00Z');
    });

    it('sets default timestamps when missing', async () => {
      writeTranscript([
        '{"type":"user","message":{"content":[]}}',
      ]);
      const result = await parseTranscript(transcriptPath, 'sess1', 'proj', '/proj');
      expect(result.startTime).toBe('unknown');
      expect(result.endTime).toBe('unknown');
    });
  });

  describe('user message extraction', () => {
    it('extracts first 5 user messages', async () => {
      const lines = Array.from({ length: 10 }, (_, i) =>
        `{"type":"user","message":{"role":"user","content":[{"type":"text","text":"Message ${i}"}]}}`
      );
      writeTranscript(lines);
      const result = await parseTranscript(transcriptPath, 'sess1', 'proj', '/proj');
      expect(result.userMessages).toHaveLength(5);
      expect(result.userMessages[0]).toBe('Message 0');
    });

    it('truncates long messages to 200 chars with ellipsis', async () => {
      const longMsg = 'x'.repeat(300);
      writeTranscript([
        `{"type":"user","message":{"role":"user","content":[{"type":"text","text":"${longMsg}"}]}}`,
      ]);
      const result = await parseTranscript(transcriptPath, 'sess1', 'proj', '/proj');
      expect(result.userMessages[0]).toHaveLength(200);
      expect(result.userMessages[0].endsWith('…')).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('handles empty transcript', async () => {
      writeTranscript([]);
      const result = await parseTranscript(transcriptPath, 'sess1', 'proj', '/proj');
      expect(result.filesModified).toEqual([]);
      expect(result.bashCommands).toEqual([]);
    });

    it('skips malformed JSON lines', async () => {
      writeTranscript([
        'not valid json',
        '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Write","input":{"file_path":"/a.ts"}}]}}',
        '{ incomplete',
      ]);
      const result = await parseTranscript(transcriptPath, 'sess1', 'proj', '/proj');
      expect(result.filesModified).toEqual(['/a.ts']);
    });

    it('handles missing fields gracefully', async () => {
      writeTranscript([
        '{"type":"assistant"}',
        '{"type":"assistant","message":{}}',
        '{"type":"assistant","message":{"content":null}}',
      ]);
      const result = await parseTranscript(transcriptPath, 'sess1', 'proj', '/proj');
      expect(result.filesModified).toEqual([]);
    });

    it('preserves passed session metadata', async () => {
      writeTranscript([]);
      const result = await parseTranscript(transcriptPath, 'my-session', 'my-project', '/path/to/project');
      expect(result.sessionId).toBe('my-session');
      expect(result.projectName).toBe('my-project');
      expect(result.projectPath).toBe('/path/to/project');
    });

    it('uses provided trigger value', async () => {
      writeTranscript([]);
      const autoResult = await parseTranscript(transcriptPath, 's', 'p', '/p', 'auto');
      expect(autoResult.trigger).toBe('auto');

      const manualResult = await parseTranscript(transcriptPath, 's', 'p', '/p', 'manual');
      expect(manualResult.trigger).toBe('manual');
    });

    it('defaults trigger to auto', async () => {
      writeTranscript([]);
      const result = await parseTranscript(transcriptPath, 's', 'p', '/p');
      expect(result.trigger).toBe('auto');
    });
  });

  describe('with sample fixture', () => {
    it('parses sample transcript correctly', async () => {
      const fixturePath = path.join(__dirname, 'fixtures', 'sample-transcript.jsonl');
      const result = await parseTranscript(fixturePath, 'test-sess', 'test-proj', '/test');

      expect(result.branch).toBe('feat/auth');
      expect(result.filesModified).toContain('/project/src/auth.ts');
      expect(result.filesModified).toContain('/project/src/middleware/jwt.ts');
      expect(result.bashCommands).toContain('npm test');
      expect(result.tasksCreated).toContain('Implement refresh token logic');
      expect(result.tasksUpdated).toContain('Fix auth bug → completed');
      expect(result.mcpToolsCalled).toContain('mcp__eidetic__search_code');
      expect(result.userMessages[0]).toBe('Add JWT validation to the auth middleware');
    });
  });
});
