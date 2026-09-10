import { type BondVerdict, bondVerdict } from "./bonds.ts";
import type { Mutant } from "./oracle-mutants.ts";

/**
 * The same four words a gate bond carries, one layer up.
 *
 * A gate is bonded with an added file it has to refuse. A task oracle is bonded with a change to
 * the line the patch added, which is the thing the oracle claimed to judge. `not-bonded` is the
 * fourth word rather than the gate machinery's `not-measured`, because what is absent here is a
 * mutant and not a run: an oracle nobody could build a mutant of was never asked anything.
 */
export type OracleBondVerdict = "held" | "vacuous" | "unshown" | "not-bonded";

export interface MutantObservation {
  readonly mutant: Mutant;
  /** What the oracle did with the mutant in place. `failed` is the oracle refusing it. */
  readonly oracle: "passed" | "failed";
  /** Whether the coverage of the oracle's own run names the mutated line with a hit. */
  readonly seen: boolean;
}

export interface BondedMutant extends Mutant {
  readonly verdict: BondVerdict;
}

export interface OracleBond {
  readonly verdict: OracleBondVerdict;
  readonly mutants: readonly BondedMutant[];
}

/**
 * Whether the oracle demonstrably executed the line a mutant changes.
 *
 * The same reading reach already took of the same run, so nothing is measured twice: a line the
 * report names with a nonzero hit count is one the oracle ran, and everything else, an absent
 * file, an absent line, a zero, or a reading nobody could take, is not a demonstration. That is
 * what separates `vacuous` from `unshown`, exactly as `provable` does for a gate bond.
 */
export function mutantWasSeen(
  measured: Readonly<Record<string, Readonly<Record<number, number>>>> | null,
  mutant: Mutant,
): boolean {
  return (measured?.[mutant.path]?.[mutant.line] ?? 0) > 0;
}

/**
 * What a set of mutants showed about the oracle, worst finding first.
 *
 * One mutant the oracle ran and accepted is a demonstrated gap whatever the others did, so
 * `vacuous` outranks `held`: the refusals establish that the oracle can fail, and say nothing
 * about the line it passed over. Below that, a refusal outranks an absence of evidence.
 */
export function bondOfMutantObservations(observations: readonly MutantObservation[]): OracleBond {
  const mutants = observations.map((observation) => ({
    ...observation.mutant,
    verdict: bondVerdict({
      observed: observation.oracle,
      provable: observation.seen,
      collectedBefore: null,
      collectedAfter: null,
    }),
  }));
  const held = mutants.some((one) => one.verdict === "held");
  const vacuous = mutants.some((one) => one.verdict === "vacuous");
  return {
    verdict: mutants.length === 0 ? "not-bonded" : vacuous ? "vacuous" : held ? "held" : "unshown",
    mutants,
  };
}
