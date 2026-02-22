/**
 * Shared query loader for eval scripts.
 *
 * Reads ground-truth.json and provides typed access + convenience filters
 * used by recall-at-k, ndcg, and fusion-lift.
 */

import fs from 'node:fs';
import path from 'node:path';

export interface EvalQuery {
  id: string;
  text: string;
  type: 'identifier' | 'natural';
  source: 'hand' | 'generated';
  expectedFile: string;
  expectedStartLine: number;
  expectedEndLine: number;
  targetSymbol?: string;
}

export interface GroundTruth {
  version: number;
  generated_at: string;
  queries: EvalQuery[];
}

const GROUND_TRUTH_PATH = path.join(import.meta.dirname, 'ground-truth.json');

export function loadGroundTruth(): GroundTruth {
  const raw = fs.readFileSync(GROUND_TRUTH_PATH, 'utf-8');
  const data = JSON.parse(raw) as GroundTruth;
  if (data.version !== 1) {
    throw new Error(`Unsupported ground-truth.json version: ${data.version}`);
  }
  return data;
}

export function identifierQueries(gt = loadGroundTruth()): EvalQuery[] {
  return gt.queries.filter(q => q.type === 'identifier');
}

export function naturalQueries(gt = loadGroundTruth()): EvalQuery[] {
  return gt.queries.filter(q => q.type === 'natural');
}

export function handQueries(gt = loadGroundTruth()): EvalQuery[] {
  return gt.queries.filter(q => q.source === 'hand');
}

export function allQueryTexts(gt = loadGroundTruth()): string[] {
  return gt.queries.map(q => q.text);
}
