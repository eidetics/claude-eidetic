import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { registerProject, resolveProject, listProjects, findProjectByPath } from '../registry.js';

let tmpDir: string;

vi.mock('../../paths.js', () => ({
  getRegistryPath: () => path.join(tmpDir, 'registry.json'),
  normalizePath: (p: string) => p,
  getDataDir: () => tmpDir,
}));

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

  describe('findProjectByPath', () => {
    it('returns exact match', () => {
      registerProject('/home/user/my-project');
      expect(findProjectByPath('/home/user/my-project')).toBe('/home/user/my-project');
    });

    it('returns match for subdirectory', () => {
      registerProject('/home/user/my-project');
      expect(findProjectByPath('/home/user/my-project/src/lib')).toBe('/home/user/my-project');
    });

    it('returns undefined for unrelated path', () => {
      registerProject('/home/user/my-project');
      expect(findProjectByPath('/home/user/other')).toBeUndefined();
    });

    it('picks the longest (most specific) match', () => {
      registerProject('/home/user/workspace');
      registerProject('/home/user/workspace/nested');
      expect(findProjectByPath('/home/user/workspace/nested/src')).toBe(
        '/home/user/workspace/nested',
      );
    });

    it('is case-insensitive and normalizes backslashes', () => {
      registerProject('/home/user/MyProject');
      expect(findProjectByPath('\\home\\user\\MyProject\\src')).toBe('/home/user/MyProject');
    });
  });
});
