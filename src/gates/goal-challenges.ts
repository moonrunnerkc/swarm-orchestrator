import { asJsonValue, digestOfBytes } from "../evidence/canonical-json.ts";
import type { GoalContract } from "../evidence/goal-contract.ts";
import type { EvidenceRecorder } from "../evidence/session.ts";
import type { GoalVerification } from "./goal-acceptance.ts";
import { mustBeShownToParseFor, type ParseCheckReading, readParseCheck } from "./mutant-parse.ts";
import { suiteWitnessesADifference } from "./mutant-witness.ts";
import type { CheckStatus } from "./oracle-bond-run.ts";
import { type Mutant, mutantsOfChangedLines } from "./oracle-mutants.ts";

/**
 * Requirement-level challenges: for each requirement of a goal contract, does the check bound
 * to it distinguish valid work from invalid work? Four questions, each answered from an
 * execution rather than from an opinion.
 *
 *   1. Original defect: do the requirement's checks reject the base tree and accept the
 *      candidate? A check that accepts both would have accepted a patch that changes nothing.
 *      Under a refactor preset the base is expected to pass, and passing is `preserved`.
 *   2. Incorrect alternative: written into a disposable copy of the candidate, does a mechanical
 *      mutation of the changed lines, or a sealed fixture the author declares to violate the
 *      requirement, get rejected by the requirement's checks? A surviving mutation counts as a
 *      demonstrated gap only with a witness that it changed the program: the repository's own
 *      suite refusing it. A survivor nobody witnessed is uncertainty, and is named as such.
 *   3. Evidence and instrument: the checks run under the sealed contract, on a tree whose
 *      identity is recorded, with artifacts held immutable; each run here carries that tree.
 *   4. Missing obligation: a requirement with no runnable check, or whose check could not
 *      execute, is a named gap with a remedy, never a pass.
 *
 * Every challenge selected, attempted and skipped is recorded with its reason, in a plan
 * written before anything runs. Selection is deterministic: the operators in their declared
 * order, the fixtures in the contract's order, and a recorded seed naming that rule.
 */
export const challengePolicies = ["off", "report", "required"] as const;
export type ChallengePolicy = (typeof challengePolicies)[number];

export const challengeSeed = "deterministic-v1";
export const challengeOperators = "oracle-bond-operators-v1";

/** How many repository suite runs one verification may spend witnessing survivors. */
export const suiteRunsPerVerification = 2;

export type ContractCheckStatus = "accepted" | "rejected" | "unjudged";

/** One execution of every contract check over the tree as it stands. */
export interface ContractRun {
  readonly tree: string;
  readonly checks: readonly {
    readonly id: string;
    readonly status: ContractCheckStatus;
    readonly detail: string;
  }[];
}

export interface ChallengeRunner {
  read(path: string): Promise<string | null>;
  write(path: string, text: string): Promise<void>;
  parses(path: string): Promise<boolean>;
  runContractChecks(): Promise<ContractRun>;
  runRepositoryChecks(): Promise<readonly CheckStatus[]>;
  applyFixture(patch: string): Promise<{ readonly applied: boolean; readonly detail: string }>;
  /** Put the candidate tree back after a fixture. */
  restore(): Promise<boolean>;
}

export type BaseControlReading =
  | "discriminates"
  | "vacuous"
  | "preserved"
  | "unavailable"
  | "not-run";

export type AlternativeWitness =
  | "repository-suite"
  | "declared-fixture"
  | "none"
  | "not-adjudicated";

export interface AlternativeOutcome {
  readonly id: string;
  readonly kind: "mutant" | "fixture";
  readonly mutant?: Mutant;
  readonly fixture?: { readonly id: string; readonly requirement: string; readonly digest: string };
  readonly parse: ParseCheckReading | "not-checked" | "not-applied";
  readonly tree: string | null;
  readonly requirements: readonly { readonly id: string; readonly status: ContractCheckStatus }[];
  readonly suite: "failed" | "passed" | "not-run";
  readonly witness: AlternativeWitness;
}

export type RequirementChallengeReading =
  | "detected"
  | "gap"
  | "invalid-evidence"
  | "unjudged"
  | "inapplicable";

export interface RequirementChallengeOutcome {
  readonly id: string;
  readonly baseControl: BaseControlReading;
  readonly caught: readonly string[];
  readonly gaps: readonly string[];
  readonly unwitnessed: readonly string[];
  readonly invalid: readonly string[];
  readonly outcome: RequirementChallengeReading;
  readonly detail: string;
}

