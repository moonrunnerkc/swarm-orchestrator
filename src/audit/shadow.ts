// Shadow-mode persistence. Records audit verdicts to disk without
// posting a comment so operators can compare the tool's signal
// against the human merge decision over time.
//
// Layout: `<shadowDir>/<repo>/<run-id>.json`. Each file is one audit
// run; the repo segment is the literal label passed on `--shadow`
// (the operator's choice, often `org/repo`). The runId is the same
// audit run-id that names the hash-chained ledger.
//
// The shape is intentionally JSON-serializable and stable. A
// downstream analyzer reads the directory, joins each entry against
// the upstream PR's merge / revert / review-flag history, and reports
// top-decile suspicion-score concentration.

import * as fs from 'fs';
import * as path from 'path';
import type { AuditMode, AuditResult, DetectorSetName, AuditInput } from './types';

export interface ShadowEntry {
  schemaVersion: 1;
  recordedAt: string;
  runId: string;
  repo: string;
  mode: AuditMode;
  detectorSet: DetectorSetName;
  wallTimeMs: number;
  pr?: AuditInput['pr'];
  result: AuditResult;
}

export function writeShadowEntry(
  shadowDir: string,
  repoLabel: string,
  runId: string,
  payload: {
    mode: AuditMode;
    detectorSet: DetectorSetName;
    result: AuditResult;
    wallTimeMs: number;
    pr?: AuditInput['pr'];
  },
): string {
  const safeRepo = sanitizeRepoLabel(repoLabel);
  const dir = path.join(shadowDir, safeRepo);
  fs.mkdirSync(dir, { recursive: true });
  const entry: ShadowEntry = {
    schemaVersion: 1,
    recordedAt: new Date().toISOString(),
    runId,
    repo: repoLabel,
    mode: payload.mode,
    detectorSet: payload.detectorSet,
    wallTimeMs: payload.wallTimeMs,
    result: payload.result,
  };
  if (payload.pr !== undefined) entry.pr = payload.pr;
  const file = path.join(dir, `${runId}.json`);
  fs.writeFileSync(file, JSON.stringify(entry, null, 2) + '\n');
  return file;
}

/**
 * Replace path separators and other filesystem-hostile characters with
 * a single dash. We keep the rest of the label intact so the directory
 * name is human-readable in `ls`.
 */
function sanitizeRepoLabel(label: string): string {
  return label.replace(/[\\/]/g, '-').replace(/[^A-Za-z0-9._-]/g, '-');
}

export function listShadowEntries(shadowDir: string, repoLabel?: string): ShadowEntry[] {
  if (!fs.existsSync(shadowDir)) return [];
  const out: ShadowEntry[] = [];
  const repos = repoLabel !== undefined
    ? [sanitizeRepoLabel(repoLabel)]
    : fs.readdirSync(shadowDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);
  for (const repo of repos) {
    const dir = path.join(shadowDir, repo);
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.json')) continue;
      const text = fs.readFileSync(path.join(dir, name), 'utf8');
      const parsed = JSON.parse(text) as ShadowEntry;
      out.push(parsed);
    }
  }
  return out;
}
