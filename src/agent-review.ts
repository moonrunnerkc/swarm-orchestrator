import { z } from "zod";
import type { Clock } from "./core/clock.ts";
import type { AgentLoopDependencies, AgentLoopOutcome } from "./core/loop.ts";
import {
  combineUsage,
  type GateStatus,
  type LoopEvent,
  type LoopUsage,
} from "./core/loop-events.ts";
import { asJsonValue, digestOfBytes, digestOfJson } from "./evidence/canonical-json.ts";
import type { EvidenceRecorder } from "./evidence/session.ts";
import { sentencesQuoted } from "./workers/planned-check-program.ts";

/**
 * A separate review of the actual candidate, with executable probes (candidate-review-v2).
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
export const reviewRule = "candidate-review-v2";

export type ReviewMode = "executable" | "prose";

const probeId = z.string().regex(/^[a-z][a-z0-9-]{0,40}$/);
const probeCaseSchema = z.object({
  input: z.unknown(),
  expected: z.unknown().optional(),
  throws: z.literal(true).optional(),
});
const probeSchema = z.object({
  id: probeId,
  basis: z.enum(["preserve", "requirement"]),
  /** The task's own words the probe rests on: required for a requirement, optional otherwise. */
  quote: z.string().min(1).max(600).optional(),
  /** For a preservation probe: the existing behaviour it says stays the same. */
  keeps: z.string().min(1).max(400).optional(),
  /** The id of the run's obligation the probe exercises (`task-keep-2`), where it names one. */
  obligation: z.string().min(1).max(80).optional(),
  program: z.string().min(1).max(16_000),
  cases: z.array(probeCaseSchema).min(1).max(6),
});
export type ReviewProbe = z.infer<typeof probeSchema>;

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
    const parsed = probeSchema.safeParse(
      raw !== null && typeof raw === "object" ? { ...raw, id } : raw,
    );
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      dropped.push({
        id,
        reason: `not a probe: ${issue?.path.join(".") || "probe"}: ${issue?.message ?? "invalid"}`,
      });
      continue;
    }
    const probe = parsed.data;
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
  | "did-not-complete";

/**
 * The only reading that reaches repair: behaviour the base showed, that an obligation the task
 * states covers, and that the candidate lost. A requirement case's expectation is the reviewer's,
 * and a difference no task sentence protects may be what the task asked for.
 */