export interface ChallengeReport {
  readonly policy: ChallengePolicy;
  readonly contractDigest: string;
  readonly seed: typeof challengeSeed;
  readonly operators: typeof challengeOperators;
  readonly baseTree: string | null;
  readonly alternatives: readonly AlternativeOutcome[];
  readonly requirements: readonly RequirementChallengeOutcome[];
  /** Whether every requirement demonstrated detection; what `required` mode enforces. */
  readonly satisfied: boolean;
  /** The payload digest of the challenge verdict record. */
  readonly record: string;
}

/** The status of a requirement given the statuses of its checks, by the goal verifier's rule. */
export function requirementStatus(
  requirement: GoalContract["requirements"][number],
  checks: readonly { readonly id: string; readonly status: ContractCheckStatus }[],
): ContractCheckStatus {
  const statuses = requirement.checks.map(
    (id) => checks.find((check) => check.id === id)?.status ?? "unjudged",
  );
  if (statuses.length === 0 || statuses.includes("unjudged")) return "unjudged";
  return statuses.every((status) => status === "accepted") ? "accepted" : "rejected";
}

/** Family 1, read off the base-control verification the goal verifier already records. */
export function readBaseControl(
  requirementId: string,
  base: GoalVerification | null,
  presetKind: string | undefined,
): BaseControlReading {
  if (base === null) return "not-run";
  const obligation = base.obligations.find((entry) => entry.id === requirementId);
  if (obligation === undefined || obligation.status === "unjudged") return "unavailable";
  if (obligation.status === "rejected") return "discriminates";
  return presetKind === "refactor" ? "preserved" : "vacuous";
}

/**
 * The per-requirement reading, from what was observed and nothing else. Exported so the
 * offline verifier's independent implementation can be held to the same cases.
 */
export function readRequirementOutcome(input: {
  readonly requirement: GoalContract["requirements"][number];
  readonly candidate: ContractCheckStatus;
  readonly baseControl: BaseControlReading;
  readonly alternatives: readonly AlternativeOutcome[];
}): RequirementChallengeOutcome {
  const { requirement } = input;
  const caught: string[] = [];
  const gaps: string[] = [];
  const unwitnessed: string[] = [];
  const invalid: string[] = [];
  for (const one of input.alternatives) {
    const relevant = one.kind === "mutant" || one.fixture?.requirement === requirement.id;
    if (!relevant) continue;
    if (
      one.parse === "not-applied" ||
      one.parse === "syntax-error" ||
      one.parse === "dialect-unreadable"
    ) {
      if (one.kind === "fixture") invalid.push(one.id);
      continue;
    }
    const status =
      one.requirements.find((entry) => entry.id === requirement.id)?.status ?? "unjudged";
    if (status === "rejected") caught.push(one.id);
    else if (status === "unjudged") invalid.push(one.id);
    else if (one.witness === "repository-suite" || one.witness === "declared-fixture")
      gaps.push(one.id);
    else unwitnessed.push(one.id);
  }
  const finish = (
    outcome: RequirementChallengeReading,
    detail: string,
  ): RequirementChallengeOutcome => ({
    id: requirement.id,
    baseControl: input.baseControl,
    caught,
    gaps,
    unwitnessed,
    invalid,
    outcome,
    detail,
  });
  if (requirement.checks.length === 0)
    return finish(
      "gap",
      "no check is bound to this requirement, so nothing can detect wrong work against it; bind an executable check",
    );
  if (input.candidate === "unjudged")
    return finish(
      "invalid-evidence",
      "a check bound to this requirement could not execute on the candidate, so nothing here is evidence about it",
    );
  if (input.baseControl === "vacuous")
    return finish(
      "gap",
      "the checks accept the base tree as well, so they would have accepted a change that does nothing; make at least one check fail before the work",
    );
  if (gaps.length > 0)
    return finish(
      "gap",
      `the checks accepted ${gaps.length} alternative(s) the repository's own evidence shows changed the program: ${gaps.join(", ")}`,
    );
  if (invalid.length > 0)
    return finish(
      "invalid-evidence",
      `${invalid.length} challenge(s) could not be executed as evidence: ${invalid.join(", ")}`,
    );
  if (
    caught.length > 0 &&
    (input.baseControl === "discriminates" || input.baseControl === "preserved")
  )
    return finish(
      "detected",
      `the checks ${input.baseControl === "preserved" ? "preserved the base behaviour and " : "reject the base and "}rejected ${caught.length} alternative(s)${unwitnessed.length === 0 ? "" : `; ${unwitnessed.length} survived without a witness that it changed the program`}`,
    );
  if (caught.length > 0)
    return finish(
      "unjudged",
      `the checks rejected ${caught.length} alternative(s), and the base control was ${input.baseControl}, so detection is shown for alternatives only`,
    );
  return finish(
    "unjudged",
    unwitnessed.length > 0
      ? `${unwitnessed.length} alternative(s) survived the checks with no witness that they changed the program; a survivor without a witness is uncertainty, not a defect`
      : "no challenge could be executed against this requirement: no mutation of the changed lines was buildable and no fixture names it. Supply a sealed fixture that violates it",
  );
}

