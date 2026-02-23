#!/usr/bin/env node
/**
 * PostToolUse hook entry point.
 *
 * Receives hook data via stdin when Write or Edit tools are used.
 * Maintains a shadow git index per session to track which files were
 * modified, without touching HEAD or the working index.
 *
 * Shadow index: <git-dir>/claude/indexes/<session-id>/index
 * Base commit:  <git-dir>/claude/indexes/<session-id>/base_commit
 */

import { z } from 'zod';
import path from 'node:path';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const PostToolUseInputSchema = z.object({
  session_id: z.string(),
  cwd: z.string(),
  hook_event_name: z.literal('PostToolUse'),
  tool_name: z.string(),
  tool_input: z
    .object({
      file_path: z.string().optional(),
    })
    .passthrough(),
});

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

function outputSuccess(): void {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: {} }));
}

function outputError(message: string): void {
  process.stderr.write(`[eidetic:post-tool-use] ${message}\n`);
  process.stdout.write(JSON.stringify({ hookSpecificOutput: {} }));
}

async function main(): Promise<void> {
  try {
    const input = await readStdin();
    const parseResult = PostToolUseInputSchema.safeParse(JSON.parse(input));

    if (!parseResult.success) {
      outputError(`Invalid hook input: ${parseResult.error.message}`);
      return;
    }

    const { session_id, cwd, tool_name, tool_input } = parseResult.data;

    // Safety check beyond matcher — only process Write and Edit
    if (tool_name !== 'Write' && tool_name !== 'Edit') {
      outputSuccess();
      return;
    }

    const filePath = tool_input.file_path;
    if (!filePath) {
      outputSuccess();
      return;
    }

    // Resolve git dir
    let gitDir: string;
    try {
      gitDir = execFileSync('git', ['-C', cwd, 'rev-parse', '--git-dir'], {
        encoding: 'utf-8',
        timeout: 5000,
      }).trim();
    } catch {
      // Not a git repo — silently skip
      outputSuccess();
      return;
    }

    if (!path.isAbsolute(gitDir)) {
      gitDir = path.resolve(cwd, gitDir);
    }

    const shadowDir = path.join(gitDir, 'claude', 'indexes', session_id);
    const shadowIndex = path.join(shadowDir, 'index');
    const baseCommitFile = path.join(shadowDir, 'base_commit');

    // First call for this session: seed shadow index from HEAD
    if (!fs.existsSync(shadowIndex)) {
      fs.mkdirSync(shadowDir, { recursive: true });

      let headSha: string;
      try {
        headSha = execFileSync('git', ['-C', cwd, 'rev-parse', 'HEAD'], {
          encoding: 'utf-8',
          timeout: 5000,
        }).trim();
      } catch {
        // Empty repo / no commits — cannot seed from HEAD
        outputSuccess();
        return;
      }

      // Seed shadow index from HEAD tree
      execFileSync('git', ['-C', cwd, 'read-tree', `--index-output=${shadowIndex}`, 'HEAD'], {
        timeout: 5000,
      });

      fs.writeFileSync(baseCommitFile, headSha, 'utf-8');
    }

    // Stage the file into the shadow index
    const absoluteFilePath = path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath);

    execFileSync('git', ['-C', cwd, 'add', absoluteFilePath], {
      env: { ...process.env, GIT_INDEX_FILE: shadowIndex },
      timeout: 5000,
    });

    outputSuccess();
  } catch (err) {
    outputError(err instanceof Error ? err.message : String(err));
  }
}

void main();
