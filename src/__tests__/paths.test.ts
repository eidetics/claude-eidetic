import { describe, it, expect } from 'vitest';
import { normalizePath, pathToCollectionName, docCollectionName } from '../paths.js';

describe('normalizePath', () => {
  it('converts backslashes to forward slashes', () => {
    const result = normalizePath('C:\\Users\\test\\project');
    expect(result).not.toContain('\\');
    expect(result).toContain('/');
  });

  it('removes trailing slash', () => {
    const result = normalizePath('/home/user/project/');
    expect(result.endsWith('/')).toBe(false);
  });

  it('resolves relative paths to absolute', () => {
    const result = normalizePath('relative/path');
    expect(result).toContain('/');
    // Should be absolute (starts with / or drive letter)
    expect(result.length).toBeGreaterThan('relative/path'.length);
  });

  it('expands tilde to home directory', () => {
    const result = normalizePath('~/projects');
    expect(result).not.toContain('~');
    expect(result).toContain('projects');
  });

  it('preserves root path without removing slash', () => {
    // Single character root "/" should not be stripped
    const result = normalizePath('/');
    expect(result.length).toBeGreaterThanOrEqual(1);
  });
});

describe('pathToCollectionName', () => {
  it('produces eidetic_ prefix', () => {
    const result = pathToCollectionName('/home/user/project');
    expect(result.startsWith('eidetic_')).toBe(true);
  });

  it('lowercases everything', () => {
    const result = pathToCollectionName('/Home/User/MyProject');
    expect(result).toBe(result.toLowerCase());
  });

  it('replaces non-alphanumeric chars with underscores', () => {
    const result = pathToCollectionName('/home/user/my-project.v2');
    // Should only contain lowercase alphanumeric and underscores (plus eidetic_ prefix)
    expect(result).toMatch(/^eidetic_[a-z0-9_]+$/);
  });

  it('collapses consecutive underscores', () => {
    const result = pathToCollectionName('/home//user///project');
    expect(result).not.toContain('__');
  });

  it('strips leading and trailing underscores from the safe portion', () => {
    const result = pathToCollectionName('/home/user/project');
    // After eidetic_ prefix, the rest should not start or end with _
    const safePart = result.slice('eidetic_'.length);
    expect(safePart.startsWith('_')).toBe(false);
    expect(safePart.endsWith('_')).toBe(false);
  });

  it('is deterministic', () => {
    const a = pathToCollectionName('/home/user/project');
    const b = pathToCollectionName('/home/user/project');
    expect(a).toBe(b);
  });
});

describe('docCollectionName', () => {
  it('produces doc_ prefix', () => {
    expect(docCollectionName('react')).toBe('doc_react');
  });

  it('lowercases the library name', () => {
    expect(docCollectionName('React')).toBe('doc_react');
    expect(docCollectionName('LANGFUSE')).toBe('doc_langfuse');
  });

  it('replaces non-alphanumeric chars with underscores', () => {
    expect(docCollectionName('my-library.js')).toMatch(/^doc_[a-z0-9_]+$/);
  });

  it('collapses consecutive underscores', () => {
    const result = docCollectionName('my--lib');
    expect(result).not.toContain('__');
  });

  it('strips leading and trailing underscores from safe portion', () => {
    const result = docCollectionName('-react-');
    const safePart = result.slice('doc_'.length);
    expect(safePart.startsWith('_')).toBe(false);
    expect(safePart.endsWith('_')).toBe(false);
  });

  it('is deterministic', () => {
    expect(docCollectionName('langfuse')).toBe(docCollectionName('langfuse'));
  });
});
