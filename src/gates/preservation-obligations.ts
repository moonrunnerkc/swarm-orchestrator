import { asJsonValue } from "../evidence/canonical-json.ts";
import type { GoalContract } from "../evidence/goal-contract.ts";
import type { EvidenceRecorder } from "../evidence/session.ts";

/**
 * What a run must preserve, each obligation tied to where it comes from
 * (preservation-obligations-v1), recorded before the first model call.
 *
 * - **Authoritative**: the task's own sentences about behaviour to keep, and the requirements a
 *   person supplied in a goal contract. The run's model cannot add to these or take them away.
 * - **Observed**: the project's own checks as they stand at the base. What the base does is what
 *   currently happens, not by itself what should happen, so this obligation is the suite's, and
 *   it is settled by the independent verification's regression reading, which already leaves out
 *   failures the base had.
 * - **Proposed**: probes a reviewer chose once a candidate existed. They are added to the record
 *   when they run and are labelled as the model's proposal.
 *
 * A status comes only from what ran. An obligation nothing measured is `unmeasured`, never kept,
 * and a run with none measured says so rather than reporting that it preserved anything. A
 * finite set of obligations is not backward compatibility in general.
 */
export const preservationRule = "preservation-obligations-v1";

export type ObligationSource = "task" | "contract" | "base" | "review";
export type ObligationAuthority = "authoritative" | "observed" | "proposed";

export interface PreservationObligation {
  readonly id: string;
  readonly source: ObligationSource;
  readonly authority: ObligationAuthority;
  /** The obligation in the words of its source: a quote, a requirement, or the base's suite. */
  readonly statement: string;
  readonly basis: string;
}

export type ObligationState = "kept" | "regressed" | "unmeasured";

export interface ObligationStatus extends PreservationObligation {
  readonly status: ObligationState;
  /** What decided the status, or why nothing did. */
  readonly by: string;
}

// "still" only where a behaviour follows it: "invalid options still throw" keeps something,
// "the calls still waiting to run" describes the base.
const keepSentence =
  /\b(must not change|not change|unchanged|as (it does )?today|keeps? (passing|working)|must keep|still (\w+ )?(pass|work|behav|produc|print|throw|reject|resolv|accept|return|run|export|load|build|give|render)\w*|preserv\w*|behaves? as|exactly what it exported|the same (output|behaviou?r|content|html|result)|no warning)\b/i;

/** The task's sentences about behaviour to keep, in its order. */
export function keepStatements(task: string): readonly string[] {
  return task
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?;])\s+(?=[A-Za-z(])/)
    .map((one) => one.trim())
    .filter((one) => one.length > 0 && keepSentence.test(one))
    .slice(0, 12);
}

/** The obligations a run starts with: the task's, the supplied contract's, and the base suite. */
export function initialObligations(input: {
  readonly task: string;
  readonly contract?: GoalContract;
}): readonly PreservationObligation[] {
  const fromTask = keepStatements(input.task).map((statement, index) => ({
    id: `task-keep-${index + 1}`,
    source: "task" as const,
    authority: "authoritative" as const,
    statement,
    basis: "the task's own words",
  }));
  const fromContract = (input.contract?.requirements ?? [])
    .filter((requirement) => requirement.planned === undefined)
    .map((requirement) => ({
      id: `contract-${requirement.id}`,
      source: "contract" as const,
      authority: "authoritative" as const,
      statement: requirement.description,
      basis:
        requirement.checks.length === 0
          ? "a supplied requirement no check decides"
          : `a supplied requirement decided by ${requirement.checks.join(", ")}`,
    }));
  return [
    ...fromTask,
    ...fromContract,
    {
      id: "base-suite",
      source: "base",
      authority: "observed",
      statement: "the project's own checks that pass on the base still pass on the change",
      basis: "the base's own checks, run beside the change on a fresh checkout",
    },
  ];
}

