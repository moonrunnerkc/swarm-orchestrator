// Score the block triggers against revert/hotfix ground truth. Replays each
// trigger over the committed corpus facts (the execution-grounded results and
// the structural audit findings already on disk) rather than re-running the
// sandbox, so the calibration regenerates deterministically from what is
// committed. Two corpora:
//
//   - regression-corpus: merged PRs proven bad by a later revert or fix-PR.
//     Every firing here is a confirmed true positive.
//   - real-prs clean v2: merged PRs with no such proof. A firing here is a
//     false positive.
//
// precision per trigger = (firings on reverted/hotfixed PRs) / (all firings).
// Writes benchmarks/real-corpus/trigger-calibration.json for
// compute-block-eligibility to read.

import * as fs from 'fs';
import * as path from 'path';
import { parsePrIntent } from '../../src/audit/cheat-detector/pr-intent';
import { parseIssueReferences } from '../../src/audit/execution-grounded/issue-repro';
import type { ReproComparison } from '../../src/audit/execution-grounded';
import type { ExecutionSignals } from '../../src/audit/execution-grounded/corroborate';
import { detectBlockTriggers } from '../../src/audit/gate/block-triggers';
import { calibrateTriggers, type TriggerFiringRecord } from '../../src/audit/gate/calibrate-triggers';
import type { BlockTriggerKind } from '../../src/audit/gate/block-trigger-types';
import { wasRevertedOrHotfixed, type Proof } from '../../src/audit/gate/revert-proof';
import type { CheatCategory, Finding, Severity } from '../../src/audit/types';
import { repoSlug } from '../real-prs/lib/paths';
import { getLogger } from '../../src/logger';
import type { RestorationProofRecord } from '../../src/audit/execution-grounded/test-restoration';

const log = getLogger('gate:calibration');

interface SourcePr {
  repo: string;
  prNumber: number;
  title?: string;
  bodyExcerpt?: string;
  proofs?: Proof[];
}

interface RawStructuralFinding {
  category?: string;
  severity?: string;
  subjectPath?: string;
  lineRange?: { start: number; end: number };
  evidence?: string;
  message?: string;
}

interface EgFinding {
  category: string;
  location: { file: string; line: number };
  evidence?: string;
}

interface EgRepro {
  issue: { owner: string; repo: string; number: number };
  verdict: string;
  preStatus?: string;
  postStatus?: string;
}

interface EgResult {
  findings?: EgFinding[];
  repros?: EgRepro[];
  /** Persisted by run-execution-grounded since the uncovered-survivor
   *  findings aggregate per file: the per-line signals can no longer be
   *  reconstructed from finding locations, so the runner stores them. */
  signals?: ExecutionSignals;
}

