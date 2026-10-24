import { z } from "zod";
import type { Clock } from "./core/clock.ts";
import type { AgentLoopDependencies, AgentLoopOutcome } from "./core/loop.ts";
import {
  combineUsage,
  type GateStatus,
  type LoopEvent,
  type LoopUsage,
} from "./core/loop-events.ts";
import {
  asJsonValue,
  digestOfBytes,
  digestOfJson,
  type JsonValue,
} from "./evidence/canonical-json.ts";
import { scrubJson } from "./evidence/scrub.ts";
import type { EvidenceRecorder } from "./evidence/session.ts";
import type { GroundedLoader } from "./gates/project-loader.ts";
import type { TaskCodeStatement, TaskExample, TaskRelation } from "./task-code-statements.ts";
import { sentencesQuoted } from "./workers/planned-check-program.ts";

/**
 * A separate review of the actual candidate, with executable probes (candidate-review-v3).
 * Experimental and off by default (`--review`).
 *
 * Once the candidate has run (its tests executed the change and nothing but a static check
 * fails), a fresh conversation that did not write the change is given the task, the candidate's
 * diff, the run's obligations and the checks' results, and may read the workspace and try a probe
 * on a copy of the candidate before answering. It answers with probes: a program that calls the
 * project, and inputs. The harness runs every probe twice on a fresh checkout of the base and
 * twice on one of the candidate, through the planned-check runner, and qualifies each case:
 *
 * - a **preservation** case takes its expected answer from the base, as observed; the reviewer
 *   chooses only the input. A difference is a regression only where the probe names behaviour the
 *   task requires kept (an authoritative obligation, by id or by quoting its words) and the base
 *   answered: a base that raised is not behaviour to keep (it is often the requested feature's
 *   absence), and a difference no task sentence protects is reported as a difference.
 * - a **requirement** case carries the reviewer's expected answer, which stays the reviewer's
 *   reading of the task: reported, never established, never handed to repair.
 *
 * A case the harness could not read the same way twice, whose program raised in its own code,
 * that did not load or did not finish, establishes nothing: it is a broken or unavailable probe.
 * An established finding earns one repair attempt from the run's attempt cap, under the ratchet,
 * with its input, expectation, observation, program, authority and the candidate's digest; its
 * authoritative kept cases are held as parts, so a repair that breaks one the incumbent satisfied
 * is rolled back. Findings never decide acceptance and never change a sealed gate.
 *
 * `prose` is the control: the same conversation and the same attempt, with objections in words
 * and nothing run, so a difference can be told apart from the extra computation.
 */
export const reviewRule = "candidate-review-v3";

export type ReviewMode = "executable" | "prose";

const probeId = z.string().regex(/^[a-z][a-z0-9-]{0,40}$/);
const probeCaseSchema = z.object({
  input: z.unknown(),
  expected: z.unknown().optional(),
  throws: z.literal(true).optional(),
});
const probeSchema = z.object({
  id: probeId,
  basis: z.enum(["preserve", "requirement", "relation"]),
  /** The task's own words the probe rests on: required for a requirement, optional otherwise. */
  quote: z.string().min(1).max(600).optional(),
  /** For a preservation probe: the existing behaviour it says stays the same. */
  keeps: z.string().min(1).max(400).optional(),
  /** The id of the run's obligation the probe exercises (`task-keep-2`), where it names one. */
  obligation: z.string().min(1).max(80).optional(),
  program: z.string().min(1).max(16_000),
  /**
   * For a relation: the program whose answer, on the unchanged base, is each case's expectation.
   * It runs outside the candidate's reach, and may call only functions the quoted words name.
   */
  reference: z.string().min(1).max(16_000).optional(),
  cases: z.array(probeCaseSchema).min(1).max(6),
});
export type ReviewProbe = z.infer<typeof probeSchema> & {
  /** `task` for a probe the harness built from the task's own code (task-code-v1). */
  readonly origin?: "task";
  /** For a probe of the task's code: the statement each case comes from, in case order. */
  readonly statements?: readonly { readonly id: string; readonly sentence: string }[];
  /** Why every reading of this probe stays provisional, where one does. */
  readonly provisional?: string;
};

const objectionSchema = z.object({
  quote: z.string().min(1).max(600).optional(),
  scenario: z.string().min(1).max(600),
  expected: z.string().min(1).max(600),
  why: z.string().min(1).max(600).optional(),
});
export type ReviewObjection = z.infer<typeof objectionSchema>;

export const maxProbes = 4;
export const maxObjections = 4;

/** A probe as admitted to run, or why it was not. */
export interface ProbeAdmission {
  readonly probes: readonly ReviewProbe[];
  readonly dropped: readonly { readonly id: string; readonly reason: string }[];
}

/**
 * The reviewer's probes as the harness admits them to run. A requirement probe needs a quote the
 * task contains and an expected answer (or a declared throw) for each case; a preservation probe's
 * expectations are ignored, since the base supplies them. Ids repeat at most once.
 */
export function admitProbes(task: string, answer: unknown): ProbeAdmission {
  const listed = Array.isArray((answer as { probes?: unknown } | null)?.probes)
    ? ((answer as { probes: unknown[] }).probes as unknown[])
    : [];
  const probes: ReviewProbe[] = [];
  const dropped: { id: string; reason: string }[] = [];
  const seen = new Set<string>();
  for (const [index, raw] of listed.entries()) {
    // An id is a name for the record, so its spelling is normalized rather than refused: a live
    // reviewer's first probes were all dropped for camelCase ids.
    const given = (raw as { id?: unknown } | null)?.id;
    const id = probeSlug(typeof given === "string" ? given : "", index);
    const program = (raw as { program?: unknown } | null)?.program;
    if (typeof program === "string" && !/\bexport\b/.test(program)) {
      dropped.push({
        id,
        reason:
          "the program must be the source text of an ES module with a default export, not a path or a description",
      });
      continue;
    }
    // An optional field sent as null is a field not given: two live probes were dropped for
    // `"keeps": null` and `"obligation": null`.
    const supplied =
      raw !== null && typeof raw === "object"
        ? Object.fromEntries(
            Object.entries(raw).filter(
              // An empty string is a field not given too: a live probe was dropped for `"keeps": ""`.
              ([key, value]) => !((value === null || value === "") && optionalProbeFields.has(key)),
            ),
          )
        : raw;
    const parsed = probeSchema.safeParse(
      supplied !== null && typeof supplied === "object" ? { ...supplied, id } : supplied,
    );
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      dropped.push({
        id,
        reason: `not a probe: ${issue?.path.join(".") || "probe"}: ${issue?.message ?? "invalid"}`,
      });
      continue;
    }
    // The `code-` ids are the harness's own probes of the task's code.
    const named = parsed.data.id.startsWith("code-")
      ? { ...parsed.data, id: `review-${parsed.data.id}`.slice(0, 41).replace(/-+$/, "") }
      : parsed.data;
    const probe = recordable(named, index);
    if (probe === null) {
      dropped.push({
        id,
        reason:
          "its program or inputs carry text the evidence scrubber redacts as a credential, so the record of what ran could not be held to what ran",
      });
      continue;
    }
    if (seen.has(probe.id)) {
      dropped.push({ id, reason: "the id was already used" });
      continue;
    }
    if (probes.length >= maxProbes) {
      dropped.push({ id, reason: `at most ${maxProbes} probes run` });
      continue;
    }
    // A quote is the task's words or it is not carried: a preservation probe's quote is what ties
    // it to the task's own sentences about keeping behaviour, so it is held to the same check.
    if (probe.basis === "preserve" && probe.quote !== undefined && !quotesTask(task, probe.quote)) {
      dropped.push({
        id,
        reason: "its quote is not the task's own words, so it is kept without one",
      });
      const { quote: _quote, ...unquoted } = probe;
      seen.add(probe.id);
      if (probes.length < maxProbes) probes.push(unquoted);
      continue;
    }
    if (probe.basis === "relation") {
      if (probe.quote === undefined || !quotesTask(task, probe.quote)) {
        dropped.push({ id, reason: "a relation probe must quote the task's own words" });
        continue;
      }
      const reach = relationReach(probe, probe.quote);
      if (reach !== null) {
        dropped.push({ id, reason: reach });
        continue;
      }
    }
    if (probe.basis === "requirement") {
      if (probe.quote === undefined || !quotesTask(task, probe.quote)) {
        dropped.push({ id, reason: "a requirement probe must quote the task's own words" });
        continue;
      }
      if (probe.cases.some((one) => one.expected === undefined && one.throws !== true)) {
        dropped.push({ id, reason: "a requirement case needs an expected answer or throws: true" });
        continue;
      }
    }
    seen.add(probe.id);
    probes.push(probe);
  }
  return { probes, dropped };
}

/**
 * Whether a quote is the task's own words: at least twelve characters, matched against the task's
 * sentences. A single short fragment matches some sentence of almost any task.
 */
function quotesTask(task: string, quote: string): boolean {
  return quote.trim().length >= 12 && sentencesQuoted(task, [quote]).length > 0;
}

const optionalProbeFields: ReadonlySet<string> = new Set([
  "quote",
  "keeps",
  "obligation",
  "reference",
]);

/**
 * Why a relation probe's reference may not stand as an expectation, or null where it may. The
 * reference is an existing function the task's quoted words name, called as `project.<name>`:
 * its answer on the unchanged base is then the task's, not the reviewer's. A reference that calls
 * nothing of the project, or something the quote does not name, is the reviewer's own expectation
 * written as code.
 */