export async function recordObligations(
  evidence: EvidenceRecorder,
  obligations: readonly PreservationObligation[],
): Promise<string> {
  const recorded = await evidence.record({
    type: "verification-command",
    actor: "harness",
    provenance: ["user", "tool-output"],
    payload: asJsonValue({
      rule: preservationRule,
      phase: "declared",
      obligations,
      limitation:
        "a status comes only from what ran; an obligation nothing measured stays unmeasured, and the set examined is finite",
    }),
  });
  return recorded.record.payloadDigest;
}

/** A reviewer's probe as an obligation, once it has run: its basis is the model's proposal. */
export interface ProbeObligation {
  readonly probe: string;
  readonly statement: string;
  readonly quote: string | null;
  /**
   * The readings, on the delivered candidate, of the cases that hold behaviour the base showed
   * (kept, preservation-regression, or another reading where nothing was established).
   */
  readonly readings: readonly string[];
}

const folded = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();

/**
 * Each obligation's status from what measured it on the delivered tree:
 * - the base suite from the independent verification's regression reading;
 * - a supplied requirement from its decided status;
 * - a task sentence only where a probe quoting it ran, and otherwise unmeasured;
 * - a probe from its own case readings.
 */
export function settleObligations(input: {
  readonly obligations: readonly PreservationObligation[];
  /** The independent verification's regression reading of the delivered tree; null where none ran. */
  readonly regression: string | null;
  readonly requirements: readonly { readonly id: string; readonly status: string }[];
  readonly probes: readonly ProbeObligation[];
}): readonly ObligationStatus[] {
  // A case that established nothing (unstable, a defective program, no answer) measures nothing,
  // so it neither keeps an obligation nor breaks one; a probe with no measuring case is unmeasured.
  const probeStatus = (readings: readonly string[]): ObligationState => {
    const measuring = readings.filter(
      (one) => one === "kept" || one === "met" || one === "preservation-regression",
    );
    if (measuring.length === 0) return "unmeasured";
    return measuring.includes("preservation-regression") ? "regressed" : "kept";
  };
  const settled: ObligationStatus[] = input.obligations.map((obligation) => {
    if (obligation.source === "base")
      return {
        ...obligation,
        status:
          input.regression === "pass"
            ? "kept"
            : input.regression === "fail"
              ? "regressed"
              : ("unmeasured" as const),
        by:
          input.regression === null
            ? "no independent verification of the delivered tree"
            : `the independent verification's regression reading: ${input.regression}`,
      };
    if (obligation.source === "contract") {
      const found = input.requirements.find((one) => `contract-${one.id}` === obligation.id);
      return {
        ...obligation,
        status:
          found?.status === "accepted"
            ? "kept"
            : found?.status === "rejected"
              ? "regressed"
              : "unmeasured",
        by: found === undefined ? "not judged" : `its checks: ${found.status}`,
      };
    }
    const quoting = input.probes.filter(
      (probe) =>
        probe.quote !== null &&
        folded(obligation.statement).includes(folded(probe.quote).slice(0, 120)),
    );
    const status = probeStatus(quoting.flatMap((probe) => probe.readings));
    return {
      ...obligation,
      status,
      by:
        quoting.length === 0
          ? "no check here states it; it is the task's word, not a measurement"
          : `review probe(s) ${quoting.map((probe) => probe.probe).join(", ")}`,
    };
  });
  for (const probe of input.probes)
    settled.push({
      id: `review-${probe.probe}`,
      source: "review",
      authority: "proposed",
      statement: probe.statement,
      basis: "a reviewer's probe: the inputs are the model's choice, the answers the harness's",
      status: probeStatus(probe.readings),
      by: probe.readings.length === 0 ? "it established nothing" : "its case readings",
    });
  return settled;
}

/** One line for the report, which never reads an empty or unmeasured set as preserved. */
export function describePreservation(statuses: readonly ObligationStatus[]): string {
  const count = (state: ObligationState) => statuses.filter((one) => one.status === state).length;
  const measured = count("kept") + count("regressed");
  if (measured === 0)
    return `preservation: nothing measured (${statuses.length} obligation(s), every one unmeasured)`;
  return `preservation: ${count("kept")} kept, ${count("regressed")} regressed, ${count("unmeasured")} unmeasured, of ${statuses.length} obligation(s) from the task, the supplied contract, the base suite and review probes`;
}
