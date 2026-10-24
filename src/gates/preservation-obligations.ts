import { asJsonValue } from "../evidence/canonical-json.ts";
import type { GoalContract } from "../evidence/goal-contract.ts";
import type { EvidenceRecorder } from "../evidence/session.ts";
import { type TaskExample, taskCodeStatements } from "../task-code-statements.ts";

/**
 * What a run must do and keep, each obligation tied to where it comes from
 * (preservation-obligations-v2), recorded before the first model call. Four kinds, kept apart:
 *
 * - **Requested**: behaviour the task adds or changes, as a supplied requirement states it. A met
 *   requirement is new behaviour produced, never behaviour preserved.
 * - **Explicit preserve**: behaviour the task requires kept, in the task's own sentences or in a
 *   supplied requirement marked `intent: "preserve"`. Authoritative: the run's model cannot add to
 *   these or take them away.
 * - **Observed**: the project's own checks as they stand at the base. What the base does is what
 *   currently happens, not by itself what should happen; settled by the independent
 *   verification's regression reading, which leaves out failures the base already had.
 * - **Proposed**: probes a reviewer chose once a candidate existed, labelled as the model's.
 *
 * A status comes only from what ran, at the delivered tree. `held` is said only where a check
 * measured the obligation as it is stated (the base's suite; a supplied requirement's own
 * check). Examples never stand for a broad statement: a task sentence a probe exercised, with
 * every case keeping the base's answer, is `exercised`, with the cases named, and an obligation
 * nothing measured is `unmeasured`. Every task sentence is kept, either as an obligation or as
 * unclassified task text; nothing is dropped for a count, and the extraction says what it can
 * miss.
 */
export const preservationRule = "preservation-obligations-v2";

export type ObligationSource = "task" | "contract" | "base" | "review";
export type ObligationAuthority = "authoritative" | "observed" | "proposed";
export type ObligationCategory = "requested" | "explicit-preserve" | "observed" | "proposed";

export interface PreservationObligation {
  readonly id: string;
  readonly source: ObligationSource;
  readonly category: ObligationCategory;
  readonly authority: ObligationAuthority;
  /** The obligation in the words of its source: a quote, a requirement, or the base's suite. */
  readonly statement: string;
  readonly basis: string;
}

/**
 * - `held`: a check measured the obligation as stated, on the delivered tree, and it held.
 * - `exercised`: examples of it were run and every one kept the base's answer; a sample, not the
 *   whole statement.
 * - `regressed`: something that measured it failed on the delivered tree.
 * - `met` / `unmet`: a requested behaviour's own check accepted or rejected it.
 * - `unmeasured`: nothing that ran decided it.
 */
export type ObligationState = "held" | "exercised" | "regressed" | "met" | "unmet" | "unmeasured";

/** One measurement behind a status: what was run, with what, and what each tree gave. */
export interface ObligationEvidence {
  /** The check or probe that ran, and which case where it has cases. */
  readonly check: string;
  readonly input?: unknown;
  readonly base: string | null;
  readonly candidate: string | null;
  readonly reading: string;
}

export interface ObligationStatus extends PreservationObligation {
  readonly status: ObligationState;
  /** What decided the status, or why nothing did. */
  readonly by: string;
  readonly evidence: readonly ObligationEvidence[];
}

/**
 * The extraction's own limit, recorded beside what it found: it reads keep wording, so a
 * sentence that asks for behaviour to be kept in other words is retained as unclassified task
 * text rather than read as an obligation, and nothing measures it.
 */
export const extractionLimit =
  "task sentences are classified by keep wording (unchanged, preserved, still, as today, must remain, must continue, and the like), except a sentence whose own code examples are all ones the task asks for or describes as today's behaviour; any other sentence is retained as unclassified task text, not read as an obligation, and nothing measures it";

// "still" only where a behaviour follows it: "invalid options still throw" keeps something,
// "the calls still waiting to run" describes the base. A modal followed by a verb of staying
// ("must remain", "should continue to", "has to stay") is the same requirement in other words.
const keepSentence =
  /\b(must not change|not change|unchanged|as (it does )?today|keeps? (passing|working)|must keep|still (\w+ )?(pass|work|behav|produc|print|throw|reject|resolv|accept|return|run|export|load|build|give|render)\w*|preserv\w*|behaves? as|exactly what it exported|the same (output|behaviou?r|content|html|result)|no warning|(must|should|shall|has to|have to|needs? to) (still |always )?(remain|stay|continue)\w*)\b/i;

