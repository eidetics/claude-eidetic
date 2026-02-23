import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { MemoryEvent } from './types.js';

export interface HistoryEntry {
  id: number;
  memory_id: string;
  previous_value: string | null;
  new_value: string | null;
  event: MemoryEvent;
  created_at: string;
  updated_at: string | null;
  source: string | null;
}

export class MemoryHistory {
  private db: Database.Database;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_id TEXT NOT NULL,
        previous_value TEXT,
        new_value TEXT,
        event TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT,
        source TEXT
      )
    `);
  }

  log(
    memoryId: string,
    event: MemoryEvent,
    newValue: string | null,
    previousValue: string | null = null,
    source: string | null = null,
    updatedAt: string | null = null,
  ): void {
    this.db
      .prepare(
        `
      INSERT INTO memory_history (memory_id, previous_value, new_value, event, created_at, updated_at, source)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(memoryId, previousValue, newValue, event, new Date().toISOString(), updatedAt, source);
  }

  getHistory(memoryId: string): HistoryEntry[] {
    return this.db
      .prepare('SELECT * FROM memory_history WHERE memory_id = ? ORDER BY created_at ASC')
      .all(memoryId) as HistoryEntry[];
  }

  close(): void {
    this.db.close();
  }
}