function readJson<T>(file: string): T | null {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

function toSeverity(raw: string | undefined): Severity {
  return raw === 'block' || raw === 'info' ? raw : 'warn';
}

/** Load the structural cheat findings for a PR from its audit-result file,
 *  mapping the persisted `post` shape (subjectPath, lineRange) onto Finding. */
function loadStructural(file: string): Finding[] {
  const raw = readJson<{ post?: RawStructuralFinding[] }>(file);
  if (raw === null || !Array.isArray(raw.post)) return [];
  const out: Finding[] = [];
  for (const f of raw.post) {
    if (f.category === undefined || f.subjectPath === undefined) continue;
    const line = f.lineRange?.start ?? 1;
    out.push({
      category: f.category as CheatCategory,
      severity: toSeverity(f.severity),
      message: f.message ?? '',
      location: { file: f.subjectPath, line, endLine: f.lineRange?.end ?? line },
      evidence: f.evidence ?? '',
    });
  }
  return out;
}

/** Load restoration proof records if present (for test-tamper-proven replay from
 *  the committed execution-grounded restoration outputs). */
function loadRestorations(egDir: string, slug: string, prNumber: number): RestorationProofRecord[] {
  const file = path.join(egDir, slug, String(prNumber), 'restoration-proof.json');
  const proof = readJson<{ records?: RestorationProofRecord[] }>(file);
  return proof?.records ?? [];
}

/** Derive the execution signals from a PR's persisted execution-grounded
 *  findings: a surviving (covered or uncovered) mutant becomes a surviving
 *  mutant, an uncovered changed line a coverage gap, a still-failing repro a
 *  repro failure. The same mapping executionSignalsFromOutcome makes from a
 *  live run, applied to the recorded findings. */
function signalsFrom(eg: EgResult | null): ExecutionSignals {
  // Prefer the signals the runner persisted (exact per-line data even when the
  // findings aggregate); fall back to finding-derived signals for results
  // recorded before the runner stored them, whose findings are 1:1 per line.
  if (eg?.signals !== undefined) return eg.signals;
  const signals: ExecutionSignals = { survivingMutants: [], coverageGaps: [], reproFailures: [] };
  for (const f of eg?.findings ?? []) {
    if (
      f.category === 'mutation-survives-on-changed-line' ||
      f.category === 'mutation-survives-on-uncovered-changed-line'
    ) {
      signals.survivingMutants.push({
        file: f.location.file,
        line: f.location.line,
        id: f.evidence ?? `${f.location.file}:${f.location.line}`,
      });
    } else if (f.category === 'uncovered-changed-line') {
      signals.coverageGaps.push({ file: f.location.file, line: f.location.line });
    } else if (f.category === 'issue-repro-still-fails') {
      signals.reproFailures.push({ issueRef: f.location.file });
    }
  }
  return signals;
}

/** Rebuild the minimal repro comparisons a T1 check needs from the recorded
 *  verdicts. The captured output is not persisted, but the verdict (the only
 *  thing that decides firing) is. */
function reprosFrom(eg: EgResult | null): ReproComparison[] {
  return (eg?.repros ?? []).map((r) => ({
    issue: r.issue,
    repro: { kind: 'script', language: 'js', code: '' },
    verdict: r.verdict as ReproComparison['verdict'],
    preStatus: r.preStatus ?? '',
    postStatus: r.postStatus ?? '',
    preOutput: '',
    postOutput: '',
  }));
}

function firedTriggers(
  pr: SourcePr,
  structural: Finding[],
  eg: EgResult | null,
  restorations: RestorationProofRecord[],
): BlockTriggerKind[] {
  const prText = `${pr.title ?? ''}\n\n${pr.bodyExcerpt ?? ''}`;
  const triggers = detectBlockTriggers({
    claimFalsified: {
      prIntent: parsePrIntent({ title: pr.title ?? '', body: pr.bodyExcerpt ?? '' }),
      linkedIssues: parseIssueReferences(prText),
      repros: reprosFrom(eg),
      testRunner: null,
    },
    corroborated: {
      findings: structural,
      signals: signalsFrom(eg),
      prRef: `${pr.repo}#${pr.prNumber}`,
    },
    ...(restorations.length > 0 ? { restorations: { restorations } } : {}),
  });
  return Array.from(new Set(triggers.map((t) => t.kind)));
}

interface CorpusInput {
  sourcesFile: string;
  auditDir: string;
  egDir: string;
  /** When set, the revert outcome for every PR (clean corpus is all false);
   *  otherwise it is read from each PR's proofs. */
  reverted?: boolean;
}

function buildRecords(input: CorpusInput): { records: TriggerFiringRecord[]; egRuns: number } {
  const parsed = readJson<{ prs?: SourcePr[] }>(input.sourcesFile);
  const prs = parsed?.prs ?? [];
  const records: TriggerFiringRecord[] = [];
  let egRuns = 0;
  for (const pr of prs) {
    const slug = repoSlug(pr.repo);
    const structural = loadStructural(path.join(input.auditDir, slug, `${pr.prNumber}.json`));
    const eg = readJson<EgResult>(path.join(input.egDir, slug, String(pr.prNumber), 'result.json'));
    if (eg !== null) egRuns += 1;
    const restorations = loadRestorations(input.egDir, slug, pr.prNumber);
    records.push({
      pr: `${pr.repo}#${pr.prNumber}`,
      fired: firedTriggers(pr, structural, eg, restorations),
      revertedOrHotfixed: input.reverted ?? wasRevertedOrHotfixed(pr.proofs ?? []),
    });
  }
  return { records, egRuns };
}

function main(): void {
  const root = process.cwd();
  const regression = buildRecords({
    sourcesFile: path.join(root, 'benchmarks', 'regression-corpus', 'sources.json'),
    auditDir: path.join(root, 'benchmarks', 'regression-corpus', 'audit-results'),
    egDir: path.join(root, 'benchmarks', 'regression-corpus', 'execution-grounded'),
  });
  const clean = buildRecords({
    sourcesFile: path.join(root, 'benchmarks', 'real-prs', 'sources-v2.json'),
    auditDir: path.join(root, 'benchmarks', 'real-prs', 'audit-results-v2'),
    egDir: path.join(root, 'benchmarks', 'real-prs', 'execution-grounded-clean'),
    reverted: false,
  });
  const records = [...regression.records, ...clean.records];
  const rows = calibrateTriggers(records);
  const out = {
    generatedAt: new Date().toISOString(),
    computedBy: 'scripts/gate/run-trigger-calibration.ts',
    corpus: {
      regressionPrs: regression.records.length,
      regressionEgRuns: regression.egRuns,
      cleanPrs: clean.records.length,
      cleanEgRuns: clean.egRuns,
      note:
        'Trigger firings replayed from committed execution-grounded results, structural audit ' +
        'findings, and restoration-proof.json (for test-tamper-proven). Revert/hotfix ground truth ' +
        'from the regression-corpus proofs. Triggers that need an execution-grounded run can only ' +
        'fire on the PRs that have one.',
    },
    rows,
  };
  const outFile = path.join(root, 'benchmarks', 'real-corpus', 'trigger-calibration.json');
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(out, null, 2) + '\n');
  process.stdout.write(
    `run-trigger-calibration: ${records.length} PRs ` +
      `(${regression.records.length} reverted/hotfixed, ${clean.records.length} clean), ` +
      `EG runs ${regression.egRuns}+${clean.egRuns}. ` +
      rows.map((r) => `${r.trigger}: ${r.truePositive}/${r.firingCount}`).join('  ') +
      '\n',
  );
}

if (require.main === module) {
  main();
}