function relationReach(probe: ReviewProbe, quote: string): string | null {
  if (probe.reference === undefined)
    return "a relation probe needs a reference program, run on the unchanged base";
  const called = [...probe.reference.matchAll(/\bproject\.([A-Za-z_$][\w$]*)/g)].map(
    (found) => found[1] as string,
  );
  if (called.length === 0)
    return "a relation's reference must call the project's existing functions as project.<name>";
  const unnamed = called.filter(
    (name) => !new RegExp(`\\b${name.replace(/\$/g, "\\$")}\\b`).test(quote),
  );
  return unnamed.length === 0
    ? null
    : `the reference calls ${[...new Set(unnamed)].join(", ")}, which the quoted words do not name`;
}

/**
 * The probe as it can be recorded byte for byte, or null. A probe's contract is recorded on the
 * chain and held to its digest; where the shared credential scrubber would redact any of its text,
 * the record and what ran differ and the bundle cannot verify. A reviewer's id
 * `preserves-task-keep-1-...` matched the `sk-...` key pattern on October 24. An id is the
 * harness's to rename; a program or input that would be redacted is not run.
 */
function recordable(probe: ReviewProbe, index: number): ReviewProbe | null {
  // What the probe contract records of a probe (cli-review.ts's probeContract): its id, in the
  // check ids and command, and its program and inputs as the JSON text of the checks' stdin. Read
  // as the recorder reads a payload, so a program the recorder leaves whole is not refused.
  // Every string the record holds of it: the check ids its runs get (cli-review.ts's checkId, a
  // relation's reference under `-ref`), and its program, reference and inputs. An id short enough
  // to pass alone can be redacted once `-ref-run-2` is appended to it.
  const redacted = (one: ReviewProbe) => {
    const inputs = one.cases.map((c) => c.input);
    const ids = [one.id, ...(one.reference === undefined ? [] : [`${one.id}-ref`.slice(0, 41)])];
    return (
      scrubJson({
        ids: ids.flatMap((id) => [id, `${id}-run-1`.slice(0, 64), `${id}-run-2`.slice(0, 64)]),
        commands: ids.map((id) => `review probe ${id}`),
        stdin: [one.program, ...(one.reference === undefined ? [] : [one.reference])].map(
          (program) => JSON.stringify({ program, inputs }),
        ),
      } as JsonValue).redactions.length > 0
    );
  };
  if (!redacted(probe)) return probe;
  const renamed = { ...probe, id: `probe-${index + 1}` };
  return redacted(renamed) ? null : renamed;
}

/** A probe id as a slug: lower case, dashes for anything else, starting with a letter. */
function probeSlug(given: string, index: number): string {
  const slug = given
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[^a-z]+/, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return slug.length === 0 ? `probe-${index + 1}` : slug;
}

/** The reviewer's objections, at most four, each with the scenario and what it expects. */
export function admitObjections(answer: unknown): readonly ReviewObjection[] {
  const listed = Array.isArray((answer as { objections?: unknown } | null)?.objections)
    ? ((answer as { objections: unknown[] }).objections as unknown[])
    : [];
  return listed
    .map((one) => objectionSchema.safeParse(one))
    .flatMap((parsed) => (parsed.success ? [parsed.data] : []))
    .slice(0, maxObjections);
}

/** One case's answer on one run, as the planned-check runner writes it. */
export type CaseAnswer =
  | { readonly kind: "result"; readonly text: string }
  | { readonly kind: "threw"; readonly inProgram: boolean };

/** One run of every case of a probe on one tree, or why it gave no answers. */
export type ProbeRun =
  | { readonly kind: "answered"; readonly answers: readonly CaseAnswer[] }
  | { readonly kind: "did-not-load" | "did-not-complete"; readonly detail: string };

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical((value as Record<string, unknown>)[key])]),
    );
  return value;
}

const textOf = (value: unknown) => JSON.stringify(canonical(value)) ?? "null";

/**
 * A runner's stdout as one answer per case, in case order, or null where it does not hold exactly
 * one parseable line per case (a program that printed to stdout itself, or stopped part way).
 */
export function readAnswers(stdout: string, cases: number): readonly CaseAnswer[] | null {
  const lines = stdout.split("\n").filter((line) => line.length > 0);
  if (lines.length !== cases) return null;
  const answers: CaseAnswer[] = [];
  for (const line of lines) {
    let read: { result?: unknown; threw?: unknown; thrownIn?: unknown };
    try {
      read = JSON.parse(line) as typeof read;
    } catch {
      return null;
    }
    if (read.threw === true)
      answers.push({ kind: "threw", inProgram: read.thrownIn === "check-program" });
    else if ("result" in read) answers.push({ kind: "result", text: textOf(read.result) });
    else return null;
  }
  return answers;
}

const answerText = (answer: CaseAnswer) =>
  answer.kind === "threw" ? '{"threw":true}' : answer.text;

/** What a case established, read from its runs on the two trees. */
export type CaseReading =
  | "kept"
  | "met"
  | "preservation-regression"
  /** The candidate answers otherwise than the base, and no obligation the task states covers it. */
  | "difference"
  /** The base raised where the candidate answers: the base lacked it, which is no behaviour to keep. */
  | "base-raised"
  /** The reviewer's expected answer, which neither tree gives: the reviewer's reading, unconfirmed. */
  | "missed-requirement"
  | "unstable"
  | "defective-program"
  | "did-not-load"
  | "did-not-complete"
  /** A task example's call does not give the task's literal on the candidate. */
  | "requested-unmet"
  /** The candidate's subject gives what the reference gives on the unchanged base. */
  | "related"
  /** It does not, under a relation whose reading is supported. */
  | "relation-violated"
  /** It does not, under a relation whose translation nothing confirms: the reviewer's reading. */
  | "relation-unconfirmed"
  /** The base does not give the answer the task says it keeps, so the reading may be wrong. */
  | "provisional";

/**
 * The readings that reach repair, each an expectation that is not the reviewer's:
 * - behaviour the base showed, that an obligation the task states covers, and that the
 *   candidate lost;
 * - a task example the candidate does not meet: the call and its answer are the task's text;
 * - a relation the candidate breaks where the expectation is an existing function's answer on
 *   the unchanged base, read through the task's own code or through a reviewer's translation
 *   that held on at least one input.
 * A requirement case's expectation is the reviewer's, and a difference no task sentence protects
 * may be what the task asked for; neither reaches repair.
 */
export const establishedReadings: ReadonlySet<CaseReading> = new Set([
  "preservation-regression",
  "requested-unmet",
  "relation-violated",
]);

/** An obligation the task states, which a probe may name as its authority. */
export interface ReviewAuthority {
  readonly id: string;
  readonly statement: string;
}

/**
 * The authoritative obligation a probe exercises: the one it names by id, or the one whose words
 * its quote is. Null where it names none, which leaves every case it reads a proposal.
 */
export function authorityOf(
  probe: ReviewProbe,
  authorities: readonly ReviewAuthority[],
): ReviewAuthority | null {
  const named = authorities.find((one) => one.id === probe.obligation);
  if (named !== undefined) return named;
  if (probe.quote === undefined) return null;
  return authorities.find((one) => quotesTask(one.statement, probe.quote as string)) ?? null;
}

export interface CaseClassification {
  readonly probe: string;
  readonly index: number;
  readonly reading: CaseReading;
  /** The obligation that makes a kept case authoritative; null where none does. */
  readonly authority: string | null;
  /**
   * Which part holds this case: a kept case is behaviour the base showed; a requested one is
   * behaviour the task states, with an expectation that is the task's literal or the base's answer
   * to the function the task names. Null where the case holds nothing.
   */
  readonly role: "kept" | "requested" | null;
  readonly input: unknown;
  readonly base: string | null;
  readonly candidate: string | null;
  readonly expected: string | null;
  readonly detail: string;
}

/**
 * Each case of a probe from two runs on the base and two on the candidate. A preservation case is
 * kept where the candidate answers as the base does; where it answers otherwise it is a
 * regression only under an authoritative obligation, and only where the base answered rather than
 * raised. A requirement case is met where the candidate gives the expected answer, and otherwise
 * stays the reviewer's unconfirmed reading. Base runs may be absent for a candidate-only reading,
 * which keeps the roles the examination fixed.
 */
