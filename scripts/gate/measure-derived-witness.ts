// Measure the existing-test-derived witness on the derived-witness twin corpus
// (Phase 3 of the endgame run). Each twin runs through the real claim-differential
// base/head execution path (live node:test, a stubbed completer returning the
// twin's fixed witness, agreeing arbiters, no model call). The witness under test
// is the DERIVED witness: the parent test perturbed. Modes:
//
//   parent-on-cheat        the unperturbed parent test on the cheat head, no twin
//                          -> expect claim-delivered (the cheat PASSES its own test;
//                             this is why the derived witness is needed)
//   derived-honest         derived witness, honest head, no twin
//                          -> expect claim-delivered (no false positive)
//   derived-cheat-twin     derived witness, cheat head, honest twin supplied
//                          -> expect claim-falsified-synthesized (fires: the new catch)
//   derived-cheat-production derived witness, cheat head, NO twin
//                          -> expect abstain:no-pass-capability-evidence (reach cost)
//   derived-broken         a witness that never passes, cheat head, honest twin
//                          -> expect abstain:no-pass-capability-evidence
//   derived-hardcoded      derived witness, PURE-CONSTANT hardcode head, honest twin
//                          -> split by perturbation class: CAUGHT on output-changing
//                             (the constant diverges from the perturbed expectation, so
//                             the head failure shares the base failure's identity and the
//                             control fires, a correct catch); MISSED on output-preserving
//                             (the constant equals the perturbed expectation, so the
//                             witness passes and the verdict is claim-delivered, a
//                             documented indistinguishability limit, not a false fire)
//
// Stop-the-line: a fire on an HONEST head only. A fire on a cheat head, whether
// the special-casing cheat or a pure-constant hardcode, is a correct catch, not a
// halting false positive.
//
// Usage: node dist/scripts/gate/measure-derived-witness.js

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getLogger } from '../../src/logger';
import { runClaimDifferential } from '../../src/audit/execution-grounded/claim-differential';
import type { Completer, WitnessArbiter } from '../../src/audit/execution-grounded/claim-witness';
import { wilsonInterval } from '../../src/audit/gate/wilson';
import { derivedWitnessTwins, type DerivedWitnessTwin } from './derived-witness-twins';

const log = getLogger('gate:derived-witness');

const OUT_DIR = path.join('benchmarks', 'twins');
const OUT_JSON = path.join(OUT_DIR, 'derived-witness.json');
const OUT_MD = path.join(OUT_DIR, 'DERIVED-WITNESS-REPORT.md');

const agree: WitnessArbiter = async () => ({ yes: true, model: 'stub-arbiter' });

const FINDING = 'claim-falsified-synthesized';
const PASS_CAP_ABSTAIN = 'abstain:no-pass-capability-evidence';

type Mode =
  | 'parent-on-cheat'
  | 'derived-honest'
  | 'derived-cheat-twin'
  | 'derived-cheat-production'
  | 'derived-broken'
  | 'derived-hardcoded';

interface ModeOutcome {
  twinId: string;
  perturbationClass: DerivedWitnessTwin['perturbationClass'];
  mode: Mode;
  verdict: string;
}

function writeWorkspace(moduleFile: string, body: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-twin-'));
  fs.writeFileSync(path.join(dir, moduleFile), body);
  return dir;
}

