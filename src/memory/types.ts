export interface MemoryItem {
  id: string;
  memory: string;
  hash: string;
  category: string;
  source: string;
  project: string;
  access_count: number;
  last_accessed: string;
  created_at: string;
  updated_at: string;
}

export type MemoryEvent = 'ADD' | 'UPDATE' | 'DELETE';

export interface MemoryAction {
  event: MemoryEvent;
  id: string;
  memory: string;
  previous?: string;
  category?: string;
  source?: string;
  project?: string;
}

export interface ReconcileResult {
  action: 'ADD' | 'UPDATE' | 'NONE';
  existingId?: string;
  existingMemory?: string;
}

export interface ExtractedFact {
  fact: string;
  category: string;
  project?: string;
}