export function classifyProbe(
  probe: ReviewProbe,
  base: readonly [ProbeRun, ProbeRun],
  candidate: readonly [ProbeRun, ProbeRun],
  authority: ReviewAuthority | null = null,
  /**
   * False where a static check failed in a new way on the candidate (a build among them): a probe
   * that cannot load there may be reading a build that did not happen, so its silence is not
   * the change taking behaviour away.
   */
  candidateRunnable = true,
): readonly CaseClassification[] {
  const unusable = (runs: readonly [ProbeRun, ProbeRun], tree: string) => {
    for (const run of runs)
      if (run.kind !== "answered")
        return { reading: run.kind, detail: `on the ${tree}: ${run.detail}` } as const;
    return null;
  };
  const authorized = authority?.id ?? null;
  return probe.cases.map((one, index) => {
    const expected =
      probe.basis === "requirement"
        ? one.throws === true
          ? '{"threw":true}'
          : textOf(one.expected)
        : null;
    const blank = {
      probe: probe.id,
      index: index + 1,
      input: one.input,
      expected,
      authority: null,
    };
    // The probe answered on the base both times and the candidate gives it no answer at all: the
    // change took away something the base had (an export, a module). A regression where an
    // obligation the task states covers it, and otherwise a difference: a refactor may move what
    // the probe imports, as the task asked.
    const baseAnswered = base.every((run) => run.kind === "answered");
    const candidateFailed = candidate.every((run) => run.kind !== "answered");
    if (baseAnswered && candidateFailed) {
      const baseAnswer = (base[0] as { answers: readonly CaseAnswer[] }).answers[index];
      const lost = candidate[0] as Exclude<ProbeRun, { kind: "answered" }>;
      const raised = baseAnswer?.kind === "threw";
      const unavailable = raised || lost.kind === "did-not-complete" || !candidateRunnable;
      return {
        ...blank,
        reading: unavailable
          ? lost.kind
          : authorized === null
            ? "difference"
            : "preservation-regression",
        role: unavailable ? null : "kept",
        authority: authorized,
        base: baseAnswer === undefined ? null : answerText(baseAnswer),
        candidate: null,
        detail: `the base answered and the candidate gave no answer (${lost.kind}: ${lost.detail.slice(0, 300)})`,
      };
    }
    const failed = unusable(base, "base") ?? unusable(candidate, "candidate");
    if (failed !== null)
      return {
        ...blank,
        reading: failed.reading,
        role: null,
        base: null,
        candidate: null,
        detail: failed.detail,
      };
    const answers = (runs: readonly [ProbeRun, ProbeRun]) =>
      runs.map((run) => (run as { answers: readonly CaseAnswer[] }).answers[index] as CaseAnswer);
    const onBase = answers(base);
    const onCandidate = answers(candidate);
    const all = [...onBase, ...onCandidate];
    const baseText = answerText(onBase[0] as CaseAnswer);
    const candidateText = answerText(onCandidate[0] as CaseAnswer);
    const seen = { base: baseText, candidate: candidateText };
    if (all.some((answer) => answer.kind === "threw" && answer.inProgram))
      return {
        ...blank,
        ...seen,
        reading: "defective-program",
        role: null,
        detail: "the probe's own program threw, so it recorded no answer of the project's",
      };
    if (
      baseText !== answerText(onBase[1] as CaseAnswer) ||
      candidateText !== answerText(onCandidate[1] as CaseAnswer)
    )
      return {
        ...blank,
        ...seen,
        reading: "unstable",
        role: null,
        detail:
          "two runs on the same tree answered differently, so a difference between the trees is not a difference the change made",
      };
    const baseRaised = onBase[0]?.kind === "threw";
    if (baseText === candidateText && probe.basis === "preserve")
      return {
        ...blank,
        ...seen,
        reading: "kept",
        role: authorized === null ? null : "kept",
        authority: authorized,
        detail: "the candidate answers as the base does",
      };
    if (
      probe.basis === "preserve" ||
      (expected !== null && baseText === expected && candidateText !== expected)
    )
      return baseRaised
        ? {
            ...blank,
            ...seen,
            reading: "base-raised",
            role: null,
            detail:
              "the base raised where the candidate answers: what the base lacked is not behaviour to keep, and is often what the task asked for",
          }
        : authorized === null
          ? {
              ...blank,
              ...seen,
              reading: "difference",
              role: null,
              detail:
                "the candidate answers otherwise than the base, and the probe names no obligation the task states that covers this input; the task may have asked for the change",
            }
          : {
              ...blank,
              ...seen,
              reading: "preservation-regression",
              role: "kept",
              authority: authorized,
              detail: `the base's answer, observed, is the expectation under ${authorized}, and the candidate answers otherwise`,
            };
    if (candidateText === expected)
      return {
        ...blank,
        ...seen,
        reading: "met",
        role: null,
        detail: "the candidate gives the expected answer",
      };
    return {
      ...blank,
      ...seen,
      reading: "missed-requirement",
      role: null,
      detail:
        "the candidate does not give the answer the reviewer read in the task; that expectation is the reviewer's, and nothing here confirms it",
    };
  });
}

/** Each of a probe's case answers on two runs of one tree, or why there is none. */
function caseRuns(
  runs: readonly [ProbeRun, ProbeRun],
  index: number,
):
  | { readonly answers: readonly [CaseAnswer, CaseAnswer] }
  | { readonly failed: CaseReading; readonly detail: string } {
  for (const run of runs)
    if (run.kind !== "answered") return { failed: run.kind, detail: run.detail };
  const [first, second] = runs.map(
    (run) => (run as { answers: readonly CaseAnswer[] }).answers[index] as CaseAnswer,
  ) as [CaseAnswer, CaseAnswer];
  if (first === undefined || second === undefined)
    return { failed: "did-not-complete", detail: "the runner gave no answer for this case" };
  if ([first, second].some((answer) => answer.kind === "threw" && answer.inProgram))
    return {
      failed: "defective-program",
      detail: "the probe's own program threw, so it recorded no answer of the project's",
    };
  if (answerText(first) !== answerText(second))
    return {
      failed: "unstable",
      detail: "two runs on the same tree answered differently, so neither answer stands",
    };
  return { answers: [first, second] };
}

/**
 * A probe the harness built from the task's own examples (task-code-v1): each case is one
 * example, its expectation the task's literal. A requested example is met where the candidate
 * gives the literal and unmet where it gives anything else, a raised error and a missing export
 * included. A kept example must give the literal on the base first: where the base does not, the
 * reading of the sentence may be wrong and the case stays provisional.
 */
export function classifyTaskExamples(
  probe: ReviewProbe,
  base: readonly [ProbeRun, ProbeRun],
  candidate: readonly [ProbeRun, ProbeRun],
  candidateRunnable = true,
): readonly CaseClassification[] {
  return probe.cases.map((one, index) => {
    const statement = probe.statements?.[index];
    const expected = textOf(one.expected);
    const blank = {
      probe: probe.id,
      index: index + 1,
      input: one.input,
      expected,
      authority: statement?.id ?? null,
    };
    const onBase = caseRuns(base, index);
    const onCandidate = caseRuns(candidate, index);
    const baseText = "answers" in onBase ? answerText(onBase.answers[0]) : null;
    const candidateText = "answers" in onCandidate ? answerText(onCandidate.answers[0]) : null;
    const seen = { base: baseText, candidate: candidateText };
    if (probe.basis === "preserve") {
      if (!("answers" in onBase))
        return {
          ...blank,
          ...seen,
          reading: onBase.failed,
          role: null,
          detail: `on the base: ${onBase.detail}`,
        };
      if (baseText !== expected)
        return {
          ...blank,
          ...seen,
          reading: "provisional",
          role: null,
          detail:
            "the base does not give the answer the task says it keeps, so this reading of the sentence may be wrong",
        };
      if (!("answers" in onCandidate))
        return {
          ...blank,
          ...seen,
          reading:
            candidateRunnable &&
            onCandidate.failed !== "did-not-complete" &&
            onCandidate.failed !== "unstable" &&
            onCandidate.failed !== "defective-program"
              ? "preservation-regression"
              : onCandidate.failed,
          role: candidateRunnable ? "kept" : null,
          detail: `the base gives the task's answer and the candidate gave none (${onCandidate.detail.slice(0, 300)})`,
        };
      return candidateText === expected
        ? {
            ...blank,
            ...seen,
            reading: "kept",
            role: "kept",
            detail: "the candidate gives the answer the task says it keeps",
          }
        : {
            ...blank,
            ...seen,
            reading: "preservation-regression",
            role: "kept",
            detail:
              "the base gives the answer the task says it keeps, and the candidate answers otherwise",
          };
    }
    if (!("answers" in onCandidate))
      return {
        ...blank,
        ...seen,
        reading: onCandidate.failed,
        role: null,
        detail: `on the candidate: ${onCandidate.detail}`,
      };
    // The loaded entries expose no such function: the example may name one the project keeps in a
    // module no probe loaded, so it is not judged against the candidate.
    if (candidateText?.startsWith(missingFunction) === true)
      return {
        ...blank,
        ...seen,
        reading: "provisional",
        role: null,
        detail: `the loaded entries expose no such function (${candidateText}), so this is not judged`,
      };
    return candidateText === expected
      ? {
          ...blank,
          ...seen,
          reading: "met",
          role: "requested",
          detail: "the candidate gives the task's answer",
        }
      : {
          ...blank,
          ...seen,
          reading: "requested-unmet",
          role: "requested",
          detail: "the task states this call's answer, and the candidate gives another",
        };
  });
}

/**
 * A relation's cases: the candidate's subject against the reference's answer on the unchanged
 * base. A case that differs is established only where the reading is supported: a relation the
 * task writes as code, over a domain the reader followed, or a reviewer's relation that held on at
 * least one input, which shows its two programs answer in the same terms. Otherwise a difference
 * is the reviewer's unconfirmed reading.
 */