export interface ChallengeInput {
  readonly contract: GoalContract;
  readonly contractDigest: string;
  readonly policy: ChallengePolicy;
  readonly evidence: EvidenceRecorder;
  readonly runner: ChallengeRunner;
  readonly changed: readonly {
    readonly path: string;
    readonly addedLines: readonly { readonly line: number; readonly text: string }[];
  }[];
  readonly candidate: GoalVerification | null;
  readonly baseControl: GoalVerification | null;
  readonly checksWithPatch: readonly CheckStatus[];
  readonly suiteRunLimit?: number;
}

async function record(evidence: EvidenceRecorder, rule: string, payload: Record<string, unknown>) {
  const entry = await evidence.record({
    type: "verification-command",
    actor: "harness",
    provenance: ["tool-output"],
    payload: asJsonValue({ rule, ...payload }),
  });
  return entry.record.payloadDigest;
}

/** An interrupted challenge left an intent with no completion; nothing may proceed over it. */
export class ChallengeReconciliationError extends Error {
  readonly unfinished: readonly string[];
  constructor(unfinished: readonly string[]) {
    super(
      `challenge run(s) ${unfinished.join(", ")} recorded an intent and no completion: a cancelled or crashed challenge left the checkout in doubt, and the run must be reconciled before another challenge is executed`,
    );
    this.name = "ChallengeReconciliationError";
    this.unfinished = unfinished;
  }
}

/** Every challenge intent on the chain that no completion answers, in order. */
export function unfinishedChallenges(evidence: EvidenceRecorder): readonly string[] {
  const open = new Map<string, true>();
  for (const entry of evidence.records()) {
    if (entry.type !== "verification-command") continue;
    const payload = evidence.payloads().get(entry.payloadDigest) as
      | { rule?: string; phase?: string; id?: string; plan?: string }
      | undefined;
    if (payload?.rule !== "challenge-run-v1" || typeof payload.id !== "string") continue;
    const key = `${payload.plan}:${payload.id}`;
    if (payload.phase === "intent") open.set(key, true);
    else if (payload.phase === "completed") open.delete(key);
  }
  return [...open.keys()].map((key) => key.slice(key.indexOf(":") + 1));
}

