import fs from 'node:fs';
import path from 'node:path';
import { getDocMetadataPath } from '../paths.js';

export interface DocEntry {
  library: string;
  topic: string;
  source: string;
  collectionName: string;
  indexedAt: string;
  ttlDays: number;
  totalChunks: number;
}

export interface DocMetadata {
  [key: string]: DocEntry;
}

function metadataKey(library: string, topic: string): string {
  return `${library.toLowerCase()}::${topic.toLowerCase()}`;
}

export function loadDocMetadata(): DocMetadata {
  const metadataPath = getDocMetadataPath();
  try {
    const data = fs.readFileSync(metadataPath, 'utf-8');
    return JSON.parse(data) as DocMetadata;
  } catch {
    return {};
  }
}

export function saveDocMetadata(metadata: DocMetadata): void {
  const metadataPath = getDocMetadataPath();
  const dir = path.dirname(metadataPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2) + '\n', 'utf-8');
}

export function upsertDocEntry(entry: DocEntry): void {
  const metadata = loadDocMetadata();
  const key = metadataKey(entry.library, entry.topic);
  metadata[key] = entry;
  saveDocMetadata(metadata);
}

export function removeDocEntry(library: string, topic: string): boolean {
  const metadata = loadDocMetadata();
  const key = metadataKey(library, topic);
  if (!(key in metadata)) return false;
  delete metadata[key];
  saveDocMetadata(metadata);
  return true;
}

export function findDocEntries(library: string): DocEntry[] {
  const metadata = loadDocMetadata();
  const prefix = `${library.toLowerCase()}::`;
  return Object.entries(metadata)
    .filter(([key]) => key.startsWith(prefix))
    .map(([, entry]) => entry);
}

export function isStale(entry: DocEntry): boolean {
  const indexedAt = new Date(entry.indexedAt).getTime();
  const now = Date.now();
  const ttlMs = entry.ttlDays * 24 * 60 * 60 * 1000;
  return now - indexedAt > ttlMs;
}

export function listDocLibraries(): string[] {
  const metadata = loadDocMetadata();
  const libs = new Set<string>();
  for (const entry of Object.values(metadata)) {
    libs.add(entry.library);
  }
  return [...libs].sort();
}