export function classifyRelation(
  probe: ReviewProbe,
  referenceOnBase: readonly [ProbeRun, ProbeRun],
  subjectOnCandidate: readonly [ProbeRun, ProbeRun],
): readonly CaseClassification[] {
  const read = probe.cases.map((one, index) => {
    const reference = caseRuns(referenceOnBase, index);
    const subject = caseRuns(subjectOnCandidate, index);
    return { one, index, reference, subject };
  });
  const agreed = read.some(
    ({ reference, subject }) =>
      "answers" in reference &&
      "answers" in subject &&
      answerText(reference.answers[0]) === answerText(subject.answers[0]),
  );
  const supported = probe.provisional === undefined && (probe.origin === "task" || agreed);
  const authority = probe.statements?.[0]?.id ?? probe.id;
  return read.map(({ one, index, reference, subject }) => {
    const base = "answers" in reference ? answerText(reference.answers[0]) : null;
    const candidate = "answers" in subject ? answerText(subject.answers[0]) : null;
    const blank = {
      probe: probe.id,
      index: index + 1,
      input: one.input,
      base,
      candidate,
      expected: base,
      authority: supported ? authority : null,
    };
    if (!("answers" in reference))
      return {
        ...blank,
        reading: reference.failed,
        role: null,
        detail: `the reference on the base: ${reference.detail}`,
      };
    if (!("answers" in subject))
      return {
        ...blank,
        reading: subject.failed,
        role: null,
        detail: `the subject on the candidate: ${subject.detail}`,
      };
    if (
      candidate?.startsWith(missingFunction) === true ||
      base?.startsWith(missingFunction) === true
    )
      return {
        ...blank,
        reading: "relation-unconfirmed" as const,
        role: null,
        detail: "the loaded entries expose no such function on one tree, so this is not judged",
      };
    if (base === candidate)
      return {
        ...blank,
        reading: "related" as const,
        role: supported ? ("requested" as const) : null,
        detail: "the candidate's subject gives what the reference gives on the unchanged base",
      };
    return supported
      ? {
          ...blank,
          reading: "relation-violated" as const,
          role: "requested" as const,
          detail:
            "the task relates these two calls, and for this input the candidate's subject gives other than the reference gives on the unchanged base",
        }
      : {
          ...blank,
          reading: "relation-unconfirmed" as const,
          role: null,
          detail:
            probe.provisional ??
            "the reviewer's relation held on no input, so its two programs may not answer in the same terms; the difference is the reviewer's reading",
        };
  });
}

/**
 * The cases' readings as ratchet parts, one per probe: `<probe>: kept` holds behaviour the base
 * showed under an obligation the task states. Only such cases are held, so a repair is never
 * rolled back for changing behaviour no task sentence protects (which the task may have asked
 * for), and a reviewer's expected answer is never held at all. Every kept case must hold for its
 * part to pass. No part is a claim.
 */
export function reviewParts(classified: readonly CaseClassification[]): {
  readonly parts: Readonly<Record<string, GateStatus>>;
  readonly claims: readonly string[];
} {
  const parts: Record<string, GateStatus> = {};
  for (const one of classified) {
    if (one.role === null || one.authority === null) continue;
    const name = `${one.probe}: ${one.role}`;
    const holds = one.reading === "kept" || one.reading === "met" || one.reading === "related";
    parts[name] = parts[name] === "failed" || !holds ? "failed" : "passed";
  }
  return { parts, claims: [] };
}

/**
 * A later candidate's answers read under the roles the examination fixed. Where a held case now
 * gives no answer at all, the part fails: the probe loaded on the incumbent, and a repair that
 * makes the project fail to load has broken what the probe reads.
 */
export function remeasure(
  probes: readonly ReviewProbe[],
  examined: readonly CaseClassification[],
  candidate: ReadonlyMap<string, readonly [ProbeRun, ProbeRun]>,
): readonly CaseClassification[] {
  return examined.map((one) => {
    if (one.role === null) return one;
    const probe = probes.find((candidateProbe) => candidateProbe.id === one.probe);
    const runs = candidate.get(one.probe);
    const answers =
      runs === undefined
        ? null
        : runs.map((run) => (run.kind === "answered" ? run.answers[one.index - 1] : undefined));
    // A requested case is held to its expectation: the task's literal, or the reference's answer
    // on the base, recorded when it was examined. A kept case is held to the base's answer.
    const target = one.role === "requested" ? one.expected : one.base;
    const met = one.role === "kept" ? "kept" : probe?.basis === "relation" ? "related" : "met";
    const missed =
      one.role === "kept"
        ? "preservation-regression"
        : probe?.basis === "relation"
          ? "relation-violated"
          : "requested-unmet";
    if (probe === undefined || answers === null || answers.some((answer) => answer === undefined))
      return {
        ...one,
        candidate: null,
        reading: missed,
        detail: "the probe gave no answer on this candidate",
      };
    const first = answerText(answers[0] as CaseAnswer);
    const holds = first === target && first === answerText(answers[1] as CaseAnswer);
    return {
      ...one,
      candidate: first,
      reading: holds ? met : missed,
    };
  });
}

/**
 * Whether a call written in the task compiles as an expression. Compiled, never run: a call that
 * would not compile would make the whole probe fail to load, and is left out instead.
 */
function compiles(call: string): boolean {
  try {
    new Function(`return (${call});`);
    return true;
  } catch {
    return false;
  }
}

/** How a guarded call answers where the project exposes no function of the name. */
const missingFunction = '{"not a function of the project":';

/**
 * The guard and call of one written example: where a name it calls is not a function of the
 * project, the answer says which, as an observation, so a missing export is the candidate's
 * answer rather than a probe that cannot run.
 */
function guardedCall(names: readonly string[], call: string): string {
  const missing = names
    .map(
      (name) =>
        `if (typeof ${name} !== "function") return { "not a function of the project": ${JSON.stringify(name)} };`,
    )
    .join(" ");
  return `{ ${missing} return (${call}); }`;
}

/** The names a written call takes from the project: not JavaScript's own (`encodeURIComponent`). */
const projectNames = (names: readonly string[]) =>
  names.filter((name) => typeof (globalThis as Record<string, unknown>)[name] !== "function");

const destructured = (loader: GroundedLoader, names: readonly string[]) =>
  `${loader.preamble}\nconst { ${[...new Set(names)].join(", ")} } = project;`;

/** At most this many examples in each of the two probes the task's examples become. */
const maxTaskExamples = 6;

/**
 * The probes the harness runs of the task's own code (task-code-v1), loaded through the grounded
 * loader: requested examples in one probe and kept examples in another, each case one example,
 * and each relation a probe of its own whose reference runs on the base. Base-role examples
 * describe what the task asks to change and are not run as expectations.
 */
export function taskProbes(
  statements: readonly TaskCodeStatement[],
  loader: GroundedLoader,
): readonly ReviewProbe[] {
  const examples = (role: "requested" | "preserve") =>
    statements
      .filter((one): one is TaskExample => one.kind === "example" && one.role === role)
      .filter((one) => compiles(one.call))
      .slice(0, maxTaskExamples);
  const bundle = (id: string, basis: "requirement" | "preserve", chosen: readonly TaskExample[]) =>
    chosen.length === 0
      ? []
      : [
          {
            id,
            basis,
            origin: "task" as const,
            quote: chosen[0]?.sentence,
            program: [
              destructured(loader, projectNames(chosen.flatMap((one) => one.names))),
              "const cases = [",
              ...chosen.map(
                (one) => `  async () => ${guardedCall(projectNames(one.names), one.call)},`,
              ),
              "];",
              "export default async (index) => cases[index]();",
            ].join("\n"),
            cases: chosen.map((one, index) => ({ input: index, expected: one.expected })),
            statements: chosen.map((one) => ({ id: one.id, sentence: one.sentence })),
          } satisfies ReviewProbe,
        ];
  const relations = statements
    .filter((one): one is TaskRelation => one.kind === "relation" && one.inputs.length > 0)
    .filter((one) => compiles(one.subject) && compiles(one.reference))
    .slice(0, 2)
    .map(
      (one): ReviewProbe => ({
        id: one.id,
        basis: "relation",
        origin: "task",
        quote: one.sentence,
        program: `${destructured(loader, [one.subjectName])}\nexport default async (${one.variable}) => ${guardedCall([one.subjectName], one.subject)};`,
        reference: `${destructured(loader, [one.referenceName])}\nexport default async (${one.variable}) => ${guardedCall([one.referenceName], one.reference)};`,
        // Every input the extraction gives (at most `maxRelationInputs`), as one run of one program.
        cases: one.inputs.map((input) => ({ input })),
        statements: one.inputs.map(() => ({ id: one.id, sentence: one.sentence })),
        ...(one.domain === "unfollowed"
          ? {
              provisional:
                "the task states a domain for this relation that the reader could not apply, so an input may lie outside it",
            }
          : {}),
      }),
    );
  return [
    ...bundle("code-requested", "requirement", examples("requested")),
    ...bundle("code-kept", "preserve", examples("preserve")),
    ...relations,
  ];
}

const shown = (text: string | null, limit = 400) =>
  text === null ? "(no answer)" : text.length > limit ? `${text.slice(0, limit)}...` : text;

/**
 * The repair brief for established findings: each case's authority (the obligation the task
 * states), input, expected answer (the base's, observed), and what each tree gave, the probe's
 * program so the worker can see what it calls, and the candidate it was read on. Bounded to the
 * first six cases.
 */
