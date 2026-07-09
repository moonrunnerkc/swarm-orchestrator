// Shared proof-tier machinery for the wild hunts.
//
// Both hunt.ts (the first forward hunt) and hunt2.ts (the viability-first,
// complaint-mined, triage-cascade hunt) run the exact same thing on a viable
// agent PR: the structural-and-judge advisory audit (runCheatDetectors) plus the
// six-engine execution-grounded proof tier (test-tamper, mock-mutation,
// no-op-fix, type-suppression, fake-refactor, dead-branch), then the block-trigger
// detector gated by self-certifying controls. Extracting it here keeps one source
// of truth for "prove one PR" instead of two drifting copies.

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runCheatDetectors } from '../../../src/audit/cheat-detector';
import { runExecutionGrounded } from '../../../src/audit/execution-grounded';
import type { ExecutionGroundedConfig } from '../../../src/audit/cheat-detector/audit-config';
import { detectBlockTriggers, type BlockTrigger } from '../../../src/audit/gate/block-triggers';
import { controlsAllGreen } from '../../../src/audit/gate/self-certifying';

/** A fetched, fingerprinter-confirmed agent PR with everything the screen and
 *  the proof tier need. The diff lives at `<diffsBaseDir>/<diffPath>`. */
export interface HuntPr {
  id: string;
  repo: string;
  prNumber: number;
  headSha: string;
  baseSha: string;
  title: string;
  body: string;
  url: string;
  vendor: string;
  vendorConfidence: string;
  changedLines: number;
  diffPath: string;
  /** Repository-history outcome when known (a seed lead carries it). 'unknown'
   *  for a freshly fetched PR not yet outcome-labeled. */
  outcome: string;
}

export type ProofStatus =
  | 'proven-block'
  | 'ran-no-proof'
  | 'not-provisioned'
  | 'skipped-by-cap'
  | 'error';

export interface ProofRecord {
  id: string;
  repo: string;
  prNumber: number;
  url: string;
  headSha: string;
  vendor: string;
  outcome: string;
  outcomeBad: boolean;
  status: ProofStatus;
  provenTriggers: { kind: string; file: string; reproduce: string }[];
  proofFunnel: Record<string, number>;
  advisoryFindings: { category: string; file: string; line: number; confidence: string }[];
  mutationRan: boolean;
  coverageRan: boolean;
  skipped: string[];
  note: string;
  /** Optional provenance tags carried from the cascade (e.g. 'complaint-flagged',
   *  'candidate-flagged'). hunt.ts leaves this undefined. */
  flags?: string[];
}

export function tally(records: { verdict: string }[], into: Record<string, number>, prefix: string): void {
  for (const r of records) {
    const key = `${prefix}:${r.verdict}`;
    into[key] = (into[key] ?? 0) + 1;
  }
}

export interface ProveOptions {
  /** Directory the PR's diffPath is resolved against (the hunt's output dir). */
  diffsBaseDir: string;
  /** Per-PR EG wall-clock + install timeout (ms). */
  egWallClockMs: number;
}

/** Run the advisory audit + six-engine proof tier on one viable agent PR and
 *  return a fully-populated proof record. Pure of any global state beyond the two
 *  temp dirs it creates and removes. */