async function runOne(
  twin: DerivedWitnessTwin,
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

async function measureTwin(twin: DerivedWitnessTwin): Promise<ModeOutcome[]> {
  const mk = (mode: Mode, verdict: string): ModeOutcome => ({ twinId: twin.id, perturbationClass: twin.perturbationClass, mode, verdict });
  const parentOnCheat = await runOne(twin, { headBody: twin.cheatHeadBody, prDiff: twin.cheatDiff, witness: twin.parentWitnessCode });
  const derivedHonest = await runOne(twin, { headBody: twin.honestHeadBody, prDiff: twin.honestDiff, witness: twin.derivedWitnessCode });
  const derivedCheatTwin = await runOne(twin, { headBody: twin.cheatHeadBody, prDiff: twin.cheatDiff, witness: twin.derivedWitnessCode, honestTwinBody: twin.honestHeadBody });
  const derivedCheatProd = await runOne(twin, { headBody: twin.cheatHeadBody, prDiff: twin.cheatDiff, witness: twin.derivedWitnessCode });
  const derivedBroken = await runOne(twin, { headBody: twin.cheatHeadBody, prDiff: twin.cheatDiff, witness: twin.brokenWitnessCode, honestTwinBody: twin.honestHeadBody });
  const derivedHardcoded = await runOne(twin, { headBody: twin.hardcodedBody, prDiff: twin.hardcodedDiff, witness: twin.derivedWitnessCode, honestTwinBody: twin.honestHeadBody });
  return [
    mk('parent-on-cheat', parentOnCheat),
    mk('derived-honest', derivedHonest),
    mk('derived-cheat-twin', derivedCheatTwin),
    mk('derived-cheat-production', derivedCheatProd),
    mk('derived-broken', derivedBroken),
    mk('derived-hardcoded', derivedHardcoded),
  ];
}

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

export interface DerivedWitnessSummary {
  parentEvasion: RateStat;
  honestFalsePositives: RateStat;
  cheatTwinRecall: RateStat;
  cheatProductionAbstain: RateStat;
  brokenWitnessAbstain: RateStat;
  /** Pure-constant hardcode catch rate, split by perturbation class. An
   *  output-changing hardcode is caught (the received value diverges from the
   *  perturbed expectation); an output-preserving one is a documented miss (the
   *  constant equals the perturbed expectation, so it is indistinguishable). A
   *  hardcode head is a cheat, so a catch here is correct, never a false positive. */
  hardcodedCatchByClass: Record<string, RateStat>;
  separationTwinMode: number;
  byClass: Record<string, { honestFP: RateStat; cheatTwinRecall: RateStat }>;
  stopTheLine: ModeOutcome[];
}

/**
 * Aggregate per-mode outcomes into the reported rates. Pure, so it is unit-tested
 * against a synthetic outcome set.
 *
 * @param outcomes every twin's six per-mode verdicts.
 * @returns the parent-evasion, honest-FP, recall, reach-cost, and boundary stats.
 */
export function summarize(outcomes: readonly ModeOutcome[]): DerivedWitnessSummary {
  const of = (mode: Mode): ModeOutcome[] => outcomes.filter((o) => o.mode === mode);
  const parent = of('parent-on-cheat');
  const honest = of('derived-honest');
  const cheatTwin = of('derived-cheat-twin');
  const cheatProd = of('derived-cheat-production');
  const broken = of('derived-broken');
  const hardcoded = of('derived-hardcoded');

  const parentEvasion = rate(parent.filter((o) => o.verdict === 'claim-delivered').length, parent.length);
  const honestFP = rate(honest.filter((o) => o.verdict === FINDING).length, honest.length);
  const twinRecall = rate(cheatTwin.filter((o) => o.verdict === FINDING).length, cheatTwin.length);
  const prodAbstain = rate(cheatProd.filter((o) => o.verdict === PASS_CAP_ABSTAIN).length, cheatProd.length);
  const brokenAbstain = rate(broken.filter((o) => o.verdict === PASS_CAP_ABSTAIN).length, broken.length);

  const classes = [...new Set(outcomes.map((o) => o.perturbationClass))].sort();
  const byClass: DerivedWitnessSummary['byClass'] = {};
  const hardcodedCatchByClass: Record<string, RateStat> = {};
  for (const cls of classes) {
    const h = honest.filter((o) => o.perturbationClass === cls);
    const c = cheatTwin.filter((o) => o.perturbationClass === cls);
    const hc = hardcoded.filter((o) => o.perturbationClass === cls);
    byClass[cls] = {
      honestFP: rate(h.filter((o) => o.verdict === FINDING).length, h.length),
      cheatTwinRecall: rate(c.filter((o) => o.verdict === FINDING).length, c.length),
    };
    hardcodedCatchByClass[cls] = rate(hc.filter((o) => o.verdict === FINDING).length, hc.length);
  }

  // The only halting condition is a fire on an HONEST head: a finding on a
  // legitimate PR. A fire on a cheat head (special-casing or a pure-constant
  // hardcode) is a correct catch, not a false positive.
  const stopTheLine = honest.filter((o) => o.verdict === FINDING);

  return {
    parentEvasion,
    honestFalsePositives: honestFP,
    cheatTwinRecall: twinRecall,
    cheatProductionAbstain: prodAbstain,
    brokenWitnessAbstain: brokenAbstain,
    hardcodedCatchByClass,
    separationTwinMode: twinRecall.point - honestFP.point,
    byClass,
    stopTheLine,
  };
}

function ci(s: RateStat): string {
  return `${s.hits}/${s.n} (${(s.point * 100).toFixed(0)}%) [${s.lower.toFixed(2)}, ${s.upper.toFixed(2)}]`;
}

function writeReport(summary: DerivedWitnessSummary, outcomes: readonly ModeOutcome[], twinCount: number): void {
  const classRows = Object.entries(summary.byClass)
    .map(
      ([cls, s]) =>
        `| ${cls} | ${ci(s.honestFP)} | ${ci(s.cheatTwinRecall)} | ${ci(summary.hardcodedCatchByClass[cls] ?? s.honestFP)} |`,
    )
    .join('\n');
  const md = `# Derived-witness measurement: the bounded pass-capability path

Phase 3 of the endgame run. The claim-differential proof normally synthesizes its
witness from claim text, whose pass-capability no production proxy can certify
(\`benchmarks/twins/DISCRIMINATION-CONTROL-REPORT.md\`). This report measures a
different witness class: one DERIVED by perturbing a test that already passes on
head. The parent test's green run is direct evidence the witness harness, imports,
and setup work, which is exactly the blind spot the outline false positive
exploited (a witness that could never pass anywhere for its own setup reasons).

Measured on \`scripts/gate/derived-witness-twins.ts\`: ${twinCount} twins (half
output-preserving, half output-changing), each run through the real base/head
execution path (live node:test, a fixed witness, agreeing arbiters, no model
call). Regenerate with \`npm run derived-witness:measure\`.

## The cheat this catches that the claim-text witness cannot

The distinguishing cheat is a fix that PASSES ITS OWN PARENT TEST but only by
special-casing that test's exact input, leaving the base behaviour for everything
else. The parent test is green, so neither a structural detector nor the
claim-text witness flags it.

- **Parent test evades on the cheat head**: ${ci(summary.parentEvasion)} of twins
  return \`claim-delivered\` when the unperturbed parent runs on the cheat head.
  The cheat passes its own test; that is why a derived witness is needed.

## Results (n with Wilson-95 bounds)

| mode | expected sound verdict | measured |
| --- | --- | --- |
| derived-honest (honest head, no twin) | \`claim-delivered\` (no fire) | honest-twin FP ${ci(summary.honestFalsePositives)} |
| derived-cheat-twin (cheat head, honest twin) | \`${FINDING}\` (fires) | recall ${ci(summary.cheatTwinRecall)} |
| derived-cheat-production (cheat head, no twin) | \`${PASS_CAP_ABSTAIN}\` | ${ci(summary.cheatProductionAbstain)} |
| derived-broken (never-pass witness, twin) | \`${PASS_CAP_ABSTAIN}\` | ${ci(summary.brokenWitnessAbstain)} |

Twin-mode separation (recall minus honest-twin false-positive rate):
**${summary.separationTwinMode.toFixed(2)}**.

### By perturbation class

| perturbation class | honest-twin false positives | special-casing recall (twin) | pure-constant hardcode catch (twin) |
| --- | --- | --- | --- |
${classRows}

## What the numbers say

- **Zero false positives on honest twins.** An honest fix that generalizes makes
  the derived witness pass on the head, which is \`claim-delivered\`, never the
  finding. Both perturbation classes measure clean; this is the only halting gate.
- **It catches the special-casing cheat the parent test missed.** With the honest
  twin supplying pass-capability, the derived witness fires on the cheat that
  passed its own parent test. The identity clause does the discrimination for
  free: the special-casing cheat leaves the base behaviour for the perturbed
  input, so the base and cheat-head failures share an identity; the control fires.
- **The pure-constant hardcode splits by perturbation class, and never fires
  falsely.** A fix that returns the parent's expected value for everything is
  caught on an OUTPUT-CHANGING perturbation (its head failure is the same assertion
  failing that the base fails, and the honest twin passes, so the control fires)
  and MISSED on an OUTPUT-PRESERVING one (the constant returns the same expected
  value the correct implementation does for the perturbed input, so the witness
  passes on it, \`claim-delivered\`). The miss is a documented indistinguishability
  limit, not a false positive; the catch is a cheat correctly caught.

## Production semantics: why this stays advisory and abstains in production

The parent-head-pass closes the SETUP dimension of the pass-capability clause: a
derived witness cannot be an outline-style broken witness, because its parent
demonstrably reaches a clean pass. That is a real advance over the claim-text
witness. But the clause has a second dimension the parent-head-pass does not
close: does a CORRECT implementation satisfy the PERTURBED assertion?

- For an **output-changing** perturbation (E' != E), the perturbed expected value
  E' must be computed from the specification. On a twin the honest implementation
  supplies it; in production, deriving E' without a reference implementation is the
  same spec-guess the discrimination control already rejected as unsound. So this
  class abstains in production.
- For an **output-preserving** perturbation (E' == E), the perturbed input maps to
  the KNOWN-GOOD parent output E, so no value is synthesized. The only judgment is
  whether the perturbation preserves the output under the claim's stated
  invariant. That judgment is sound only when the claim states such an invariant
  and two arbiters certify the perturbation exercises it. Whether arbiters make
  that judgment soundly on arbitrary wild claims cannot be validated on twins (a
  twin has the honest implementation; a wild PR does not), and the fresh wild data
  that could measure it is held out for the next pre-registered hunt
  (\`docs/READINESS.md\` item 4).

So the honest landing matches the discrimination control's: the mechanism is
demonstrated and measured on twins, and it ships **advisory**. Production reach is
left where it is; the output-preserving subclass is the named candidate for a
bounded production unlock, gated behind an arbiter-certified output-invariant and a
folded measurement that clears the promotions bar. An honest abstain beats an
unsound fire.

## Reproduce

\`\`\`sh
npm run build
npm run derived-witness:measure   # writes ${OUT_JSON} and this report
\`\`\`
`;
  void outcomes;
  fs.writeFileSync(OUT_MD, md);
}

async function main(): Promise<void> {
  const twins = derivedWitnessTwins();
  log.info(`measuring the derived witness over ${twins.length} executable twins (6 modes each)`);
  const outcomes: ModeOutcome[] = [];
  for (const twin of twins) {
    outcomes.push(...(await measureTwin(twin)));
    log.info(`twin ${twin.id} (${twin.perturbationClass}): measured`);
  }
  const summary = summarize(outcomes);
  const out = {
    generatedAt: new Date().toISOString(),
    computedBy: 'scripts/gate/measure-derived-witness.ts',
    corpus: 'scripts/gate/derived-witness-twins.ts',
    twinCount: twins.length,
    outcomes,
    summary,
  };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_JSON, `${JSON.stringify(out, null, 2)}\n`);
  writeReport(summary, outcomes, twins.length);
  if (summary.stopTheLine.length > 0) {
    log.error(`STOP-THE-LINE: ${summary.stopTheLine.length} false fire(s): ${JSON.stringify(summary.stopTheLine)}`);
    process.exitCode = 1;
    return;
  }
  log.info(
    `derived-witness: honest FP ${ci(summary.honestFalsePositives)}, twin recall ${ci(summary.cheatTwinRecall)}, ` +
      `parent evasion ${ci(summary.parentEvasion)}. Wrote ${OUT_JSON} and ${OUT_MD}.`,
  );
}

if (require.main === module) {
  main().catch((err: unknown) => {
    log.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
    process.exitCode = 1;
  });
}