export const establishedReadings: ReadonlySet<CaseReading> = new Set(["preservation-regression"]);

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
  /** Which part holds this case: a kept case is behaviour the base showed, a requested one is a claim. */
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
    if (one.role !== "kept" || one.authority === null) continue;
    const name = `${one.probe}: kept`;
    const holds = one.reading === "kept";
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
    if (one.role !== "kept") return one;
    const probe = probes.find((candidateProbe) => candidateProbe.id === one.probe);
    const runs = candidate.get(one.probe);
    const answers =
      runs === undefined
        ? null
        : runs.map((run) => (run.kind === "answered" ? run.answers[one.index - 1] : undefined));
    if (probe === undefined || answers === null || answers.some((answer) => answer === undefined))
      return {
        ...one,
        candidate: null,
        reading: "preservation-regression",
        detail: "the probe gave no answer on this candidate",
      };
    const first = answerText(answers[0] as CaseAnswer);
    const holds = first === one.base && first === answerText(answers[1] as CaseAnswer);
    return {
      ...one,
      candidate: first,
      reading: holds ? "kept" : "preservation-regression",
    };
  });
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
    "A separate review of your change ran these probes on fresh checkouts of the unchanged base and of your change. What each tree gave was observed by the harness. Each finding is behaviour the base had, which the task's own words require kept, and which your change does not keep.",
    `They were read on the candidate ${input.candidate}.`,
    "",
  ];
  for (const finding of input.findings.slice(0, 6)) {
    const probe = input.probes.find((one) => one.id === finding.probe) as ReviewProbe;
    const authority = input.authorities.find((one) => one.id === finding.authority);
    lines.push(
      `Probe ${probe.id}, case ${finding.index} (${finding.reading}), under ${finding.authority}: "${authority?.statement ?? ""}".`,
      `  input: ${shown(JSON.stringify(finding.input) ?? "undefined")}`,
      `  expected (the base's answer, observed): ${shown(finding.base)}`,
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
    );
  }
  lines.push(
    "",
    "Change the code so these inputs give the base's answer again, keeping what the task asked for. Where the task asks for this behaviour to change, leave the code as it is and say which sentence asks for it. Do not change tests to match a probe. The probes run again on your result: a change that breaks a case held here is rolled back, and the checks that decide acceptance are unchanged.",
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
    "Look above all for existing behaviour the change broke that the task requires kept (the obligations listed with an id), including in callers and neighbours of what it changed.",
    "A probe program is plain JavaScript, an ES module run as a .mjs file: no TypeScript syntax (no type annotations, no `as`, no interfaces). Import the project's own JavaScript, or its built output, by ./ paths from the repository root. Where the sources are TypeScript, load them the way the project's own checks and tests do (read one first: often a loader it already depends on, such as jiti or tsx). Try each program with try_probe first.",
    "Answer with one JSON object and nothing else:",
    '{"probes": up to 4 {"id": a short slug, "basis": "preserve" or "requirement",',
    ' "obligation": for "preserve", the id of the listed obligation the probe exercises,',
    ' "quote": the task\'s own words the probe rests on (required for "requirement"),',
    ' "keeps": for "preserve", the existing behaviour that should stay the same,',
    ' "program": the source text of an ES module (not a path), run from the repository root, whose default export takes one input and returns a JSON-serialisable value; it may be async, and for asynchronous behaviour it returns what it observed (which calls ran, in what order, which promises settled and how), never a timing,',
    ' "cases": up to 6 {"input", "expected" (for "requirement": the answer the task\'s words imply), "throws": true where the task says it throws}}}.',
    'For "preserve" probes choose inputs whose behaviour the task does not change and an obligation the task states covers: the harness takes their expected answer from the unchanged base, not from you, and a difference counts only under such an obligation. A requirement probe\'s expected answer is your reading of the task; it is reported and never acted on.',
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
}

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
  /** The probes and their latest readings, for the report; empty before an examination. */
  readonly readings: () => {
    readonly probes: readonly ReviewProbe[];
    readonly classified: readonly CaseClassification[];
  };
} {
  let probes: readonly ReviewProbe[] = [];
  let examined: readonly CaseClassification[] = [];
  let latest: readonly CaseClassification[] = [];
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
      const conversation = await converse({
        mode: options.mode,
        request: (toolSteps) =>
          reviewRequest({
            task: options.task,
            diff,
            obligations: options.obligations,
            checks,
            toolSteps,
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
      if (admitted.probes.length === 0)
        return nothing(
          await recordExamination(options.evidence, {
            mode: "executable",
            phase: "examined",
            answerError,
            dropped: admitted.dropped,
            probes: [],
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
            probes: admitted.probes,
            dropped: admitted.dropped,
            charge,
          }),
        );
      const base = await options.runProbes(admitted.probes, "base");
      const candidate = await options.runProbes(admitted.probes, "candidate");
      const classified = admitted.probes.flatMap((probe) =>
        classifyProbe(
          probe,
          base.runs.get(probe.id) ?? [missingRun, missingRun],
          candidate.runs.get(probe.id) ?? [missingRun, missingRun],
          authorityOf(probe, options.authorities),
          (cycle.blockingFailures ?? []).length === 0,
        ),
      );
      probes = admitted.probes;
      examined = classified;
      latest = classified;
      const { parts, claims } = reviewParts(classified);
      const findings = classified.filter((one) => establishedReadings.has(one.reading));
      const record = await recordExamination(options.evidence, {
        mode: "executable",
        phase: "examined",
        answerError,
        dropped: admitted.dropped,
        probes: admitted.probes,
        classified,
        parts,
        runs: [...base.records, ...candidate.records],
        charge,
        wallMs: options.clock.now() - started,
      });
      return {
        identity: identityOf(admitted.probes),
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
      latest = classified;
      return { parts, claims };
    },
    readings: () => ({ probes, classified: latest }),
    withhold: (reason) =>
      recordExamination(options.evidence, { mode: options.mode, phase: "withheld", reason }),
  };
}

const missingRun: ProbeRun = { kind: "did-not-complete", detail: "the probe was not run" };

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
  readonly cases: readonly {
    readonly index: number;
    readonly input: unknown;
    readonly base: string | null;
    readonly candidate: string | null;
    readonly reading: string;
  }[];
}[] {
  return readings.probes.flatMap((probe) => {
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