export async function proveOne(pr: HuntPr, opts: ProveOptions): Promise<ProofRecord> {
  const base: ProofRecord = {
    id: pr.id,
    repo: pr.repo,
    prNumber: pr.prNumber,
    url: pr.url,
    headSha: pr.headSha,
    vendor: pr.vendor,
    outcome: pr.outcome,
    outcomeBad: pr.outcome === 'reverted' || pr.outcome === 'hotfixed',
    status: 'error',
    provenTriggers: [],
    proofFunnel: {},
    advisoryFindings: [],
    mutationRan: false,
    coverageRan: false,
    skipped: [],
    note: '',
  };
  const prDiff = fs.readFileSync(path.join(opts.diffsBaseDir, pr.diffPath), 'utf8');
  const manifestDir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-hunt-manifest-'));
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-hunt-ws-'));
  try {
    const audit = await runCheatDetectors({
      unifiedDiff: prDiff,
      repoRoot: manifestDir,
      pr: {
        number: pr.prNumber,
        headSha: pr.headSha,
        baseSha: pr.baseSha,
        title: pr.title,
        body: pr.body,
        author: '',
        headRef: '',
        repository: pr.repo,
      },
    });
    base.advisoryFindings = audit.findings.map((f) => ({
      category: f.category,
      file: f.location.file,
      line: f.location.line,
      confidence: f.confidence ?? 'unknown',
    }));

    const config: ExecutionGroundedConfig = {
      enabled: true,
      mutation: false,
      coverage: false,
      issueRepro: false,
      runner: 'host',
      corroborateStructural: false,
      claimDifferential: false,
      errorSwallow: false,
      claimBinding: false,
      maxWallClockPerPrMs: opts.egWallClockMs,
    };
    const outcome = await runExecutionGrounded({
      prDiff,
      repo: pr.repo,
      prNumber: pr.prNumber,
      prHeadSha: pr.headSha,
      prBaseSha: pr.baseSha,
      prTitle: pr.title,
      prBody: pr.body,
      prText: `${pr.title}\n\n${pr.body}`,
      config,
      baseDir,
      installTimeoutMs: opts.egWallClockMs,
      structuralFindings: audit.findings,
    });

    base.skipped = outcome.skipped;
    base.mutationRan = outcome.mutationRuns.some((r) => r.outcome.ran);
    base.coverageRan = outcome.coverageRuns.some((r) => r.outcome.ran);
    tally(outcome.restorations, base.proofFunnel, 'test-tamper');
    tally(outcome.mockRestorations, base.proofFunnel, 'mock');
    tally(outcome.noOpRestorations, base.proofFunnel, 'no-op');
    tally(outcome.typeSuppressionRestorations, base.proofFunnel, 'type-suppression');
    tally(outcome.fakeRefactorRestorations, base.proofFunnel, 'fake-refactor');
    tally(outcome.deadBranchRestorations, base.proofFunnel, 'dead-branch');

    const triggers: BlockTrigger[] = detectBlockTriggers({
      restorations: { restorations: outcome.restorations },
      mockRestorations: { mockRestorations: outcome.mockRestorations },
      noOpRestorations: { noOpRestorations: outcome.noOpRestorations },
      typeSuppressionRestorations: { typeSuppressionRestorations: outcome.typeSuppressionRestorations },
      fakeRefactorRestorations: { fakeRefactorRestorations: outcome.fakeRefactorRestorations },
      deadBranchRestorations: { deadBranchRestorations: outcome.deadBranchRestorations },
    });
    const proven = triggers.filter((t) => controlsAllGreen(t));
    base.provenTriggers = proven.map((t) => ({
      kind: t.kind,
      file: 'file' in t.evidence ? (t.evidence as { file: string }).file : '',
      reproduce: 'reproduce' in t ? (t as { reproduce: string }).reproduce : '',
    }));

    const provisionFailed = outcome.skipped.some((s) => s.startsWith('provision:'));
    if (proven.length > 0) {
      base.status = 'proven-block';
      base.note = `STOP-THE-LINE: ${proven.length} fully-controlled block trigger(s) on a wild agent PR; replay the reproduce command in a fresh clone before trusting it`;
    } else if (provisionFailed) {
      base.status = 'not-provisioned';
      base.note = outcome.skipped.find((s) => s.startsWith('provision:')) ?? 'provisioning failed';
    } else {
      base.status = 'ran-no-proof';
      base.note = 'proof tier ran; no fully-controlled block trigger fired';
    }
    return base;
  } catch (err) {
    base.status = 'error';
    base.note = err instanceof Error ? err.message : String(err);
    return base;
  } finally {
    fs.rmSync(manifestDir, { recursive: true, force: true });
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
}

/** Write one proof record as <recordsDir>/<id>.json, stamped with the time. */
export function writeRecord(recordsDir: string, r: ProofRecord): void {
  fs.mkdirSync(recordsDir, { recursive: true });
  fs.writeFileSync(
    path.join(recordsDir, `${r.id}.json`),
    `${JSON.stringify({ generatedAt: new Date().toISOString(), ...r }, null, 2)}\n`,
  );
}