/** Run every planned challenge, recording each, and read the requirement outcomes. */
export async function challengeGoal(input: ChallengeInput): Promise<ChallengeReport> {
  const { contract, evidence, runner } = input;
  const unfinished = unfinishedChallenges(evidence);
  if (unfinished.length > 0) throw new ChallengeReconciliationError(unfinished);
  const presetKind = contract.preset?.kind;
  const mutants =
    contract.challenges?.mutations === "none"
      ? []
      : mutantsOfChangedLines({ changed: input.changed });
  const fixtures = contract.challenges?.fixtures ?? [];
  const planRecord = await record(evidence, "challenge-plan-v1", {
    contractDigest: input.contractDigest,
    policy: input.policy,
    seed: challengeSeed,
    operators: challengeOperators,
    suiteRunLimit: input.suiteRunLimit ?? suiteRunsPerVerification,
    mutants: mutants.map((mutant) => mutant.id),
    fixtures: fixtures.map((fixture) => ({
      id: fixture.id,
      requirement: fixture.requirement,
      digest: digestOfBytes(fixture.patch),
    })),
    requirements: contract.requirements.map((requirement) => requirement.id),
  });
  const alternatives: AlternativeOutcome[] = [];
  let suiteRunsLeft = input.suiteRunLimit ?? suiteRunsPerVerification;

  const requirementsOf = (run: ContractRun) =>
    contract.requirements.map((requirement) => ({
      id: requirement.id,
      status: requirementStatus(requirement, run.checks),
    }));

  const adjudicate = async (requirements: readonly { readonly status: ContractCheckStatus }[]) => {
    // Survived: some requirement judged the alternative and none rejected it. A requirement
    // with no check is unjudged and neither catches nor excuses anything.
    const survived =
      requirements.some((entry) => entry.status === "accepted") &&
      !requirements.some((entry) => entry.status === "rejected");
    if (!survived) return { suite: "not-run" as const, witness: "not-adjudicated" as const };
    if (suiteRunsLeft <= 0 || !input.checksWithPatch.some((check) => check.status === "passed"))
      return { suite: "not-run" as const, witness: "none" as const };
    suiteRunsLeft -= 1;
    const withAlternative = await runner.runRepositoryChecks();
    const witnessed = suiteWitnessesADifference({
      withPatch: input.checksWithPatch,
      withMutant: withAlternative,
    });
    return {
      suite: witnessed ? ("failed" as const) : ("passed" as const),
      witness: witnessed ? ("repository-suite" as const) : ("none" as const),
    };
  };

  for (const mutant of mutants) {
    const original = await runner.read(mutant.path);
    if (original === null) continue;
    const lines = original.split("\n");
    if (lines[mutant.line - 1] !== mutant.before) continue;
    const checkTheParse = mustBeShownToParseFor(mutant.path, mutant.operator);
    const originalParses = checkTheParse ? await runner.parses(mutant.path) : true;
    await record(evidence, "challenge-run-v1", {
      phase: "intent",
      plan: planRecord,
      id: mutant.id,
      kind: "mutant",
      mutant,
    });
    lines[mutant.line - 1] = mutant.after;
    await runner.write(mutant.path, lines.join("\n"));
    let outcome: AlternativeOutcome;
    try {
      const parse: AlternativeOutcome["parse"] = checkTheParse
        ? readParseCheck({ originalParses, mutantParses: await runner.parses(mutant.path) })
        : "not-checked";
      if (parse === "syntax-error" || parse === "dialect-unreadable") {
        outcome = {
          id: mutant.id,
          kind: "mutant",
          mutant,
          parse,
          tree: null,
          requirements: [],
          suite: "not-run",
          witness: "not-adjudicated",
        };
      } else {
        const run = await runner.runContractChecks();
        const requirements = requirementsOf(run);
        const judged = await adjudicate(requirements);
        outcome = {
          id: mutant.id,
          kind: "mutant",
          mutant,
          parse,
          tree: run.tree,
          requirements,
          ...judged,
        };
      }
    } finally {
      await runner.write(mutant.path, original);
    }
    alternatives.push(outcome);
    await record(evidence, "challenge-run-v1", {
      phase: "completed",
      plan: planRecord,
      ...outcome,
    });
  }

  for (const fixture of fixtures) {
    const identity = {
      id: fixture.id,
      requirement: fixture.requirement,
      digest: digestOfBytes(fixture.patch),
    };
    await record(evidence, "challenge-run-v1", {
      phase: "intent",
      plan: planRecord,
      id: fixture.id,
      kind: "fixture",
      fixture: identity,
    });
    let outcome: AlternativeOutcome;
    const applied = await runner.applyFixture(fixture.patch);
    let restored = true;
    try {
      if (!applied.applied) {
        outcome = {
          id: fixture.id,
          kind: "fixture",
          fixture: identity,
          parse: "not-applied",
          tree: null,
          requirements: [],
          suite: "not-run",
          witness: "not-adjudicated",
        };
      } else {
        const run = await runner.runContractChecks();
        const requirements = requirementsOf(run);
        const named = requirements.find((entry) => entry.id === fixture.requirement)?.status;
        // A declared fixture carries its own authority: the author sealed it as a violation, so
        // a requirement that accepts it has been shown a gap without a suite run.
        outcome = {
          id: fixture.id,
          kind: "fixture",
          fixture: identity,
          parse: "not-checked",
          tree: run.tree,
          requirements,
          suite: "not-run",
          witness: named === "accepted" ? "declared-fixture" : "not-adjudicated",
        };
      }
    } finally {
      restored = await runner.restore();
    }
    if (!restored)
      throw new Error(`the candidate tree could not be restored after fixture ${fixture.id}`);
    alternatives.push(outcome);
    await record(evidence, "challenge-run-v1", {
      phase: "completed",
      plan: planRecord,
      ...outcome,
    });
  }

  const requirements = contract.requirements.map((requirement) =>
    readRequirementOutcome({
      requirement,
      candidate:
        input.candidate?.obligations.find((entry) => entry.id === requirement.id)?.status ??
        "unjudged",
      baseControl: readBaseControl(requirement.id, input.baseControl, presetKind),
      alternatives,
    }),
  );
  const satisfied = requirements.every((entry) => entry.outcome === "detected");
  const verdict: Omit<ChallengeReport, "record"> & { readonly plan: string } = {
    contractDigest: input.contractDigest,
    policy: input.policy,
    seed: challengeSeed,
    operators: challengeOperators,
    plan: planRecord,
    baseTree: input.baseControl?.tree ?? null,
    alternatives,
    requirements,
    satisfied,
  };
  const recorded = await record(evidence, "challenge-verdict-v1", verdict);
  return { ...verdict, record: recorded };
}
