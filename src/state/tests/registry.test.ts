import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// We need to mock getRegistryPath to use a temp dir
let tmpDir: string;

vi.mock('../../paths.js', () => ({
  getRegistryPath: () => path.join(tmpDir, 'registry.json'),
  normalizePath: (p: string) => p,
  getDataDir: () => tmpDir,
}));

import { registerProject, resolveProject, listProjects } from '../registry.js';

describe('registry', () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eidetic-reg-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('registerProject stores by basename', () => {
    registerProject('/home/user/my-project');
    const resolved = resolveProject('my-project');
    expect(resolved).toBe('/home/user/my-project');
  });

  it('resolveProject is case-insensitive', () => {
    registerProject('/home/user/MyProject');
    expect(resolveProject('myproject')).toBe('/home/user/MyProject');
    expect(resolveProject('MYPROJECT')).toBe('/home/user/MyProject');
  });

  it('resolveProject returns undefined for unknown project', () => {
    expect(resolveProject('nonexistent')).toBeUndefined();
  });

  it('listProjects returns all registered', () => {
    registerProject('/a/project-one');
    registerProject('/b/project-two');
    const projects = listProjects();
    expect(projects['project-one']).toBe('/a/project-one');
    expect(projects['project-two']).toBe('/b/project-two');
  });
});
