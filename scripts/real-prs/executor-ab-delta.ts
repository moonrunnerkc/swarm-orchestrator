// Paired A/B over two recall record sets with the restoration executor as the
// only intended variable.
//
// The multi-ecosystem executor change is a coverage change: it makes Go and
// Python suites runnable where they previously died at spawn. It must not move a
// single verdict on an entry whose controls already executed, because those
// entries were always Node and their run path is unchanged. This script proves
// that rather than asserting it: same entries, same recorded SHA pair, same
// environment, one variable, and an empty verdict diff or a named regression.
//
// Usage:
//   node dist/scripts/real-prs/executor-ab-delta.js --before <dir> --after <dir>
//     [--arm deterministic|judge] [--out <file>] [--ids <a,b,c>]
//
// --before and --after are recall out-dirs (each holding records/<id>.<arm>.json).

import * as fs from 'fs';
import * as path from 'path';
import { getLogger } from '../../src/logger';

const log = getLogger('hunt:executor-ab-delta');

/** The record fields the comparison keys on. Everything else (wall-clock,
 *  workspace paths) is expected to differ run to run and is not a verdict. */
interface ComparableRecord {
  id: string;
  bucket: string;
  bucketStage?: string;
  pass: boolean | null;
  gateTriggers: string[];
  replayConfirmed: boolean | null;
  advisoryFindings: Array<{ category: string; severity: string }>;
  controlsEvaluated: number;
  enginesApplicable: number;
  enginesExecuted: number;
  abstains: Array<{ engine: string; verdict: string }>;
  environment?: Record<string, string | null>;
}

/** One entry's before/after comparison. */
interface DeltaRow {
  id: string;
  status: 'identical' | 'verdict-changed' | 'coverage-only' | 'missing-before' | 'missing-after';
  differences: string[];
  before: { bucket: string; controls: number; advisory: number } | null;
  after: { bucket: string; controls: number; advisory: number } | null;
}

function arg(flag: string, fallback: string | null): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1]! : fallback;
}

/** Every record for one arm under `dir/records`, keyed by entry id.
 *
 *  Filtering by arm is load-bearing, not tidiness: an out-dir holds
 *  `<id>.deterministic.json` and `<id>.judge.json` side by side, so reading every
 *  file lets one arm's record overwrite the other's and the comparison silently
 *  becomes deterministic-versus-judge, which differs for reasons that have
 *  nothing to do with the variable under test. */
function loadRecords(dir: string, arm: string): Map<string, ComparableRecord> {
  const recordsDir = path.join(dir, 'records');
  const out = new Map<string, ComparableRecord>();
  if (!fs.existsSync(recordsDir)) return out;
  const suffix = `.${arm}.json`;
  for (const file of fs.readdirSync(recordsDir)) {
    if (!file.endsWith(suffix)) continue;
    const rec = JSON.parse(fs.readFileSync(path.join(recordsDir, file), 'utf8')) as ComparableRecord;
    out.set(rec.id, rec);
  }
  return out;
}

/** A stable string for a finding multiset, so ordering never reads as a diff. */
function findingKey(findings: ReadonlyArray<{ category: string; severity: string }>): string {
  return [...findings.map((f) => `${f.category}:${f.severity}`)].sort().join(',');
}

/** A stable string for an abstention multiset. */
function abstainKey(abstains: ReadonlyArray<{ engine: string; verdict: string }>): string {
  return [...abstains.map((a) => `${a.engine}:${a.verdict}`)].sort().join(',');
}

/**
 * Compare one entry before and after.
 *
 * A verdict difference is any change to the bucket, the gate decision, the gate
 * triggers, or the finding multiset: those are what a published number is made
 * of. A coverage-only difference is a change to how many controls ran with every
 * verdict field identical, which is exactly what this change is allowed to do.
 *
 * @param before the record from the pre-change run.
 * @param after the record from the post-change run.
 * @returns the classified row.
 */
