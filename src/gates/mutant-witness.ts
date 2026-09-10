import type { Mutant } from "./oracle-mutants.ts";

/**
 * Whether anything showed that a mutant changed what the program does.
 *
 * The fact the bond was missing. `vacuous` says the oracle ran a line and accepted a change to
 * it, and that only means something if the change was a change: a mutant that does nothing is
 * otherwise indistinguishable from an oracle that failed to notice one that did. The audit that
 * told them apart was a person reading each mutated line, which found two equivalent mutants,
 * does not scale, and is not evidence anybody else can re-derive.
 *
 * `none` is an abstention and never a refusal. `not-adjudicated` is a different absence: the
 * second detector was never spent, and flattening that into either answer is the collapse of
 * *unmeasured* into an opinion.
 */
export type MutantWitness = "coverage" | "repository-suite" | "none" | "not-adjudicated";

export type LineHits = Readonly<Record<string, Readonly<Record<number, number>>>>;

/**
 * Whether the oracle's own coverage ran a different set of lines with the mutant in place.
 *
 * A line that ran in one reading and not in the other is a demonstrated difference in what the
 * program did, and it is available for behaviour a project did not have before, which is where
 * the repository's own suite is silent by construction.
 *
 * Three narrowings, each of them the conservative direction, because a false witness is a false
 * refusal:
 *
 *   - The mutated line is excluded. A deleted statement stops running by construction and that is
 *     not a finding about anybody's tests.
 *   - Presence and absence only, never a hit count that moved. A count is the flakier signal.
 *   - Only lines both readings name. A line one names and the other does not is a difference in
 *     what the instrumentation saw rather than in what the program did.
 */
export function coverageWitnessesADifference(input: {
  readonly before: LineHits | null;
  readonly after: LineHits | null;
  readonly mutated: Pick<Mutant, "path" | "line">;
}): boolean {
  const { before, after } = input;
  if (before === null || after === null) {
    return false;
  }
  for (const [path, beforeLines] of Object.entries(before)) {
    const afterLines = after[path];
    if (afterLines === undefined) {
      continue;
    }
    for (const [line, beforeHits] of Object.entries(beforeLines)) {
      const afterHits = afterLines[Number(line)];
      if (afterHits === undefined) {
        continue;
      }
      if (path === input.mutated.path && Number(line) === input.mutated.line) {
        continue;
      }
      if (beforeHits > 0 !== afterHits > 0) {
        return true;
      }
    }
  }
  return false;
}

/** What a check said, which is the only part of an independent check this reads. */
interface CheckStatus {
  readonly id: string;
  readonly status: "passed" | "failed" | "not-applicable";
}

/**
 * Whether the repository's own checks refuse the mutant.
 *
 * Only a check that passed with the patch applied is read. One that was already failing fails
 * either way, and charging that to the mutant is the error inherited attribution exists to stop.
 * A check the second run did not report witnesses nothing rather than counting as a change.
 *
 * What this detector cannot see, named because it decides how often it is silent: a suite written
 * before the patch existed cannot notice a mutant of behaviour the patch is adding. On a change
 * that adds a feature this answers `false` by construction, which is why it is the second
 * detector and not the only one.
 */
export function suiteWitnessesADifference(input: {
  readonly withPatch: readonly CheckStatus[];
  readonly withMutant: readonly CheckStatus[];
}): boolean {
  const onTheMutant = new Map(input.withMutant.map((check) => [check.id, check.status]));
  return input.withPatch.some(
    (check) => check.status === "passed" && onTheMutant.get(check.id) === "failed",
  );
}

/**
 * Which detector answered, cheapest first.
 *
 * Coverage is another oracle run; the suite is another suite run. `suite: null` means that second
 * run was not spent, either because coverage had already answered or because the bound on suite
 * runs was reached.
 */
export function witnessOfADifference(input: {
  readonly coverage: boolean;
  readonly suite: boolean | null;
}): MutantWitness {
  if (input.coverage) {
    return "coverage";
  }
  if (input.suite === null) {
    return "not-adjudicated";
  }
  return input.suite ? "repository-suite" : "none";
}

/** Whether a witness is a demonstration, which is the one thing `vacuous` may rest on. */
export function witnessedADifference(witness: MutantWitness): boolean {
  return witness === "coverage" || witness === "repository-suite";
}

/**
 * Whether a mutant the oracle ran and accepted has to be witnessed before it refuses.
 *
 * The one place the decision lives, so either regime is one line and the evidence beside it. Both
 * are measured and published, because the choice between them is the finding rather than the
 * number either produces, and `docs/oracle-bond-operators.md` carries the conditions.
 *
 * `true` is the stricter reading of `vacuous`: two facts, and an accepted mutant nothing shows
 * changed anything is an abstention. Its cost is measured, one true catch on this corpus and no
 * false refusal prevented. `false` keeps the two facts apart, refusing on what `vacuous` has
 * always meant and recording the witness beside it, so the audit reads only the refusals nothing
 * witnessed.
 */
export const vacuousRequiresAWitness: boolean = true;
