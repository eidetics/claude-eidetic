/**
 * Shared utilities for precompact module.
 */

import path from 'node:path';
import fs from 'node:fs';
import { getConfig } from '../config.js';
import { normalizePath } from '../paths.js';

/**
 * Extract YYYY-MM-DD date from ISO timestamp or return today's date.
 */
export function extractDate(timestamp: string): string {
  if (timestamp === 'unknown' || !timestamp) {
    return new Date().toISOString().slice(0, 10);
  }
  // Handle ISO format: 2026-02-19T10:00:00Z
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(timestamp);
  if (match) {
    return match[1];
  }
  return new Date().toISOString().slice(0, 10);
}

/**
 * Get the notes directory for a project.
 * Uses paths.ts normalization for consistency.
 */
export function getNotesDir(projectName: string): string {
  const config = getConfig();
  // Expand ~ and normalize path
  const dataDir = normalizePath(config.eideticDataDir);
  return path.join(dataDir, 'notes', projectName);
}

/**
 * Truncate a string to maxLength with proper Unicode handling.
 * Avoids splitting surrogate pairs (emoji, CJK characters).
 * Adds ellipsis if truncated.
 */
export function truncateUnicode(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;

  // Convert to array of code points to handle surrogate pairs correctly
  const codePoints = Array.from(str);
  if (codePoints.length <= maxLength) return str;

  // Leave room for ellipsis
  const truncated = codePoints.slice(0, maxLength - 1).join('');
  return truncated + '…';
}

/**
 * Write file atomically using write-to-temp-then-rename pattern.
 * Prevents corruption from concurrent writes or process termination.
 */
export function writeFileAtomic(filePath: string, content: string): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });

  // Create temp file in same directory (required for atomic rename)
  const tempPath = path.join(dir, `.tmp-${process.pid}-${Date.now()}`);

  try {
    fs.writeFileSync(tempPath, content, 'utf-8');
    fs.renameSync(tempPath, filePath);
  } catch (err) {
    // Clean up temp file on failure
    try {
      fs.unlinkSync(tempPath);
    } catch {
      // Ignore cleanup errors
    }
    throw err;
  }
}

/**
 * Generate a stable project identifier from path.
 * Handles project name collisions by including path hash.
 */
export function getProjectId(projectPath: string): string {
  const normalized = normalizePath(projectPath);
  const basename = path.basename(normalized);

  // Create short hash of full path to disambiguate same-named projects
  const hash = simpleHash(normalized).slice(0, 6);

  return `${basename}-${hash}`;
}

/**
 * Simple non-cryptographic hash for path disambiguation.
 */
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(36);
}
