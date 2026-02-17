import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/**
 * Create a temp directory populated with the given files.
 * Keys are relative paths, values are file contents.
 */
export function createTempCodebase(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eidetic-test-'));
  for (const [relPath, content] of Object.entries(files)) {
    const fullPath = path.join(dir, relPath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content, 'utf-8');
  }
  return dir;
}

export function cleanupTempDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

export const SAMPLE_TS = `
export function greet(name: string): string {
  return \`Hello, \${name}!\`;
}

export class Calculator {
  add(a: number, b: number): number {
    return a + b;
  }

  subtract(a: number, b: number): number {
    return a - b;
  }
}
`.trimStart();

export const SAMPLE_PY = `
def greet(name: str) -> str:
    return f"Hello, {name}!"

class Calculator:
    def add(self, a: int, b: int) -> int:
        return a + b

    def subtract(self, a: int, b: int) -> int:
        return a - b
`.trimStart();

export const SAMPLE_JS = `
function greet(name) {
  return \`Hello, \${name}!\`;
}

class Calculator {
  add(a, b) {
    return a + b;
  }

  subtract(a, b) {
    return a - b;
  }
}

module.exports = { greet, Calculator };
`.trimStart();