/** The task's sentences, in order, whitespace folded. */
export function taskSentences(task: string): readonly string[] {
  return task
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?;])\s+(?=[A-Za-z(])/)
    .map((one) => one.trim())
    .filter((one) => one.length > 0);
}

/**
 * Whether a sentence's own code says it states new behaviour: it writes examples, and none is one
 * to keep. "withoutBase returns input unchanged (withoutBase(\"/admin-dashboard\", \"/admin/\")
 * is \"/admin-dashboard\")" has keep wording and asks for a change; read as an obligation to keep,
 * it let a reviewer's probe call the requested answer a regression (October 24, C2).
 */
function statesNewBehaviour(sentence: string, task: string): boolean {
  const examples = taskCodeStatements(task).filter(
    (one): one is TaskExample => one.kind === "example" && sentence.includes(one.call),
  );
  return examples.length > 0 && examples.every((one) => one.role !== "preserve");
}

const keeps = (sentence: string, task: string) =>
  keepSentence.test(sentence) && !statesNewBehaviour(sentence, task);

/** The task's sentences about behaviour to keep, in its order, every one of them. */
export function keepStatements(task: string): readonly string[] {
  return taskSentences(task).filter((one) => keeps(one, task));
}

/** The task's other sentences, retained as they are: neither an obligation nor dropped. */
export function unclassifiedSentences(task: string): readonly string[] {
  return taskSentences(task).filter((one) => !keeps(one, task));
}

/** The obligations a run starts with: the task's, the supplied contract's, and the base suite. */
export function initialObligations(input: {
  readonly task: string;
  readonly contract?: GoalContract;
}): readonly PreservationObligation[] {
  const fromTask = keepStatements(input.task).map((statement, index) => ({
    id: `task-keep-${index + 1}`,
    source: "task" as const,
    category: "explicit-preserve" as const,
    authority: "authoritative" as const,
    statement,
    basis: "the task's own words",
  }));
  const fromContract = (input.contract?.requirements ?? [])
    .filter((requirement) => requirement.planned === undefined)
    .map((requirement) => ({
      id: `contract-${requirement.id}`,
      source: "contract" as const,
      category:
        requirement.intent === "preserve" ? ("explicit-preserve" as const) : ("requested" as const),
      authority: "authoritative" as const,
      statement: requirement.description,
      basis:
        requirement.checks.length === 0
          ? "a supplied requirement no check decides"
          : `a supplied requirement decided by ${requirement.checks.join(", ")}`,
    }));
  // The task's own examples and relations written as code (task-code-v1): each is an obligation
  // as exact as its literal, requested or kept by the sentence's own verb. One the task describes
  // as today's behaviour is what it asks to change, and is no obligation.
  const fromCode = taskCodeStatements(input.task).flatMap((one) =>
    one.kind === "relation"
      ? [
          {
            id: one.id,
            source: "task" as const,
            category: "requested" as const,
            authority: "authoritative" as const,
            statement: `${one.subject} equals ${one.reference}${one.domain === null ? "" : one.domain === "unfollowed" ? " (over a domain the reader could not apply)" : ` for every ${one.variable} containing ${JSON.stringify(one.domain.contains)}`}`,
            basis: `the task's own code: "${one.sentence}"`,
          },
        ]
      : one.role === "base"
        ? []
        : [
            {
              id: one.id,
              source: "task" as const,
              category:
                one.role === "preserve" ? ("explicit-preserve" as const) : ("requested" as const),
              authority: "authoritative" as const,
              statement: `${one.call} gives ${JSON.stringify(one.expected)}`,
              basis: `the task's own code: "${one.sentence}"`,
            },
          ],
  );
  return [
    ...fromTask,
    ...fromCode,
    ...fromContract,
    {
      id: "base-suite",
      source: "base",
      category: "observed",
      authority: "observed",
      statement: "the project's own checks that pass on the base still pass on the change",
      basis: "the base's own checks, run beside the change on a fresh checkout",
    },
  ];
}