export function findingsBrief(input: {
  readonly task: string;
  readonly probes: readonly ReviewProbe[];
  readonly findings: readonly CaseClassification[];
  readonly authorities: readonly ReviewAuthority[];
  /** The digest of the candidate patch the findings were read on. */
  readonly candidate: string;
}): string {
  const lines = [
    "A separate review of your change ran these probes on fresh checkouts of the unchanged base and of your change. What each tree gave was observed by the harness. Each finding rests on the task's own words: behaviour the base had that the task requires kept, an example the task writes with its answer, or a relation the task states between your code and an existing function, whose answer on the unchanged base is the expectation.",
    `They were read on the candidate ${input.candidate}.`,
    "",
  ];
  for (const finding of input.findings.slice(0, 6)) {
    const probe = input.probes.find((one) => one.id === finding.probe) as ReviewProbe;
    const statement = probe.statements?.[finding.index - 1];
    const authority = input.authorities.find((one) => one.id === finding.authority);
    const words = statement?.sentence ?? authority?.statement ?? probe.quote ?? "";
    const expectation =
      finding.reading === "requested-unmet"
        ? "expected (the task's literal answer)"
        : finding.reading === "relation-violated"
          ? "expected (the reference's answer on the unchanged base)"
          : "expected (the base's answer, observed)";
    lines.push(
      `Probe ${probe.id}, case ${finding.index} (${finding.reading}), under ${finding.authority}: "${shown(words, 600)}".`,
      `  input: ${shown(JSON.stringify(finding.input) ?? "undefined")}`,
      `  ${expectation}: ${shown(finding.reading === "preservation-regression" ? finding.base : finding.expected)}`,
      `  your change gives: ${shown(finding.candidate)}`,
    );
  }
  const programs = [...new Set(input.findings.slice(0, 6).map((one) => one.probe))];
  for (const id of programs) {
    const probe = input.probes.find((one) => one.id === id) as ReviewProbe;
    lines.push(
      "",
      `Program of probe ${id} (run from the repository root, its default export called with each input):`,
      probe.program.slice(0, 1500),
      ...(probe.reference === undefined
        ? []
        : [
            `Reference of probe ${id} (run on the unchanged base, its answer the expectation):`,
            probe.reference.slice(0, 1000),
          ]),
    );
  }
  lines.push(
    "",
    "Change the code so these inputs give the expected answer, keeping what the task asked for. Where the task asks for this behaviour to change, leave the code as it is and say which sentence asks for it. Do not change tests to match a probe. The probes run again on your result: a change that breaks a case held here is rolled back, and the checks that decide acceptance are unchanged.",
  );
  return lines.join("\n");
}

/** The prose control's brief: the reviewer's objections, as claims nothing has run. */
export function objectionsBrief(input: {
  readonly objections: readonly ReviewObjection[];
  readonly keepStatements: readonly string[];
}): string {
  return [
    "A separate review of your change raised these objections. They are the reviewer's claims: nothing has run them, and the reviewer may be wrong.",
    "",
    ...input.objections.flatMap((one, index) => [
      `${index + 1}. ${one.scenario}`,
      `   expected: ${one.expected}${one.quote === undefined ? "" : ` (the task: "${one.quote}")`}`,
      ...(one.why === undefined ? [] : [`   why: ${one.why}`]),
    ]),
    ...(input.keepStatements.length === 0
      ? []
      : [
          "",
          "The task's own words on what to keep:",
          ...input.keepStatements.map((one) => `- ${one}`),
        ]),
    "",
    "Check each against the task and the code. Change the code where an objection holds; where it does not, leave the code as it is and say why. Do not change tests to match an objection.",
  ].join("\n");
}

export const reviewSystemPrompt = {
  executable: [
    "You review a change another coding agent made to a repository; you did not write it, and its account of the work is not given to you.",
    "You may read, list and search the workspace, which holds the change; you cannot edit it or run commands, but try_probe runs a probe program on a copy of the change so you can check that it loads and calls the project as you intend before you answer.",
    "Before answering, read the changed files and the code that calls what they change.",
    "Look for existing behaviour the change broke that the task requires kept (the obligations listed with an id), including in callers and neighbours of what it changed, and for behaviour the task asks for in words that the change does not implement.",
    "A probe program is plain JavaScript, an ES module run as a .mjs file: no TypeScript syntax (no type annotations, no `as`, no interfaces). Begin it with the loading lines the request gives, which the harness ran on the unchanged base, and call the project as project.<name>. Every probe you submit is run once on a copy of the change before it counts; one that does not load or throws in its own code comes back to you once with its error. Try each program with try_probe first.",
    "Answer with one JSON object and nothing else:",
    '{"probes": up to 4 {"id": a short slug, "basis": "preserve", "requirement" or "relation",',
    ' "obligation": for "preserve", the id of the listed obligation the probe exercises,',
    ' "quote": the task\'s own words the probe rests on (required for "requirement" and "relation"),',
    ' "reference": for "relation", a second program whose answer for each input is what the task says "program" must give, computed by existing functions the quoted words name (project.<name>); it runs on the unchanged base, so its answer is the existing function\'s, not yours,',
    ' "keeps": for "preserve", the existing behaviour that should stay the same,',
    ' "program": the source text of an ES module (not a path), run from the repository root, whose default export takes one input and returns a JSON-serialisable value; it may be async, and for asynchronous behaviour it returns what it observed (which calls ran, in what order, which promises settled and how), never a timing,',
    ' "cases": up to 6 {"input", "expected" (for "requirement": the answer the task\'s words imply), "throws": true where the task says it throws}}}.',
    'For "preserve" probes choose inputs whose behaviour the task does not change and an obligation the task states covers: the harness takes their expected answer from the unchanged base, not from you, and a difference counts only under such an obligation. A requirement probe\'s expected answer is your reading of the task; it is reported and never acted on.',
    'A "relation" probe states requested behaviour the task describes in terms of existing functions: for instance where the task says a callback is called once per key of an existing function\'s result, in order, "program" records the calls it receives and "reference" returns the existing function\'s entries. A difference counts only where the relation held on at least one of your inputs.',
    'The request lists examples and relations the task writes as code, which the harness runs itself; for a relation listed there you may add inputs with "relationInputs": {"<its id>": [up to 4 inputs]}.',
    'An example probe: {"id": "trims-names", "basis": "preserve", "keeps": "label(name) trims the spaces around the name", "program": "import { label } from \'./label.mjs\';\\nexport default (input) => label(input.name);", "cases": [{"input": {"name": "  ann  "}}, {"input": {"name": "bob"}}]}.',
    'If nothing is worth checking, answer {"probes": []}.',
  ].join(" "),
  prose: [
    "You review a change another coding agent made to a repository; you did not write it, and its account of the work is not given to you.",
    "You may read, list and search the workspace, which holds the change; you cannot edit or run commands.",
    "Look for behaviour the task asks for that the change does not implement, existing behaviour it may have broken (including in callers and neighbours of what it changed), and how the new behaviour interacts with what must stay.",
    "Answer with one JSON object and nothing else:",
    '{"objections": up to 4 {"scenario": a concrete input or situation, "expected": what should happen, "quote": the task\'s own words it rests on, where any, "why": why the change gets it wrong}}.',
    'If nothing is wrong, answer {"objections": []}.',
  ].join(" "),
} as const;

/** What the reviewer is shown: the task, the diff, what must be kept, and what the checks said. */
export function reviewRequest(input: {
  readonly task: string;
  readonly diff: string;
  readonly obligations: readonly string[];
  readonly checks: readonly string[];
  readonly toolSteps: number;
  /** How a probe loads the project, as the harness found it, or why it found none. */
  readonly loading?: string;
  /** The task's own examples and relations the harness runs itself. */
  readonly taskCode?: readonly string[];
}): string {
  const diff =
    input.diff.length > 12_000
      ? `${input.diff.slice(0, 12_000)}\n... (the diff continues; read the changed files for the rest)`
      : input.diff;
  return [
    "The task, as the user gave it:",
    input.task,
    "",
    "The change, against the base commit:",
    diff.length === 0 ? "(no change)" : diff,
    "",
    "What the run must preserve, by source:",
    ...(input.obligations.length === 0
      ? ["- nothing named"]
      : input.obligations.map((one) => `- ${one}`)),
    "",
    "What the run's checks reported on this change:",
    ...(input.checks.length === 0 ? ["- nothing"] : input.checks.map((one) => `- ${one}`)),
    ...(input.loading === undefined ? [] : ["", input.loading]),
    ...(input.taskCode === undefined || input.taskCode.length === 0
      ? []
      : [
          "",
          "Examples and relations the task writes as code, which the harness runs on both trees itself (do not repeat them):",
          ...input.taskCode.map((one) => `- ${one}`),
        ]),
    "",
    `You have ${input.toolSteps} tool calls, then answer.`,
  ].join("\n");
}

/** The reviewer's JSON answer from its last message, or null with why. */
export function parseReviewAnswer(answer: string): {
  readonly value: unknown;
  readonly error: string | null;
} {
  const start = answer.indexOf("{");
  const end = answer.lastIndexOf("}");
  if (start < 0 || end <= start) return { value: null, error: "no JSON object in the answer" };
  try {
    return { value: JSON.parse(answer.slice(start, end + 1)), error: null };
  } catch (cause) {
    return { value: null, error: `not JSON (${String(cause)})` };
  }
}

/** The examination's cost, charged to the run's own allowance by the caller. */
export interface ReviewCharge {
  readonly steps: number;
  readonly tokensUsed: number;
  readonly usage: LoopUsage;
  readonly callsWithUnknownUsage: number;
}

export interface ReviewConversation {
  readonly answer: string;
  readonly stopReason: string;
  readonly charge: ReviewCharge;
  /** The conversation so far, for a revision that continues it. */
  readonly messages: AgentLoopOutcome["messages"];
}

const answerNow = "Answer now with the one JSON object; no more tool calls.";

/**
 * The reviewer's conversation: a fresh context, read-only tools, every step but the last for
 * reading and the last for the answer. Its turns are not the worker's plan or claim.
 */