export function compareRecords(before: ComparableRecord, after: ComparableRecord): DeltaRow {
  const verdictDiffs: string[] = [];
  if (before.bucket !== after.bucket) {
    verdictDiffs.push(`bucket ${before.bucket} -> ${after.bucket}`);
  }
  if ((before.bucketStage ?? '') !== (after.bucketStage ?? '')) {
    verdictDiffs.push(`stage '${before.bucketStage ?? ''}' -> '${after.bucketStage ?? ''}'`);
  }
  if (before.pass !== after.pass) verdictDiffs.push(`pass ${before.pass} -> ${after.pass}`);
  if (before.gateTriggers.slice().sort().join(',') !== after.gateTriggers.slice().sort().join(',')) {
    verdictDiffs.push(`triggers [${before.gateTriggers}] -> [${after.gateTriggers}]`);
  }
  if (before.replayConfirmed !== after.replayConfirmed) {
    verdictDiffs.push(`replayConfirmed ${before.replayConfirmed} -> ${after.replayConfirmed}`);
  }
  if (findingKey(before.advisoryFindings) !== findingKey(after.advisoryFindings)) {
    verdictDiffs.push(
      `findings [${findingKey(before.advisoryFindings)}] -> [${findingKey(after.advisoryFindings)}]`,
    );
  }
  const coverageDiffs: string[] = [];
  if (before.controlsEvaluated !== after.controlsEvaluated) {
    coverageDiffs.push(`controlsEvaluated ${before.controlsEvaluated} -> ${after.controlsEvaluated}`);
  }
  if (before.enginesExecuted !== after.enginesExecuted) {
    coverageDiffs.push(`enginesExecuted ${before.enginesExecuted} -> ${after.enginesExecuted}`);
  }
  if (abstainKey(before.abstains) !== abstainKey(after.abstains)) {
    coverageDiffs.push(`abstains [${abstainKey(before.abstains)}] -> [${abstainKey(after.abstains)}]`);
  }
  const summary = (r: ComparableRecord): { bucket: string; controls: number; advisory: number } => ({
    bucket: r.bucket,
    controls: r.controlsEvaluated,
    advisory: r.advisoryFindings.length,
  });
  const status =
    verdictDiffs.length > 0 ? 'verdict-changed' : coverageDiffs.length > 0 ? 'coverage-only' : 'identical';
  return {
    id: before.id,
    status,
    differences: [...verdictDiffs, ...coverageDiffs],
    before: summary(before),
    after: summary(after),
  };
}

function main(): void {
  const beforeDir = arg('--before', null);
  const afterDir = arg('--after', null);
  if (beforeDir === null || afterDir === null) {
    throw new Error('pass --before <dir> --after <dir>');
  }
  const idsArg = arg('--ids', null);
  const only =
    idsArg === null
      ? null
      : new Set(
          idsArg
            .split(',')
            .map((s) => s.trim())
            .filter((s) => s.length > 0),
        );
  const arm = arg('--arm', 'deterministic')!;
  const before = loadRecords(beforeDir, arm);
  const after = loadRecords(afterDir, arm);
  const ids = [...new Set([...before.keys(), ...after.keys()])]
    .filter((id) => only === null || only.has(id))
    .sort();

  const rows: DeltaRow[] = [];
  for (const id of ids) {
    const b = before.get(id);
    const a = after.get(id);
    if (b === undefined) {
      rows.push({ id, status: 'missing-before', differences: [], before: null, after: null });
      continue;
    }
    if (a === undefined) {
      rows.push({ id, status: 'missing-after', differences: [], before: null, after: null });
      continue;
    }
    rows.push(compareRecords(b, a));
  }

  const verdictChanged = rows.filter((r) => r.status === 'verdict-changed');
  const out = {
    computedBy: 'scripts/real-prs/executor-ab-delta.ts',
    beforeDir,
    afterDir,
    arm,
    entriesCompared: rows.filter((r) => r.before !== null).length,
    verdictDiffEmpty: verdictChanged.length === 0,
    counts: rows.reduce<Record<string, number>>((acc, r) => {
      acc[r.status] = (acc[r.status] ?? 0) + 1;
      return acc;
    }, {}),
    rows,
  };
  const outFile = arg('--out', null);
  const json = `${JSON.stringify(out, null, 2)}\n`;
  if (outFile !== null) {
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, json);
    log.info(`wrote ${outFile}`);
  } else {
    log.info(json);
  }
  for (const row of rows) {
    log.info(`${row.status}: ${row.id}${row.differences.length > 0 ? ` (${row.differences.join('; ')})` : ''}`);
  }
  if (verdictChanged.length > 0) {
    log.error(`VERDICT DIFF NOT EMPTY: ${verdictChanged.length} entries changed verdict`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();
