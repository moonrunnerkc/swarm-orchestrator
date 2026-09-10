import { mustBeShownToParse, readParseCheck } from "./mutant-parse.ts";
import {
  coverageWitnessesADifference,
  type LineHits,
  type MutantWitness,
  suiteWitnessesADifference,
  vacuousRequiresAWitness,
  witnessedADifference,
  witnessOfADifference,
} from "./mutant-witness.ts";
import {
  bondOfMutantObservations,
  type MutantObservation,
  mutantWasSeen,
  type OracleBond,
} from "./oracle-bond.ts";
import type { Mutant } from "./oracle-mutants.ts";

/** What a check said, which is all of a check this reads. */
export interface CheckStatus {
  readonly id: string;
  readonly status: "passed" | "failed" | "not-applicable";
}

/**
 * Everything this loop does to the tree it is measuring, injected.
 *
 * Each of these is a run against the checkout as it stands at the moment it is called, so the
 * order the loop calls them in is the whole of its behaviour and is what its tests are about.
 */
export interface OracleBondRunner {
  read(path: string): Promise<string | null>;
  write(path: string, text: string): Promise<void>;
  /** Whether node can parse the file as it stands. */
  parses(path: string): Promise<boolean>;
  runOracle(): Promise<{ readonly accepted: boolean }>;
  /** The oracle's own coverage of the tree as it stands, or null where nothing could be read. */
  measureLineHits(): Promise<LineHits | null>;
  runRepositoryChecks(): Promise<readonly CheckStatus[]>;
}

/**
 * How many suite runs one patch may spend adjudicating.
 *
 * The second detector is the repository's whole suite, which on a real project is minutes. Two is
 * enough to reach the two lowest-risk mutants of a patch, which are the ones most likely to be
 * real, and small enough that a patch full of accepted mutants cannot turn one verification into
 * an afternoon.
 *
 * Where the witness is recorded rather than required this is never reached, because the first
 * accepted mutant on a line the oracle ran settles the verdict and adjudicating stops there. It
 * binds only under the stricter reading, where a silent detector settles nothing.
 */
const suiteRunsPerPatch = 2;

/**
 * Each mutant written into the checkout, the oracle run again, and the file put back.
 *
 * Three things decide what the bond is worth, and the loop's job is to establish them in the
 * cheapest order and to spend nothing on a question whose answer cannot change the verdict:
 *
 *   1. Does the mutant parse. Only a deletion can fail this, and a file that no longer compiles
 *      is refused by every oracle there is, so counting that refusal would credit the oracle with
 *      one it never made. Such a mutant produces no observation at all.
 *   2. Did the oracle refuse it. A refusal is the oracle doing its job and needs nothing else.
 *   3. Did the mutant change anything, where the oracle accepted a mutant on a line it ran. This
 *      is the fact `vacuous` used to assert without evidence, and the detectors are in
 *      `mutant-witness.ts`.
 *
 * A mutant is only ever written where the checkout's line still reads as the patch left it. A
 * checkout that says something else is not the tree the mutant was built from.
 */
export async function bondOracleWithMutants(input: {
  readonly mutants: readonly Mutant[];
  /** The oracle's coverage of the unmutated tree, which both `seen` and detector 1 read. */
  readonly measured: LineHits | null;
  readonly checksWithPatch: readonly CheckStatus[];
  readonly runner: OracleBondRunner;
  readonly suiteAdjudicationLimit?: number;
  /** Which fact the verdict rests on, which is also what decides when adjudicating can stop. */
  readonly requireAWitness?: boolean;
}): Promise<OracleBond> {
  const { runner } = input;
  const requireAWitness = input.requireAWitness ?? vacuousRequiresAWitness;
  const observations: MutantObservation[] = [];
  let suiteRunsLeft = input.suiteAdjudicationLimit ?? suiteRunsPerPatch;
  let decided = false;

  for (const mutant of input.mutants) {
    const original = await runner.read(mutant.path);
    if (original === null) {
      continue;
    }
    const lines = original.split("\n");
    if (lines[mutant.line - 1] !== mutant.before) {
      continue;
    }
    const checkTheParse = mustBeShownToParse(mutant.operator);
    const originalParses = checkTheParse ? await runner.parses(mutant.path) : true;
    lines[mutant.line - 1] = mutant.after;
    await runner.write(mutant.path, lines.join("\n"));
    try {
      if (
        checkTheParse &&
        readParseCheck({ originalParses, mutantParses: await runner.parses(mutant.path) }) !==
          "usable"
      ) {
        continue;
      }
      const ran = await runner.runOracle();
      const seen = mutantWasSeen(input.measured, mutant);
      const witness: MutantWitness =
        ran.accepted && seen && !decided
          ? await adjudicate({
              mutant,
              measured: input.measured,
              checksWithPatch: input.checksWithPatch,
              runner,
              mayRunTheSuite: suiteRunsLeft > 0,
            })
          : "not-adjudicated";
      if (witness === "none" || witness === "repository-suite") {
        suiteRunsLeft -= 1;
      }
      // Adjudicating stops once the verdict cannot change, and which fact the verdict rests on
      // decides when that is. Where the witness is recorded rather than required, an accepted
      // mutant on a line the oracle ran already settles it, so the detectors annotate the mutant
      // that settled it rather than searching for one they can witness: at most one adjudication
      // per patch, and the bound on suite runs is never reached. Where a witness is required, a
      // silent detector settles nothing and the search goes on.
      decided = decided || (requireAWitness ? witnessedADifference(witness) : ran.accepted && seen);
      observations.push({ mutant, oracle: ran.accepted ? "passed" : "failed", seen, witness });
    } finally {
      await runner.write(mutant.path, original);
    }
  }

  return bondOfMutantObservations(observations);
}

/**
 * What, if anything, shows that this mutant changed the program, cheapest detector first.
 *
 * Coverage is one more oracle run and can see behaviour the project did not have before. The
 * repository's own suite is one more suite run and can see a value change on a path that runs
 * either way, which is what coverage cannot. Neither seeing anything is an abstention.
 */
async function adjudicate(input: {
  readonly mutant: Mutant;
  readonly measured: LineHits | null;
  readonly checksWithPatch: readonly CheckStatus[];
  readonly runner: OracleBondRunner;
  readonly mayRunTheSuite: boolean;
}): Promise<MutantWitness> {
  const withMutant = await input.runner.measureLineHits();
  const coverage = coverageWitnessesADifference({
    before: input.measured,
    after: withMutant,
    mutated: input.mutant,
  });
  if (coverage) {
    return "coverage";
  }
  // Nothing to compare against, so nothing to ask. A suite that was not measured with the patch
  // applied, or that had no check pass, cannot witness a mutant breaking it.
  const comparable = input.checksWithPatch.some((check) => check.status === "passed");
  if (!input.mayRunTheSuite || !comparable) {
    return witnessOfADifference({ coverage: false, suite: null });
  }
  const withMutantChecks = await input.runner.runRepositoryChecks();
  return witnessOfADifference({
    coverage: false,
    suite: suiteWitnessesADifference({
      withPatch: input.checksWithPatch,
      withMutant: withMutantChecks,
    }),
  });
}