export async function converse(input: {
  readonly mode: ReviewMode;
  readonly request: (toolSteps: number) => string;
  readonly budget: {
    readonly maxSteps: number;
    readonly maxTokens: number;
    readonly maxWallTimeMs: number;
  };
  readonly runLoop: (
    prompt: string,
    dependencies: AgentLoopDependencies,
  ) => Promise<AgentLoopOutcome>;
  readonly loopDependencies: AgentLoopDependencies;
  readonly readOnly: Pick<AgentLoopDependencies, "toolInvoker" | "toolSchemas">;
  readonly clock: Clock;
  /** Where the conversation continues one already held. */
  readonly history?: AgentLoopOutcome["messages"];
}): Promise<ReviewConversation> {
  const started = input.clock.now();
  const toolSteps = Math.max(1, input.budget.maxSteps - 1);
  const dependencies: AgentLoopDependencies = {
    ...input.loopDependencies,
    ...input.readOnly,
    systemPrompt: reviewSystemPrompt[input.mode],
    emit: (event: LoopEvent) => {
      if (event.type !== "plan" && event.type !== "claim") input.loopDependencies.emit(event);
    },
  };
  const reading = await input.runLoop(input.request(toolSteps), {
    ...dependencies,
    ...(input.history === undefined ? {} : { history: input.history }),
    budget: { ...input.loopDependencies.budget, ...input.budget, maxSteps: toolSteps },
  });
  const left = {
    maxSteps: 1,
    maxTokens: Math.max(0, input.budget.maxTokens - reading.tokensUsed),
    maxWallTimeMs: Math.max(0, input.budget.maxWallTimeMs - (input.clock.now() - started)),
  };
  const answered =
    reading.stopReason === "max-steps" &&
    left.maxTokens >= input.loopDependencies.maxOutputTokens &&
    left.maxWallTimeMs > 0
      ? await input.runLoop(answerNow, {
          ...dependencies,
          toolSchemas: [],
          history: reading.messages,
          budget: { ...input.loopDependencies.budget, ...left },
        })
      : null;
  const loops = answered === null ? [reading] : [reading, answered];
  return {
    answer: (answered ?? reading).completionClaim ?? "",
    stopReason: (answered ?? reading).stopReason,
    messages: (answered ?? reading).messages,
    charge: {
      steps: loops.reduce((total, loop) => total + loop.steps, 0),
      tokensUsed: loops.reduce((total, loop) => total + loop.tokensUsed, 0),
      usage: answered === null ? reading.usage : combineUsage(reading.usage, answered.usage),
      callsWithUnknownUsage: loops.reduce((total, loop) => total + loop.callsWithUnknownUsage, 0),
    },
  };
}

/** What one examination of the incumbent found, for the record and the repair loop. */
export interface ReviewExamination {
  readonly mode: ReviewMode;
  readonly identity: string;
  /** The repair brief, or null where nothing was established (or raised, for prose). */
  readonly brief: string | null;
  readonly probes: readonly ReviewProbe[];
  readonly classified: readonly CaseClassification[];
  readonly parts: Readonly<Record<string, GateStatus>>;
  readonly claims: readonly string[];
  readonly record: string;
}

/** The record of an examination, with its cost and what each case established. */
export async function recordExamination(
  evidence: EvidenceRecorder,
  payload: {
    readonly mode: ReviewMode;
    readonly phase: "examined" | "withheld" | "remeasured";
    readonly reason?: string;
    readonly answerError?: string | null;
    readonly dropped?: ProbeAdmission["dropped"];
    readonly probes?: readonly ReviewProbe[];
    readonly objections?: readonly ReviewObjection[];
    readonly classified?: readonly CaseClassification[];
    readonly parts?: Readonly<Record<string, GateStatus>>;
    readonly runs?: readonly string[];
    readonly charge?: ReviewCharge;
    readonly wallMs?: number;
    /** The loader found, every way tried, and the task's code statements read. */
    readonly grounding?: JsonValue;
    /** Each submitted probe's admission run: its tree, round, reading and whether it was reused. */
    readonly validation?: readonly {
      readonly probe: string;
      readonly round: number;
      readonly tree: "base" | "candidate";
      readonly kind: ProbeTrial["kind"];
      readonly reused: boolean;
      readonly detail: string;
    }[];
  },
): Promise<string> {
  const recorded = await evidence.record({
    type: "verification-command",
    actor: "harness",
    provenance:
      payload.probes === undefined && payload.objections === undefined
        ? ["tool-output"]
        : ["model", "tool-output"],
    payload: asJsonValue({
      rule: reviewRule,
      ...payload,
      limitation:
        "probes are the reviewer's choice of inputs, run by the harness; a preservation case's expectation is the base's observed answer, which is not by itself what the project should do, and a requirement case's expectation is the reviewer's reading of the task. Nothing here decides acceptance.",
    }),
  });
  return recorded.record.payloadDigest;
}

/** Runs probes on a fresh checkout of one tree; supplied by the caller that owns checkouts. */
export type ProbeRunner = (
  probes: readonly ReviewProbe[],
  tree: "base" | "candidate",
) => Promise<{
  readonly runs: ReadonlyMap<string, readonly [ProbeRun, ProbeRun]>;
  readonly records: readonly string[];
}>;

/** What the review needs from the run it serves. */
export interface CandidateReviewOptions {
  readonly mode: ReviewMode;
  readonly task: string;
  readonly evidence: EvidenceRecorder;
  readonly clock: Clock;
  readonly runProbes: ProbeRunner;
  readonly diff: () => Promise<string>;
  /** The run's obligations as the reviewer is shown them, each with its id. */
  readonly obligations: readonly string[];
  /** The obligations the task states, which alone make a preservation case a finding. */
  readonly authorities: readonly ReviewAuthority[];
  readonly runLoop: (
    prompt: string,
    dependencies: AgentLoopDependencies,
  ) => Promise<AgentLoopOutcome>;
  readonly loopDependencies: AgentLoopDependencies;
  readonly readOnly: () => Pick<AgentLoopDependencies, "toolInvoker" | "toolSchemas">;
  /** What the run has left to spend now. */
  readonly remaining: () => { readonly tokens: number; readonly wallMs: number };
  /** Charges the conversation to the run's own allowance. */
  readonly charge: (charge: ReviewCharge) => Promise<void>;
  /**
   * How a probe loads the project, found once on the base, and the task's own code statements.
   * Absent, the harness builds no probes of its own and the reviewer is told of no loader.
   */
  readonly grounding?: () => Promise<ReviewGrounding>;
  /** Runs one program once on a copy of a tree, for admission; absent, nothing is validated. */
  readonly validate?: ProbeValidator;
}

/** What the harness found before the reviewer is asked: a loader, and the task's own code. */
export interface ReviewGrounding {
  readonly loader: GroundedLoader | null;
  /** Each way tried, with what it gave, so a missing loader names what failed. */
  readonly attempts: readonly {
    readonly entry: string;
    readonly method: string;
    readonly outcome: string;
  }[];
  readonly statements: readonly TaskCodeStatement[];
}

/**
 * One program run once on a copy of a tree, read for admission:
 * - `observation`: it loaded and every input gave the project's answer;
 * - `project-exception`: it loaded, and the project raised for an input, which is an answer;
 * - `load-failure`: the program did not load;
 * - `probe-failure`: it loaded, and threw in its own code, printed to stdout or did not finish.
 * `reused` where an identical trial (program, inputs, tree, candidate and environment) already
 * ran and its reading stands.
 */
export interface ProbeTrial {
  readonly kind: "observation" | "project-exception" | "load-failure" | "probe-failure";
  readonly detail: string;
  readonly reused: boolean;
}

export type ProbeValidator = (
  program: string,
  inputs: readonly unknown[],
  tree: "base" | "candidate",
) => Promise<ProbeTrial>;

const brokenTrial = (trial: ProbeTrial) =>
  trial.kind === "load-failure" || trial.kind === "probe-failure";

/** A relation's reference as a probe of its own, for the runner. */
const referenceProbe = (probe: ReviewProbe): ReviewProbe => ({
  ...probe,
  id: `${probe.id}-ref`.slice(0, 41),
  program: probe.reference ?? probe.program,
});

/** The reviewer's share of what is left, and the least it needs to be worth asking. */
const reviewSteps = 10;
const reviewTokenShare = 0.25;
const reviewWallShare = 0.3;
const reviewWallCapMs = 240_000;
const reviewWallFloorMs = 60_000;
/** An attempt after the review needs at least this, besides one cycle to measure it. */
const repairFloorMs = 60_000;

const identityOf = (value: unknown) => `review ${digestOfJson(asJsonValue(value))}`;

/**
 * The hook the repair loop asks once the gates are green and nothing else is owed. Withheld,
 * on the record, where what is left cannot pay for the reviewer, the probes' runs, an attempt
 * and the cycle that measures it.
 */
