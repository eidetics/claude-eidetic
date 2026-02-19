import fs from 'node:fs';
import path from 'node:path';
import { pathToCollectionName, getSnapshotDir } from '../paths.js';
import type { FileSnapshot } from './sync.js';

function getSnapshotPath(rootPath: string): string {
  const name = pathToCollectionName(rootPath);
  return path.join(getSnapshotDir(), `${name}.json`);
}

export function loadSnapshot(rootPath: string): FileSnapshot | null {
  const filePath = getSnapshotPath(rootPath);
  try {
    const data = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(data) as FileSnapshot;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    console.warn(`Corrupted snapshot at ${filePath}, ignoring: ${err}`);
    return null;
  }
}

export function saveSnapshot(rootPath: string, snapshot: FileSnapshot): void {
  const filePath = getSnapshotPath(rootPath);
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(snapshot));
}

export function deleteSnapshot(rootPath: string): void {
  const filePath = getSnapshotPath(rootPath);
  try {
    fs.unlinkSync(filePath);
  } catch {
    // ignore — file may already be gone
  }
}

export function snapshotExists(rootPath: string): boolean {
  return fs.existsSync(getSnapshotPath(rootPath));
}
