// Content-addressed cache for LLM-judge answers. Replay invariant:
// the same (normalized diff sha256, pr title sha256, model id) tuple
// must return the same answer across runs, even years later, so the
// cache key is the only thing the lookup depends on.
//
// Cache layout: one JSON file per key under
// `<repoRoot>/.swarm/llm-judge-cache/<sha>.json`. The `.swarm/` tree is
// gitignored in consumer repos so no per-developer state leaks into
// commits.

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { JudgeAnswer } from './types';

export interface JudgeCacheEntry {
  schemaVersion: 1;
  diffSha: string;
  titleSha: string;
  modelId: string;
  answer: JudgeAnswer;
  reason?: string;
  recordedAt: string;
}

export interface JudgeCacheKeyInput {
  diff: string;
  title: string;
  modelId: string;
}

export function computeJudgeCacheKey(input: JudgeCacheKeyInput): {
  cacheKey: string;
  diffSha: string;
  titleSha: string;
} {
  const diffSha = sha256(normalizeDiff(input.diff));
  const titleSha = sha256(input.title);
  const cacheKey = sha256(`${diffSha}|${titleSha}|${input.modelId}`);
  return { cacheKey, diffSha, titleSha };
}

export function readCachedAnswer(
  repoRoot: string,
  cacheKey: string,
): JudgeCacheEntry | undefined {
  const file = cacheFile(repoRoot, cacheKey);
  if (!fs.existsSync(file)) return undefined;
  const text = fs.readFileSync(file, 'utf8');
  const parsed = JSON.parse(text) as JudgeCacheEntry;
  if (parsed.schemaVersion !== 1) return undefined;
  return parsed;
}

export function writeCachedAnswer(
  repoRoot: string,
  cacheKey: string,
  entry: Omit<JudgeCacheEntry, 'schemaVersion' | 'recordedAt'>,
): void {
  const file = cacheFile(repoRoot, cacheKey);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const out: JudgeCacheEntry = {
    schemaVersion: 1,
    recordedAt: new Date().toISOString(),
    ...entry,
  };
  fs.writeFileSync(file, JSON.stringify(out, null, 2) + '\n');
}

function cacheFile(repoRoot: string, cacheKey: string): string {
  return path.join(repoRoot, '.swarm', 'llm-judge-cache', `${cacheKey}.json`);
}

function sha256(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

// Strip trailing whitespace per line and the trailing newline so a
// diff that only differs in EOL style hashes identically. We do not
// strip leading `diff --git` headers or chunk markers; those are part
// of what makes one PR distinct from another.
function normalizeDiff(diff: string): string {
  const lines = diff.split('\n').map((line) => line.replace(/[ \t]+$/u, ''));
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines.join('\n');
}