export function createCandidateReview(options: CandidateReviewOptions): {
  readonly examine: (cycle: {
    readonly statuses: Readonly<Record<string, GateStatus>>;
    readonly runs: readonly { readonly observation: { readonly durationMs: number } }[];
    readonly blockingFailures?: readonly unknown[];
  }) => Promise<{
    readonly identity: string;
    readonly brief: string | null;
    readonly parts: Readonly<Record<string, GateStatus>>;
    readonly claims: readonly string[];
    readonly record: string;
  }>;
  readonly measure: () => Promise<{
    readonly parts: Readonly<Record<string, GateStatus>>;
    readonly claims: readonly string[];
  }>;
  readonly withhold: (reason: string) => Promise<string>;
  /** The ratchet kept the candidate last measured: its readings become the reported ones. */
  readonly adopt: () => void;
  /** The probes and their readings on the kept candidate, for the report; empty before one. */
  readonly readings: () => {
    readonly probes: readonly ReviewProbe[];
    readonly classified: readonly CaseClassification[];
  };
} {
  let probes: readonly ReviewProbe[] = [];
  let examined: readonly CaseClassification[] = [];
  let latest: readonly CaseClassification[] = [];
  // A later candidate's readings, held until the ratchet keeps that candidate: a rolled-back
  // candidate's readings are never the ones reported.
  let measured: readonly CaseClassification[] | null = null;
  const nothing = (record: string) => ({
    identity: "",
    brief: null,
    parts: {},
    claims: [],
    record,
  });
  return {
    examine: async (cycle) => {
      const started = options.clock.now();
      const cycleMs = cycle.runs.reduce((total, run) => total + run.observation.durationMs, 0);
      const remaining = options.remaining();
      const maxOutput = options.loopDependencies.maxOutputTokens;
      const budget = {
        maxSteps: reviewSteps,
        maxTokens: Math.floor(remaining.tokens * reviewTokenShare),
        maxWallTimeMs: Math.min(reviewWallCapMs, Math.floor(remaining.wallMs * reviewWallShare)),
      };
      // Two checkouts for the probes cost about what one cycle's verification does, so that much
      // is held for them, and an attempt and its cycle after.
      const needed = reviewWallFloorMs + 2 * cycleMs + repairFloorMs + cycleMs;
      if (
        budget.maxTokens < 3 * maxOutput ||
        remaining.wallMs < needed ||
        budget.maxWallTimeMs < reviewWallFloorMs
      )
        return nothing(
          await recordExamination(options.evidence, {
            mode: options.mode,
            phase: "withheld",
            reason: `too little left: ${remaining.tokens} tokens and ${remaining.wallMs} ms, where the review, its probes, an attempt and its cycle need ${needed} ms and ${3 * maxOutput} tokens`,
          }),
        );
      const diff = await options.diff();
      const checks = Object.entries(cycle.statuses).map(([id, status]) => `${id}: ${status}`);
      const grounding =
        options.mode === "executable" && options.grounding !== undefined
          ? await options.grounding()
          : null;
      // A probe whose text the record's scrubber would redact cannot be held to what ran.
      const harnessProbes =
        grounding?.loader == null
          ? []
          : taskProbes(grounding.statements, grounding.loader).filter(
              (probe) => recordable(probe, 0)?.id === probe.id,
            );
      const loading =
        grounding === null
          ? undefined
          : grounding.loader === null
            ? `The harness found no way to load the project from a probe; it tried: ${grounding.attempts.map((one) => `${one.entry} by ${one.method} (${one.outcome})`).join("; ") || "nothing it could name"}.`
            : `How a probe loads the project (the harness ran this on the unchanged base, where it exposed ${grounding.loader.exports.slice(0, 60).join(", ")}):\n${grounding.loader.preamble}`;
      const taskCode = harnessProbes.flatMap((probe) =>
        probe.basis === "relation"
          ? [
              `${probe.id} (relation): ${(grounding?.statements.find((one) => one.id === probe.id) as TaskRelation | undefined)?.subject ?? ""} equals ${(grounding?.statements.find((one) => one.id === probe.id) as TaskRelation | undefined)?.reference ?? ""}, for inputs ${shown(JSON.stringify(probe.cases.map((one) => one.input)), 600)}`,
            ]
          : (probe.statements ?? []).map((statement, index) => {
              const example = grounding?.statements.find((one) => one.id === statement.id) as
                | TaskExample
                | undefined;
              return `${statement.id} (${probe.basis === "preserve" ? "kept" : "requested"}): ${example?.call ?? ""} gives ${JSON.stringify(probe.cases[index]?.expected)}`;
            }),
      );
      const conversation = await converse({
        mode: options.mode,
        request: (toolSteps) =>
          reviewRequest({
            task: options.task,
            diff,
            obligations: options.obligations,
            checks,
            toolSteps,
            ...(loading === undefined ? {} : { loading }),
            taskCode,
          }),
        budget,
        runLoop: options.runLoop,
        loopDependencies: options.loopDependencies,
        readOnly: options.readOnly(),
        clock: options.clock,
      });
      await options.charge(conversation.charge);
      const parsed = parseReviewAnswer(conversation.answer);
      if (options.mode === "prose") {
        const objections = admitObjections(parsed.value);
        const record = await recordExamination(options.evidence, {
          mode: "prose",
          phase: "examined",
          answerError: parsed.error,
          objections,
          charge: conversation.charge,
          wallMs: options.clock.now() - started,
        });
        return objections.length === 0
          ? nothing(record)
          : {
              identity: identityOf(objections),
              brief: objectionsBrief({
                objections,
                keepStatements: options.authorities.map((one) => one.statement),
              }),
              parts: {},
              claims: [],
              record,
            };
      }
      let admitted = admitProbes(options.task, parsed.value);
      let charge = conversation.charge;
      let answerError = parsed.error;
      // One revision where every probe was dropped for its form, with the reasons: a probe that
      // cannot run says nothing either way, and the first live answer gave paths for programs.
      const spare = options.remaining();
      if (
        admitted.probes.length === 0 &&
        (admitted.dropped.length > 0 || parsed.error !== null) &&
        spare.tokens * reviewTokenShare >= 3 * maxOutput &&
        spare.wallMs >= needed
      ) {
        const revision = await converse({
          mode: "executable",
          request: () =>
            [
              "None of your probes can run:",
              ...(parsed.error === null ? [] : [`- the answer: ${parsed.error}`]),
              ...admitted.dropped.map((one) => `- ${one.id}: ${one.reason}`),
              "Answer again with the one JSON object, every program the full source text of a module with a default export, every probe with its cases.",
            ].join("\n"),
          budget: {
            maxSteps: 3,
            maxTokens: Math.floor(spare.tokens * reviewTokenShare),
            maxWallTimeMs: Math.min(reviewWallCapMs, Math.floor(spare.wallMs * reviewWallShare)),
          },
          runLoop: options.runLoop,
          loopDependencies: options.loopDependencies,
          readOnly: options.readOnly(),
          clock: options.clock,
          history: conversation.messages,
        });
        await options.charge(revision.charge);
        charge = addCharge(charge, revision.charge);
        const revised = parseReviewAnswer(revision.answer);
        answerError = revised.error;
        const again = admitProbes(options.task, revised.value);
        admitted = {
          probes: again.probes,
          dropped: [
            ...admitted.dropped.map((one) => ({ ...one, reason: `first answer: ${one.reason}` })),
            ...again.dropped,
          ],
        };
      }
      // Every probe the reviewer submitted runs once on a copy of the tree it is read on before it
      // counts, by the harness and not at the reviewer's choice. One that does not load or throws
      // in its own code goes back once with its error; still broken, what it would have measured
      // is unmeasured, and says so.
      const validation: {
        readonly probe: string;
        readonly round: number;
        readonly tree: "base" | "candidate";
        readonly kind: ProbeTrial["kind"];
        readonly reused: boolean;
        readonly detail: string;
      }[] = [];
      const validate = async (round: number, candidates: readonly ReviewProbe[]) => {
        const broken: { readonly probe: ReviewProbe; readonly why: string }[] = [];
        if (options.validate === undefined) return { valid: candidates, broken };
        const valid: ReviewProbe[] = [];
        for (const probe of candidates) {
          const inputs = probe.cases.map((one) => one.input);
          const trials: ["base" | "candidate", ProbeTrial][] = [
            ["candidate", await options.validate(probe.program, inputs, "candidate")],
          ];
          if (probe.reference !== undefined)
            trials.push(["base", await options.validate(probe.reference, inputs, "base")]);
          for (const [tree, trial] of trials)
            validation.push({
              probe: probe.id,
              round,
              tree,
              ...trial,
              detail: trial.detail.slice(0, 600),
            });
          const failed = trials.find(([, trial]) => brokenTrial(trial));
          if (failed === undefined) valid.push(probe);
          else
            broken.push({
              probe,
              why: `${failed[0] === "base" ? "its reference, on the unchanged base" : "on a copy of the change"}: ${failed[1].kind}: ${failed[1].detail.slice(0, 400)}`,
            });
        }
        return { valid, broken };
      };
      let checked = await validate(1, admitted.probes);
      // Probes refused for their form get the same one correction as probes that did not run.
      const refused = admitted.dropped.filter(
        (one) => !/^at most \d+ probes run$|^the id was already used$/.test(one.reason),
      );
      const room = options.remaining();
      if (
        (checked.broken.length > 0 || refused.length > 0) &&
        checked.valid.length < maxProbes &&
        room.tokens * reviewTokenShare >= 3 * maxOutput &&
        room.wallMs >= needed
      ) {
        const correction = await converse({
          mode: "executable",
          request: () =>
            [
              ...(checked.broken.length === 0
                ? []
                : [
                    "These probes did not run as written; the harness ran each once:",
                    ...checked.broken.map((one) => `- ${one.probe.id}: ${one.why}`),
                  ]),
              ...(refused.length === 0
                ? []
                : [
                    "These probes were not admitted:",
                    ...refused.map((one) => `- ${one.id}: ${one.reason}`),
                  ]),
              ...(loading === undefined ? [] : [loading]),
              "Answer again with the one JSON object holding corrected versions of these probes only. Each is run once more; one still broken measures nothing.",
            ].join("\n"),
          budget: {
            maxSteps: 3,
            maxTokens: Math.floor(room.tokens * reviewTokenShare),
            maxWallTimeMs: Math.min(reviewWallCapMs, Math.floor(room.wallMs * reviewWallShare)),
          },
          runLoop: options.runLoop,
          loopDependencies: options.loopDependencies,
          readOnly: options.readOnly(),
          clock: options.clock,
          history: conversation.messages,
        });
        await options.charge(correction.charge);
        charge = addCharge(charge, correction.charge);
        // A corrected probe is taken under whatever id it comes back with (a live reviewer gave
        // every corrected probe a new id), never one that already ran, and only up to the limit.
        const kept = new Set(checked.valid.map((one) => one.id));
        const corrected = admitProbes(options.task, parseReviewAnswer(correction.answer).value);
        const retried = await validate(
          2,
          corrected.probes
            .filter((one) => !kept.has(one.id))
            .slice(0, maxProbes - checked.valid.length),
        );
        // A probe corrected under its own id is read once, by its second run.
        const retriedIds = new Set(
          [...retried.valid, ...retried.broken.map((one) => one.probe)].map((one) => one.id),
        );
        checked = {
          valid: [...checked.valid, ...retried.valid],
          broken: [
            ...checked.broken.filter((one) => !retriedIds.has(one.probe.id)),
            ...retried.broken,
          ],
        };
      }
      admitted = {
        probes: checked.valid,
        dropped: [
          ...admitted.dropped,
          ...checked.broken.map((one) => ({
            id: one.probe.id,
            reason: `unmeasured: it did not run as written (${one.why})`,
          })),
        ],
      };
      // Inputs the reviewer added to a relation the task writes as code: the expectation is still
      // the reference's answer on the base, so the reviewer chooses only where to look.
      const added = (parsed.value as { relationInputs?: unknown } | null)?.relationInputs;
      const runnable = [
        ...harnessProbes.map((probe) => {
          const extra =
            probe.basis === "relation" && added !== null && typeof added === "object"
              ? (added as Record<string, unknown>)[probe.id]
              : undefined;
          if (!Array.isArray(extra)) return probe;
          const inputs = extra
            .slice(0, 4)
            .filter((one) => !probe.cases.some((known) => textOf(known.input) === textOf(one)));
          return {
            ...probe,
            cases: [...probe.cases, ...inputs.map((input) => ({ input }))],
            statements: [
              ...(probe.statements ?? []),
              ...inputs.map(
                () => probe.statements?.[0] ?? { id: probe.id, sentence: probe.quote ?? "" },
              ),
            ],
          };
        }),
        ...admitted.probes,
      ];
      if (runnable.length === 0)
        return nothing(
          await recordExamination(options.evidence, {
            mode: "executable",
            phase: "examined",
            answerError,
            dropped: admitted.dropped,
            probes: [],
            ...(grounding === null ? {} : { grounding: groundingRecord(grounding) }),
            validation,
            charge,
            wallMs: options.clock.now() - started,
          }),
        );
      const left = options.remaining();
      if (left.wallMs < 2 * cycleMs + repairFloorMs + cycleMs)
        return nothing(
          await recordExamination(options.evidence, {
            mode: "executable",
            phase: "withheld",
            reason: `the reviewer answered with ${left.wallMs} ms left, too little to run its probes and still give an attempt`,
            probes: runnable,
            dropped: admitted.dropped,
            validation,
            charge,
          }),
        );
      // A relation's reference runs as a probe of its own; its answer on the base is the
      // expectation, and its answer on the candidate is kept for the record.
      const withReferences = [
        ...runnable,
        ...runnable.filter((probe) => probe.reference !== undefined).map(referenceProbe),
      ];
      const base = await options.runProbes(withReferences, "base");
      const candidate = await options.runProbes(withReferences, "candidate");
      const runnableHere = (cycle.blockingFailures ?? []).length === 0;
      const runsOf = (reading: typeof base, id: string) =>
        reading.runs.get(id) ?? [missingRun, missingRun];
      const classified = runnable.flatMap((probe) =>
        probe.basis === "relation"
          ? classifyRelation(
              probe,
              runsOf(base, referenceProbe(probe).id),
              runsOf(candidate, probe.id),
            )
          : probe.origin === "task"
            ? classifyTaskExamples(
                probe,
                runsOf(base, probe.id),
                runsOf(candidate, probe.id),
                runnableHere,
              )
            : classifyProbe(
                probe,
                runsOf(base, probe.id),
                runsOf(candidate, probe.id),
                authorityOf(probe, options.authorities),
                runnableHere,
              ),
      );
      probes = runnable;
      examined = classified;
      latest = classified;
      const { parts, claims } = reviewParts(classified);
      const findings = classified.filter((one) => establishedReadings.has(one.reading));
      const record = await recordExamination(options.evidence, {
        mode: "executable",
        phase: "examined",
        answerError,
        dropped: admitted.dropped,
        probes: runnable,
        ...(grounding === null ? {} : { grounding: groundingRecord(grounding) }),
        validation,
        classified,
        parts,
        runs: [...base.records, ...candidate.records],
        charge,
        wallMs: options.clock.now() - started,
      });
      return {
        identity: identityOf(runnable),
        brief:
          findings.length === 0
            ? null
            : findingsBrief({
                task: options.task,
                probes,
                findings,
                authorities: options.authorities,
                candidate: digestOfBytes(diff),
              }),
        parts,
        claims,
        record,
      };
    },
    measure: async () => {
      if (probes.length === 0) return { parts: {}, claims: [] };
      const candidate = await options.runProbes(probes, "candidate");
      const classified = remeasure(probes, examined, candidate.runs);
      const { parts, claims } = reviewParts(classified);
      await recordExamination(options.evidence, {
        mode: options.mode,
        phase: "remeasured",
        classified,
        parts,
        runs: candidate.records,
      });
      measured = classified;
      return { parts, claims };
    },
    adopt: () => {
      if (measured !== null) latest = measured;
      measured = null;
    },
    readings: () => ({ probes, classified: latest }),
    withhold: (reason) =>
      recordExamination(options.evidence, { mode: options.mode, phase: "withheld", reason }),
  };
}