/**
 * The obligations a review's preservation finding may rest on: those the task or the person
 * supplying its contract stated as behaviour to keep. The base's suite is observed, not stated,
 * and a requested behaviour is new; neither makes a difference from the base a regression.
 */
export function reviewAuthorities(
  obligations: readonly PreservationObligation[],
): readonly { readonly id: string; readonly statement: string }[] {
  return obligations
    .filter((one) => one.category === "explicit-preserve")
    .map(({ id, statement }) => ({ id, statement }));
}

export async function recordObligations(
  evidence: EvidenceRecorder,
  obligations: readonly PreservationObligation[],
  task: string,
): Promise<string> {
  const recorded = await evidence.record({
    type: "verification-command",
    actor: "harness",
    provenance: ["user", "tool-output"],
    payload: asJsonValue({
      rule: preservationRule,
      phase: "declared",
      obligations,
      unclassified: unclassifiedSentences(task),
      extraction: extractionLimit,
      limitation:
        "a status comes only from what ran; an obligation nothing measured stays unmeasured, an example never stands for a broad statement, and the set examined is finite",
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
   * The cases, on the delivered candidate, that hold behaviour the base showed: each with its
   * input, what the base and the candidate gave, and its reading.
   */
  readonly cases: readonly {
    readonly index: number;
    readonly input: unknown;
    readonly base: string | null;
    readonly candidate: string | null;
    readonly reading: string;
  }[];
  /** The obligation this probe's quote names, where it names an authoritative one. */
  readonly obligation: string | null;
  /** `task` where the harness built the probe from the task's own code: not a proposal. */
  readonly origin?: "task";
}

/**
 * Each obligation's status from what measured it on the delivered tree:
 * - the base suite from the independent verification's regression reading;
 * - a supplied requirement from its decided status, as met or unmet where it is requested and as
 *   held or regressed where it is marked preserve;
 * - a task sentence from the probes that name it, exercised at most;
 * - a probe from its own case readings, exercised at most, and always the model's proposal.
 */
export function settleObligations(input: {
  readonly obligations: readonly PreservationObligation[];
  /** The independent verification's regression reading of the delivered tree; null where none ran. */
  readonly regression: string | null;
  /** Checks the base already failed that the delivered tree fails the same way, by name. */
  readonly inherited?: readonly string[];
  readonly requirements: readonly { readonly id: string; readonly status: string }[];
  readonly probes: readonly ProbeObligation[];
}): readonly ObligationStatus[] {
  // A case that established nothing (unstable, a defective program, no answer) measures nothing,
  // so it neither keeps an obligation nor breaks one; a probe with no measuring case is unmeasured.
  // A regression in any case is a regression. Exercised needs every case to have measured.
  const probeStatus = (cases: ProbeObligation["cases"]): ObligationState => {
    const readings = cases.map((one) => one.reading);
    if (readings.includes("preservation-regression")) return "regressed";
    return readings.length > 0 && readings.every((one) => one === "kept")
      ? "exercised"
      : "unmeasured";
  };
  // A statement of the task's code: an example is measured as stated, by its one call; a relation
  // only at the inputs it was run on. Anything a case could not read leaves it unmeasured.
  const codeStatus = (obligation: PreservationObligation, cases: ProbeObligation["cases"]) => {
    const readings = cases.map((one) => one.reading);
    if (readings.includes("preservation-regression")) return "regressed" as const;
    if (readings.includes("requested-unmet") || readings.includes("relation-violated"))
      return "unmet" as const;
    if (readings.length === 0 || !readings.every((one) => ["kept", "met", "related"].includes(one)))
      return "unmeasured" as const;
    if (readings.every((one) => one === "kept")) return "held" as const;
    return obligation.id.startsWith("code-relation-") ? ("exercised" as const) : ("met" as const);
  };
  const evidenceOf = (probe: ProbeObligation): readonly ObligationEvidence[] =>
    probe.cases.map((one) => ({
      check: `review probe ${probe.probe}, case ${one.index}`,
      input: one.input,
      base: one.base,
      candidate: one.candidate,
      reading: one.reading,
    }));
  const inherited = input.inherited ?? [];
  const settled: ObligationStatus[] = input.obligations.map((obligation) => {
    if (obligation.source === "base")
      return {
        ...obligation,
        status:
          input.regression === "pass"
            ? "held"
            : input.regression === "fail"
              ? "regressed"
              : ("unmeasured" as const),
        by:
          input.regression === null
            ? "no independent verification of the delivered tree"
            : `the independent verification's regression reading: ${input.regression}` +
              (inherited.length === 0
                ? ""
                : `; failures the base already had remain in ${inherited.join(", ")}`),
        evidence: [],
      };
    if (obligation.source === "contract") {
      const found = input.requirements.find((one) => `contract-${one.id}` === obligation.id);
      const preserve = obligation.category === "explicit-preserve";
      const status: ObligationState =
        found?.status === "accepted"
          ? preserve
            ? "held"
            : "met"
          : found?.status === "rejected"
            ? preserve
              ? "regressed"
              : "unmet"
            : "unmeasured";
      return {
        ...obligation,
        status,
        by: found === undefined ? "not judged" : `its supplied checks: ${found.status}`,
        evidence: [],
      };
    }
    const naming = input.probes.filter((probe) => probe.obligation === obligation.id);
    if (/^code-(example|relation)-\d+$/.test(obligation.id)) {
      const cases = naming.flatMap((probe) => probe.cases);
      const status = codeStatus(obligation, cases);
      return {
        ...obligation,
        status,
        by:
          naming.length === 0
            ? "not run: the review did not examine this run, or found no way to load the project"
            : status === "exercised"
              ? `the relation held at ${cases.length} input(s) the review ran, on the delivered candidate; the statement as a whole is not established`
              : `the task's own code, run by the review on the delivered candidate`,
        evidence: naming.flatMap(evidenceOf),
      };
    }
    const status = probeStatus(naming.flatMap((probe) => probe.cases));
    return {
      ...obligation,
      status,
      by:
        naming.length === 0
          ? "no check here states it; it is the task's word, not a measurement"
          : status === "exercised"
            ? `examples only: ${naming.flatMap((probe) => probe.cases).length} case(s) of review probe(s) ${naming.map((probe) => probe.probe).join(", ")} kept the base's answer; the statement as a whole is not established`
            : `review probe(s) ${naming.map((probe) => probe.probe).join(", ")}`,
      evidence: naming.flatMap(evidenceOf),
    };
  });
  for (const probe of input.probes.filter((one) => one.origin !== "task"))
    settled.push({
      id: `review-${probe.probe}`,
      source: "review",
      category: "proposed",
      authority: "proposed",
      statement: probe.statement,
      basis: "a reviewer's probe: the inputs are the model's choice, the answers the harness's",
      status: probeStatus(probe.cases),
      by: probe.cases.length === 0 ? "it established nothing" : "its case readings",
      evidence: evidenceOf(probe),
    });
  return settled;
}

/**
 * The report's lines, which never read an empty or unmeasured set as preserved, and keep new
 * behaviour apart from kept behaviour.
 */
export function describePreservation(statuses: readonly ObligationStatus[]): string {
  const count = (state: ObligationState, kept = true) =>
    statuses.filter((one) => one.status === state && (one.category === "requested") !== kept)
      .length;
  const requested = statuses.filter((one) => one.category === "requested");
  const keep = statuses.filter((one) => one.category !== "requested");
  const measured = count("held") + count("exercised") + count("regressed");
  const preserved =
    measured === 0
      ? `preservation: nothing measured (${keep.length} obligation(s), every one unmeasured)`
      : `preservation: ${count("held")} held, ${count("exercised")} exercised by examples only, ${count("regressed")} regressed, ${count("unmeasured")} unmeasured, of ${keep.length} obligation(s) from the task, the supplied contract, the base suite and review probes`;
  const exercised = count("exercised", false);
  return requested.length === 0
    ? preserved
    : `${preserved}; requested behaviour (new, not preserved): ${count("met", false)} met, ${exercised === 0 ? "" : `${exercised} exercised by examples only, `}${count("unmet", false)} unmet, ${count("unmeasured", false)} unjudged`;
}
