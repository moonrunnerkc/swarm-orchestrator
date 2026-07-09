// Measure Tier C claim-to-existing-test binding on the executable twin corpus.
// Each twin runs through the REAL runClaimBinding engine (live pytest, K=3
// quorum, no model call, no network) in three modes:
//
//   honest         base defect -> head fixed, green ref present
//                                             -> expect claim-delivered (no finding)
//   cheat-bound    base defect -> head not fixed, green ref present
//                                             -> expect claim-falsified-bound (fires)
//   cheat-no-green base defect -> head not fixed, NO green ref
//                                             -> expect abstain:no-pass-capability-evidence
//
// The honest-twin false-positive rate, the cheat recall, and the no-green-history
// abstain (the production reach cost) are reported with Wilson-95 bounds. Zero
// findings on honest twins is required; a finding there is stop-the-line.
//
// Usage: node dist/scripts/gate/measure-claim-binding.js

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getLogger } from '../../src/logger';
import { runClaimBinding } from '../../src/audit/execution-grounded/claim-binding';
import { wilsonInterval } from '../../src/audit/gate/wilson';
import { claimBindingTwins, type ClaimBindingTwin } from './claim-binding-twins';

const log = getLogger('gate:claim-binding');

const OUT_DIR = path.join('benchmarks', 'twins');
const OUT_JSON = path.join(OUT_DIR, 'claim-binding.json');

type Mode = 'honest' | 'cheat-bound' | 'cheat-no-green';

interface ModeOutcome {
  twinId: string;
  mode: Mode;
  verdict: string;
}

function writeWorkspace(moduleFile: string, moduleBody: string, testFile: string, testBody: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-twin-'));
  fs.writeFileSync(path.join(dir, moduleFile), moduleBody);
  fs.writeFileSync(path.join(dir, testFile), testBody);
  return dir;
}

function runOne(
  twin: ClaimBindingTwin & { _testBody: string },
  opts: { headBody: string; withGreen: boolean },
): string {
  const base = writeWorkspace(twin.moduleFile, twin.baseBody, twin.testFile, twin._testBody);
  const head = writeWorkspace(twin.moduleFile, opts.headBody, twin.testFile, twin._testBody);
  const green = opts.withGreen
    ? writeWorkspace(twin.moduleFile, twin.greenBody, twin.testFile, twin._testBody)
    : undefined;
  try {
    const result = runClaimBinding({
      claim: twin.claim,
      existingTests: [
        { file: twin.testFile, testName: twin.testName, referencedSymbols: twin.referencedSymbols },
      ],
      preWorkspacePath: base,
      postWorkspacePath: head,
      ...(green !== undefined ? { greenWorkspacePath: green } : {}),
      testRunner: 'pytest',
      timeoutMs: 120_000,
    });
    return result.verdict;
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
    fs.rmSync(head, { recursive: true, force: true });
    if (green !== undefined) fs.rmSync(green, { recursive: true, force: true });
  }
}

function measureTwin(twin: ClaimBindingTwin & { _testBody: string }): ModeOutcome[] {
  return [
    { twinId: twin.id, mode: 'honest', verdict: runOne(twin, { headBody: twin.honestHeadBody, withGreen: true }) },
    { twinId: twin.id, mode: 'cheat-bound', verdict: runOne(twin, { headBody: twin.cheatHeadBody, withGreen: true }) },
    { twinId: twin.id, mode: 'cheat-no-green', verdict: runOne(twin, { headBody: twin.cheatHeadBody, withGreen: false }) },
  ];
}

const FINDING = 'claim-falsified-bound';
const NO_PASS_CAP = 'abstain:no-pass-capability-evidence';

interface RateStat {
  n: number;
  hits: number;
  point: number;
  lower: number;
  upper: number;
}

function rate(hits: number, n: number): RateStat {
  const w = wilsonInterval(hits, n);
  return { n, hits, point: w.point, lower: w.lower, upper: w.upper };
}

export interface ClaimBindingSummary {
  honestFalsePositives: RateStat;
  cheatBoundRecall: RateStat;
  noGreenAbstain: RateStat;
  separation: number;
  unexpected: ModeOutcome[];
}

/** Aggregate per-mode outcomes into the reported rates. Pure, unit-tested. */
export function summarize(outcomes: readonly ModeOutcome[]): ClaimBindingSummary {
  const of = (mode: Mode): ModeOutcome[] => outcomes.filter((o) => o.mode === mode);
  const honest = of('honest');
  const cheatBound = of('cheat-bound');
  const noGreen = of('cheat-no-green');
  const honestFP = rate(honest.filter((o) => o.verdict === FINDING).length, honest.length);
  const recall = rate(cheatBound.filter((o) => o.verdict === FINDING).length, cheatBound.length);
  const abstain = rate(noGreen.filter((o) => o.verdict === NO_PASS_CAP).length, noGreen.length);
  const expected: Record<Mode, (v: string) => boolean> = {
    honest: (v) => v === 'claim-delivered',
    'cheat-bound': (v) => v === FINDING,
    'cheat-no-green': (v) => v === NO_PASS_CAP,
  };
  const unexpected = outcomes.filter((o) => !expected[o.mode](o.verdict));
  return {
    honestFalsePositives: honestFP,
    cheatBoundRecall: recall,
    noGreenAbstain: abstain,
    separation: recall.point - honestFP.point,
    unexpected,
  };
}

function ci(s: RateStat): string {
  return `${s.hits}/${s.n} (${(s.point * 100).toFixed(0)}%) [${s.lower.toFixed(2)}, ${s.upper.toFixed(2)}]`;
}

function main(): void {
  const twins = claimBindingTwins();
  log.info(`measuring Tier C claim-binding over ${twins.length} goal-not-fixed twins (3 modes each, K=3)`);
  const outcomes: ModeOutcome[] = [];
  for (const twin of twins) {
    outcomes.push(...measureTwin(twin));
    log.info(`twin ${twin.id}: measured`);
  }
  const summary = summarize(outcomes);
  const out = {
    generatedAt: new Date().toISOString(),
    computedBy: 'scripts/gate/measure-claim-binding.ts',
    corpus: 'scripts/gate/claim-binding-twins.ts',
    twinCount: twins.length,
    quorumK: 3,
    outcomes,
    summary,
  };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_JSON, `${JSON.stringify(out, null, 2)}\n`);
  if (summary.unexpected.length > 0) {
    log.error(`STOP-THE-LINE: ${summary.unexpected.length} unexpected verdict(s): ${JSON.stringify(summary.unexpected)}`);
    process.exitCode = 1;
    return;
  }
  log.info(
    `claim-binding: honest FP ${ci(summary.honestFalsePositives)}, cheat recall ${ci(summary.cheatBoundRecall)}, ` +
      `no-green abstain ${ci(summary.noGreenAbstain)}, separation ${summary.separation.toFixed(2)}. Wrote ${OUT_JSON}.`,
  );
}

if (require.main === module) {
  try {
    main();
  } catch (err: unknown) {
    log.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
    process.exitCode = 1;
  }
}
