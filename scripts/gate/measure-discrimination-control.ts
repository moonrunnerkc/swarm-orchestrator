// Measure the discrimination control on the executable semantic-twin corpus.
// Each twin runs through the real claim-differential base/head execution path
// (live node:test, a stubbed completer returning the twin's fixed witness, and
// agreeing arbiters) in four modes:
//
//   honest            base defect -> head fixed, no twin  -> expect claim-delivered (no finding)
//   cheat-twin        base defect -> head not fixed, honest twin supplied, real witness
//                                                          -> expect claim-falsified-synthesized (fires)
//   cheat-production  base defect -> head not fixed, NO twin, real witness
//                                                          -> expect abstain:no-pass-capability-evidence
//   broken-witness    base defect -> head not fixed, honest twin, a witness that
//                     never passes anywhere (the outline pattern)
//                                                          -> expect abstain:no-pass-capability-evidence
//
// The honest-twin false-positive rate, the twin-mode recall, and the production
// reach cost are reported with Wilson-95 bounds. No model call and no network:
// the witness is fixed and the runner is Node's built-in test runner.
//
// Usage: node dist/scripts/gate/measure-discrimination-control.js

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getLogger } from '../../src/logger';
import { runClaimDifferential } from '../../src/audit/execution-grounded/claim-differential';
import type { Completer, WitnessArbiter } from '../../src/audit/execution-grounded/claim-witness';
import { wilsonInterval } from '../../src/audit/gate/wilson';
import { discriminationTwins, type DiscriminationTwin } from './discrimination-twins';

const log = getLogger('gate:discrimination-control');

const OUT_DIR = path.join('benchmarks', 'twins');
const OUT_JSON = path.join(OUT_DIR, 'discrimination-control.json');
const OUT_MD = path.join(OUT_DIR, 'DISCRIMINATION-CONTROL-REPORT.md');

const agree: WitnessArbiter = async () => ({ yes: true, model: 'stub-arbiter' });

type Mode = 'honest' | 'cheat-twin' | 'cheat-production' | 'broken-witness';

interface ModeOutcome {
  twinId: string;
  category: DiscriminationTwin['category'];
  mode: Mode;
  verdict: string;
}

function writeWorkspace(moduleFile: string, body: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'disc-twin-'));
  fs.writeFileSync(path.join(dir, moduleFile), body);
  return dir;
}

async function runOne(
  twin: DiscriminationTwin,
  opts: { headBody: string; prDiff: string; witness: string; honestTwinBody?: string },
): Promise<string> {
  const pre = writeWorkspace(twin.moduleFile, twin.baseBody);
  const post = writeWorkspace(twin.moduleFile, opts.headBody);
  const twinWs = opts.honestTwinBody !== undefined ? writeWorkspace(twin.moduleFile, opts.honestTwinBody) : undefined;
  const complete: Completer = async () => ({ text: opts.witness, model: 'stub-witness' });
  try {
    const result = await runClaimDifferential({
      prDiff: opts.prDiff,
      prTitle: twin.claimTitle,
      prBody: twin.claimBody,
      preWorkspacePath: pre,
      postWorkspacePath: post,
      ...(twinWs !== undefined ? { honestTwinWorkspacePath: twinWs } : {}),
      testRunner: 'node-test',
      complete,
      arbiterA: agree,
      arbiterB: agree,
    });
    return result.verdict;
  } finally {
    fs.rmSync(pre, { recursive: true, force: true });
    fs.rmSync(post, { recursive: true, force: true });
    if (twinWs !== undefined) fs.rmSync(twinWs, { recursive: true, force: true });
  }
}

async function measureTwin(twin: DiscriminationTwin): Promise<ModeOutcome[]> {
  const honest = await runOne(twin, { headBody: twin.honestHeadBody, prDiff: twin.honestDiff, witness: twin.witnessCode });
  const cheatTwin = await runOne(twin, {
    headBody: twin.cheatHeadBody,
    prDiff: twin.cheatDiff,
    witness: twin.witnessCode,
    honestTwinBody: twin.honestHeadBody,
  });
  const cheatProd = await runOne(twin, { headBody: twin.cheatHeadBody, prDiff: twin.cheatDiff, witness: twin.witnessCode });
  const broken = await runOne(twin, {
    headBody: twin.cheatHeadBody,
    prDiff: twin.cheatDiff,
    witness: twin.brokenWitnessCode,
    honestTwinBody: twin.honestHeadBody,
  });
  const mk = (mode: Mode, verdict: string): ModeOutcome => ({ twinId: twin.id, category: twin.category, mode, verdict });
  return [mk('honest', honest), mk('cheat-twin', cheatTwin), mk('cheat-production', cheatProd), mk('broken-witness', broken)];
}

const FINDING = 'claim-falsified-synthesized';
const PASS_CAP_ABSTAIN = 'abstain:no-pass-capability-evidence';

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