const missingRun: ProbeRun = { kind: "did-not-complete", detail: "the probe was not run" };

/** The grounding as the examination records it. */
function groundingRecord(grounding: ReviewGrounding): JsonValue {
  return asJsonValue({
    loader:
      grounding.loader === null
        ? null
        : {
            rule: grounding.loader.rule,
            entry: grounding.loader.entry,
            method: grounding.loader.method,
            exports: grounding.loader.exports,
          },
    attempts: grounding.attempts,
    statements: grounding.statements,
  });
}

function addCharge(first: ReviewCharge, second: ReviewCharge): ReviewCharge {
  return {
    steps: first.steps + second.steps,
    tokensUsed: first.tokensUsed + second.tokensUsed,
    usage: combineUsage(first.usage, second.usage),
    callsWithUnknownUsage: first.callsWithUnknownUsage + second.callsWithUnknownUsage,
  };
}

/**
 * The review's probes as preservation obligations, each with its cases that hold behaviour the
 * base showed (input, both trees' answers, reading) and the authoritative obligation it names. A
 * probe with no such case (a requirement probe whose every case is the reviewer's expectation) is
 * not a preservation obligation and is left out.
 */
export function probeObligations(
  readings: {
    readonly probes: readonly ReviewProbe[];
    readonly classified: readonly CaseClassification[];
  },
  authorities: readonly ReviewAuthority[] = [],
): readonly {
  readonly probe: string;
  readonly statement: string;
  readonly quote: string | null;
  readonly obligation: string | null;
  readonly origin?: "task";
  readonly cases: readonly {
    readonly index: number;
    readonly input: unknown;
    readonly base: string | null;
    readonly candidate: string | null;
    readonly reading: string;
  }[];
}[] {
  return readings.probes.flatMap((probe) => {
    // A probe of the task's code is one obligation per statement, each its own cases.
    if (probe.origin === "task") {
      const ids = [...new Set((probe.statements ?? []).map((one) => one.id))];
      return ids.map((id) => {
        const cases = readings.classified.filter(
          (one) => one.probe === probe.id && probe.statements?.[one.index - 1]?.id === id,
        );
        const sentence = probe.statements?.find((one) => one.id === id)?.sentence ?? "";
        return {
          probe: probe.id,
          statement: sentence,
          quote: sentence,
          obligation: id,
          origin: "task" as const,
          cases: cases.map((one) => ({
            index: one.index,
            input: one.input,
            base: one.base,
            candidate: one.candidate,
            reading: one.reading,
          })),
        };
      });
    }
    const cases = readings.classified.filter(
      (one) => one.probe === probe.id && (probe.basis === "preserve" || one.role === "kept"),
    );
    if (cases.length === 0) return [];
    return [
      {
        probe: probe.id,
        statement: probe.keeps ?? probe.quote ?? `probe ${probe.id}`,
        quote: probe.quote ?? null,
        obligation: authorityOf(probe, authorities)?.id ?? null,
        cases: cases.map((one) => ({
          index: one.index,
          input: one.input,
          base: one.base,
          candidate: one.candidate,
          reading: one.reading,
        })),
      },
    ];
  });
}