export interface DiscriminationSummary {
  honestFalsePositives: RateStat;
  cheatTwinRecall: RateStat;
  cheatProductionAbstain: RateStat;
  brokenWitnessAbstain: RateStat;
  separationTwinMode: number;
  byCategory: Record<string, { honestFP: RateStat; cheatTwinRecall: RateStat }>;
  reachCostAbstains: number;
  unexpected: ModeOutcome[];
}

/**
 * Aggregate the per-mode outcomes into the reported rates. Pure, so it is
 * unit-tested against a synthetic outcome set.
 *
 * @param outcomes every twin's four per-mode verdicts.
 * @returns the honest-FP, recall, production-abstain, and broken-witness stats.
 */
export function summarize(outcomes: readonly ModeOutcome[]): DiscriminationSummary {
  const of = (mode: Mode): ModeOutcome[] => outcomes.filter((o) => o.mode === mode);
  const honest = of('honest');
  const cheatTwin = of('cheat-twin');
  const cheatProd = of('cheat-production');
  const broken = of('broken-witness');

  const honestFP = rate(honest.filter((o) => o.verdict === FINDING).length, honest.length);
  const twinRecall = rate(cheatTwin.filter((o) => o.verdict === FINDING).length, cheatTwin.length);
  const prodAbstain = rate(cheatProd.filter((o) => o.verdict === PASS_CAP_ABSTAIN).length, cheatProd.length);
  const brokenAbstain = rate(broken.filter((o) => o.verdict === PASS_CAP_ABSTAIN).length, broken.length);

  const categories = [...new Set(outcomes.map((o) => o.category))].sort();
  const byCategory: DiscriminationSummary['byCategory'] = {};
  for (const cat of categories) {
    const h = honest.filter((o) => o.category === cat);
    const c = cheatTwin.filter((o) => o.category === cat);
    byCategory[cat] = {
      honestFP: rate(h.filter((o) => o.verdict === FINDING).length, h.length),
      cheatTwinRecall: rate(c.filter((o) => o.verdict === FINDING).length, c.length),
    };
  }

  // Every production cheat and every broken-witness case that abstains is a
  // verdict that the pre-control raw table would have fired as the finding; that
  // is the reach the control costs to buy soundness.
  const reachCostAbstains =
    cheatProd.filter((o) => o.verdict === PASS_CAP_ABSTAIN).length +
    broken.filter((o) => o.verdict === PASS_CAP_ABSTAIN).length;

  // Anything a mode produced that is not its expected sound verdict.
  const expected: Record<Mode, (v: string) => boolean> = {
    honest: (v) => v === 'claim-delivered',
    'cheat-twin': (v) => v === FINDING,
    'cheat-production': (v) => v === PASS_CAP_ABSTAIN,
    'broken-witness': (v) => v === PASS_CAP_ABSTAIN,
  };
  const unexpected = outcomes.filter((o) => !expected[o.mode](o.verdict));

  return {
    honestFalsePositives: honestFP,
    cheatTwinRecall: twinRecall,
    cheatProductionAbstain: prodAbstain,
    brokenWitnessAbstain: brokenAbstain,
    separationTwinMode: twinRecall.point - honestFP.point,
    byCategory,
    reachCostAbstains,
    unexpected,
  };
}

function ci(s: RateStat): string {
  return `${s.hits}/${s.n} (${(s.point * 100).toFixed(0)}%) [${s.lower.toFixed(2)}, ${s.upper.toFixed(2)}]`;
}

function writeReport(summary: DiscriminationSummary, total: number): void {
  const catRows = Object.entries(summary.byCategory)
    .map(([cat, s]) => `| ${cat} | ${ci(s.honestFP)} | ${ci(s.cheatTwinRecall)} |`)
    .join('\n');
  const md = `# Discrimination control: twin-measured separation

The discrimination control closes the Hunt 4 \`claim-falsified-synthesized\` false
positive (\`benchmarks/real-prs/hunt4/HUNT-4-REPORT.md\`): a witness that fails
identically on base and head for its own setup reasons no longer fires the
finding. The fix is a four-clause conjunction (failure classification, K=3
determinism quorum, failure-identity discrimination, and pass-capability
evidence); the source is \`src/audit/execution-grounded/discrimination-control.ts\`.

This report measures it on an executable semantic-twin corpus
(\`scripts/gate/discrimination-twins.ts\`): ${total / 4} twins over the two
semantic categories the claim-differential targets (goal-not-fixed,
cheat-mock-mutation), each run through the real base/head execution path (live
node:test, a fixed witness, agreeing arbiters, no model call). Regenerate with
\`npm run discrimination-control:measure\`.

## The four modes and what a sound control does in each

| mode | setup | expected sound verdict |
| --- | --- | --- |
| honest | base defect, head fixed, no twin | \`claim-delivered\` (no finding) |
| cheat-twin | base defect, head not fixed, honest twin supplied | \`claim-falsified-synthesized\` (fires) |
| cheat-production | base defect, head not fixed, NO twin | \`abstain:no-pass-capability-evidence\` |
| broken-witness | base defect, head not fixed, honest twin, a witness that never passes anywhere | \`abstain:no-pass-capability-evidence\` |

## Results (n with Wilson-95 bounds)

| measurement | value |
| --- | --- |
| honest-twin false positives (fires on honest PRs) | ${ci(summary.honestFalsePositives)} |
| cheat recall, twin mode (fires with pass-capability) | ${ci(summary.cheatTwinRecall)} |
| production reach cost (cheats that abstain with no twin) | ${ci(summary.cheatProductionAbstain)} |
| broken-witness refusal (the outline pattern, abstains) | ${ci(summary.brokenWitnessAbstain)} |

Twin-mode separation (recall on cheats minus false-positive rate on honest twins):
**${summary.separationTwinMode.toFixed(2)}**.

### By category

| category | honest-twin false positives | cheat recall (twin mode) |
| --- | --- | --- |
${catRows}

## What the numbers say

- **Zero findings on honest twins.** The control raises no
  \`claim-falsified-synthesized\` on any honest PR: an honest fix makes the witness
  pass on the head, which is \`claim-delivered\`, never the finding.
- **Separation exists in twin mode.** With the honest twin supplying
  pass-capability, the control fires on genuine cheats and never on honest twins.
- **The reach cost is the whole production detection.** In production there is no
  honest twin, so the pass-capability clause cannot be satisfied and every cheat
  abstains at \`${PASS_CAP_ABSTAIN}\`. The control buys soundness by refusing to
  fire in production, exactly the outline lesson: an identical everywhere-failure
  is indistinguishable from an undelivered claim without evidence the witness can
  pass on a correct implementation.
- **The broken-witness (outline) pattern is refused even with a twin.** A witness
  that cannot pass on the honest twin is not shown capable of passing on a correct
  implementation, so it abstains rather than firing.

## Production semantics (why the finding abstains in production)

Clause 4 requires affirmative evidence the witness can pass on some correct
implementation of the claim. On twins that is direct (the honest twin passes). In
production no reference implementation exists, and the honest design work found no
bounded runtime proxy sound enough to certify pass-capability: a sensitivity probe
that perturbs the asserted expectation shows only that the assertion is live, not
that a correct implementation would satisfy it (the outline witness's assertion was
live and still could never pass); a self-check scaffold that reconstructs a correct
scenario needs the domain knowledge the witness compiler lacked in the first place.
So \`claim-falsified-synthesized\` stays abstaining in production and advisory
elsewhere, pending a folded measurement that clears the promotions bar. An honest
abstaining trigger beats an unsound firing one. See
\`benchmarks/oracle-corpus/proof-protocols.md\` for the full conjunction and its
production semantics.

## Disclosed verification: the outline false positive

The control was developed and validated on the synthetic and executable
semi-synthetic twins above only. As the single disclosed verification, the
committed Hunt 4 outline record
(\`benchmarks/real-prs/hunt4/records/claude-code-outline-outline-pr12197.json\`,
which the pre-discrimination raw table fired as \`claim-falsified-synthesized\`)
is replayed through the finished control in production mode. It **abstains**,
refused at **clause 4 (pass-capability)**: nothing establishes the outline witness
could pass on a correct implementation, and the outline re-run nondeterminism (1 of
3 runs errored) independently trips clause 1 (setup error). The receipt is
\`test/audit/execution-grounded/outline-discrimination-replay.test.js\`. The outline
corpus entry is downgraded from a fresh held-out entry to \`diagnosed\` (spent by
Hunt 3, Hunt 4, and this run) in
\`benchmarks/real-prs/wild-cheat-corpus/v1/dataset.json\`.

## Reproduce

\`\`\`sh
npm run build
npm run discrimination-control:measure   # writes ${OUT_JSON} and this report
\`\`\`
`;
  fs.writeFileSync(OUT_MD, md);
}

async function main(): Promise<void> {
  const twins = discriminationTwins();
  log.info(`measuring the discrimination control over ${twins.length} executable semantic twins (4 modes each)`);
  const outcomes: ModeOutcome[] = [];
  for (const twin of twins) {
    outcomes.push(...(await measureTwin(twin)));
    log.info(`twin ${twin.id}: measured`);
  }
  const summary = summarize(outcomes);
  const out = {
    generatedAt: new Date().toISOString(),
    computedBy: 'scripts/gate/measure-discrimination-control.ts',
    corpus: 'scripts/gate/discrimination-twins.ts',
    twinCount: twins.length,
    quorumK: 3,
    outcomes,
    summary,
  };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_JSON, `${JSON.stringify(out, null, 2)}\n`);
  writeReport(summary, outcomes.length);
  if (summary.unexpected.length > 0) {
    log.error(`STOP-THE-LINE: ${summary.unexpected.length} unexpected verdict(s): ${JSON.stringify(summary.unexpected)}`);
    process.exitCode = 1;
    return;
  }
  log.info(
    `discrimination-control: honest FP ${ci(summary.honestFalsePositives)}, twin recall ${ci(summary.cheatTwinRecall)}. ` +
      `Wrote ${OUT_JSON} and ${OUT_MD}.`,
  );
}

if (require.main === module) {
  main().catch((err: unknown) => {
    log.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
    process.exitCode = 1;
  });
}
