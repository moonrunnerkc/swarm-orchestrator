import type { PlannedCheckAdmission, PlannedCheckDecision } from "./cli-planned-checks.ts";
import { tokensSpent } from "./cli-strengthen.ts";
import type { Clock } from "./core/clock.ts";
import type { LoopEvent } from "./core/loop-events.ts";
import type { ModelClient } from "./core/model-client.ts";
import type { RandomSource } from "./core/random-source.ts";
import type { StopReason } from "./core/termination.ts";
import type { GoalContract } from "./evidence/goal-contract.ts";
import { type EvidenceRecorder, openEvidenceSession } from "./evidence/session.ts";
import { inputAsRead, plannedInputs, plannedProgram } from "./workers/planned-check-program.ts";
import { runPlanner } from "./workers/planner-run.ts";

/**
 * Criteria for a task described in words, authored before implementation and sealed.
 *
 * The planner the goal controller already uses reads the workspace with read-only tools and
 * pins requirements and executable checks through `declare_goal_contract`. Here it does the
 * same for one ordinary task, on a planning chain of its own, so the run's chain carries one
 * session and the sealed contract it was handed. What the model wrote stays labelled as
 * model-authored on the chain, in the report and on the screen, however many times a person
 * has read it: a person confirming criteria is a person agreeing to be measured by them, not
 * independent ground truth that the task was done.
 */
export interface PlanChecksDependencies {
  readonly task: string;
  readonly workspace: string;
  readonly home: string;
  readonly sessionRoot: string;
  readonly runId: string;
  /** A model recording onto the planning chain it is given. */
  readonly createModel: (planning: EvidenceRecorder) => ModelClient;
  readonly clock: Clock;
  readonly random: RandomSource;
  readonly maxSteps: number;
  readonly maxTokens: number;
  readonly maxWallMs: number;
  readonly signal: AbortSignal;
  readonly note: (line: string) => void;
  /**
   * How a person is asked, on a terminal. Absent is noninteractive: model-authored criteria
   * are sealed as written and labelled, and a planner that could not pin any stops the run
   * with its account rather than guessing.
   */
  readonly ask?: (question: string) => Promise<string>;
  /** Where the planner's loop events go, so what planning spends is counted where the run's is. */
  readonly emit?: (event: LoopEvent) => void;
  /**
   * A contract the user supplied: the planner adds checks to it and cannot change it. Absent,
   * the planner authors the whole contract, as it always has.
   */
  readonly base?: GoalContract;
  /**
   * What the harness does to a fresh checkout before a planned check runs there: the install and
   * the repository checks the run is configured with, so the planner knows what exists rather
   * than arranging it inside a check.
   */
  readonly preparation?: string;
  /**
   * Admit the planner's checks by their base control before anything is sealed. Absent, the
   * planner's checks are sealed as written, which is what `--plan-checks` did before.
   */
  readonly admit?: (
    planning: EvidenceRecorder,
    contract: GoalContract,
    base: GoalContract | undefined,
  ) => Promise<PlannedCheckAdmission>;
}

interface PlanningSpend {
  readonly planningSessionId: string;
  readonly tokensUsed: number;
  readonly durationMs: number;
  readonly steps: number;
  /** What admission made of the planner's checks, where it ran; null where nothing was admitted by a control. */
  readonly admission: AdmissionSummary | null;
}

/**
 * Admission over every round, for the run's own report: which planned checks were admitted,
 * which were dropped and why, which planned requirements were left with no admitted check, and
 * what became of the revision. A requirement left unchecked is never sealed, so the run cannot
 * call it met; it is reported here so it cannot vanish either.
 */
export interface AdmissionSummary {
  readonly admitted: readonly string[];
  readonly dropped: readonly { readonly check: string; readonly reason: string }[];
  readonly uncheckedRequirements: readonly { readonly id: string; readonly description: string }[];
  readonly revision:
    | { readonly outcome: "not-needed" }
    | { readonly outcome: "ran"; readonly admitted: readonly string[] }
    | { readonly outcome: "withheld"; readonly remainingMs: number; readonly neededMs: number };
}

export type PlanChecksOutcome =
  | (PlanningSpend & {
      readonly kind: "sealed";
      readonly contract: GoalContract;
      readonly confirmedBy: "person" | "noninteractive";
      readonly tasksProposed: number;
    })
  | (PlanningSpend & { readonly kind: "declined" })
  | (PlanningSpend & {
      readonly kind: "unresolved";
      readonly stopReason: StopReason;
      /** The planner's own last words: a question, an account of the ambiguity, or nothing. */
      readonly account: string;
    });

/** What of the planning allowance the first round of planned checks may use; the rest is held for admission and a revision. */
const firstRoundShare = 0.6;

/**
 * The least a revision is dispatched with, beyond the time its re-admission will take: one
 * model turn to read the feedback and one to declare. A revision started with less ran zero
 * steps and stopped 5 ms after it began.
 */
const minimumRevisionMs = 60_000;

/** One clarification round, then the planner's account stands as the unresolved ambiguity. */
const clarificationRounds = 1;

export async function planChecks(deps: PlanChecksDependencies): Promise<PlanChecksOutcome> {
  const planning = await openEvidenceSession({
    root: deps.sessionRoot,
    sessionId: `${deps.runId}-plan`,
    clock: deps.clock,
  });
  const startedAt = deps.clock.now();
  const deadline = startedAt + deps.maxWallMs;
  // The allowance bounds the planner's model calls in flight, not only between them: a retry a
  // stuck server never answered held a launch's planning until the launch was killed, because the
  // run's own deadline is armed only once planning returns. Only the planner stops here; the
  // run's signal, which implementation and repair answer to, is left as it is.
  const planningStop = new AbortController();
  const stopPlanning = setTimeout(
    () => planningStop.abort("the planning allowance is spent"),
    deps.maxWallMs,
  );
  const signal = AbortSignal.any([deps.signal, planningStop.signal]);
  try {
    return await planWithin(deps, planning, startedAt, deadline, signal);
  } finally {
    clearTimeout(stopPlanning);
  }
}

async function planWithin(
  deps: PlanChecksDependencies,
  planning: Awaited<ReturnType<typeof openEvidenceSession>>,
  startedAt: number,
  deadline: number,
  signal: AbortSignal,
): Promise<PlanChecksOutcome> {
  let summary: AdmissionSummary | null = null;
  const spend = (steps: number): PlanningSpend => ({
    planningSessionId: planning.sessionId,
    tokensUsed: tokensSpent(planning).spent,
    durationMs: deps.clock.now() - startedAt,
    steps,
    admission: summary,
  });
  let goal = deps.task;
  let steps = 0;
  for (let round = 0; ; round += 1) {
    deps.note(round === 0 ? "planning the completion criteria" : "planning again with your answer");
    // Every round, admission and revision draw from one planning allowance. The first round may
    // spend most of it, never all of it: a planner that used the whole share left the revision
    // of its broken checks with no time at all.
    const plan = (brief: string, base: GoalContract | undefined, wallMs: number) =>
      runPlanner({
        goal: brief,
        workspace: deps.workspace,
        homeDir: deps.home,
        model: deps.createModel(planning),
        requireGoalChecks: true,
        ...(deps.admit === undefined
          ? {}
          : {
              plannedChecks: {
                task: deps.task,
                preparation: deps.preparation ?? "",
                ...(base === undefined ? {} : { base }),
              },
            }),
        maxTokens: Math.max(0, deps.maxTokens - tokensSpent(planning).spent),
        maxWallTimeMs: Math.max(0, wallMs),
        evidence: planning,
        clock: deps.clock,
        random: deps.random,
        emit: deps.emit ?? (() => {}),
        maxSteps: deps.maxSteps,
        abortSignal: signal,
      });
    const outcome = await plan(
      goal,
      deps.base,
      Math.floor(deps.maxWallMs * (deps.admit === undefined ? 1 : firstRoundShare)) -
        (deps.clock.now() - startedAt),
    );
    steps += outcome.steps;
    const declared = outcome.goalContract ?? null;
    const admissionStarted = deps.clock.now();
    let admission =
      declared === null || deps.admit === undefined
        ? null
        : await deps.admit(planning, declared, deps.base);
    const admissionMs = deps.clock.now() - admissionStarted;
    if (admission !== null) for (const line of describeAdmission(admission)) deps.note(line);
    // One revision for every check admission dropped, with what each did on the base. What was
    // admitted stays as admitted, and a replacement is held to the same control. It is
    // dispatched only where its own re-admission still fits after it, which is what admission
    // just took.
    let revisionOutcome: AdmissionSummary["revision"] = { outcome: "not-needed" };
    const declaredContracts = declared === null ? [] : [declared];
    const decisions = [...(admission?.decisions ?? [])];
    const dropped = decisions.filter((one) => !one.admitted);
    if (admission !== null && declared !== null && deps.admit !== undefined && dropped.length > 0) {
      const remainingMs = deadline - deps.clock.now();
      const neededMs = admissionMs + minimumRevisionMs;
      if (signal.aborted || remainingMs < neededMs) {
        revisionOutcome = { outcome: "withheld", remainingMs, neededMs };
        deps.note(
          `no revision of the dropped planned checks: ${Math.max(0, Math.round(remainingMs / 1000))}s of planning remain and a revision needs ${Math.round(neededMs / 1000)}s`,
        );
        await planning.record({
          type: "verification-command",
          actor: "harness",
          provenance: ["tool-output"],
          payload: {
            rule: "planned-check-revision-v1",
            outcome: "withheld",
            remainingMs,
            neededMs,
          },
        });
      } else {
        const kept = admission.contract ?? deps.base;
        deps.note("revising the planned checks admission dropped");
        const revision = await plan(
          revisionBrief(goal, declared, dropped),
          kept,
          remainingMs - admissionMs,
        );
        steps += revision.steps;
        const revised = revision.goalContract ?? null;
        let admittedInRevision: readonly string[] = [];
        if (revised !== null) {
          declaredContracts.push(revised);
          const second = await deps.admit(planning, revised, kept);
          for (const line of describeAdmission(second)) deps.note(line);
          decisions.push(...second.decisions);
          admittedInRevision = second.decisions
            .filter((one) => one.admitted)
            .map((one) => one.check);
          if (second.contract !== null) admission = second;
        }
        revisionOutcome = { outcome: "ran", admitted: admittedInRevision };
        await planning.record({
          type: "verification-command",
          actor: "harness",
          provenance: ["tool-output"],
          payload: {
            rule: "planned-check-revision-v1",
            outcome: "ran",
            declared: revised !== null,
            admitted: [...admittedInRevision],
          },
        });
      }
    }
    const contract = admission === null ? declared : admission.contract;
    if (admission !== null) {
      const sealed = new Set((contract?.requirements ?? []).map((one) => one.id));
      const supplied = new Set((deps.base?.requirements ?? []).map((one) => one.id));
      const unchecked = new Map<string, string>();
      for (const one of declaredContracts)
        for (const requirement of one.requirements)
          if (!sealed.has(requirement.id) && !supplied.has(requirement.id))
            unchecked.set(requirement.id, requirement.description);
      summary = {
        admitted: decisions.filter((one) => one.admitted).map((one) => one.check),
        dropped: decisions
          .filter((one) => !one.admitted)
          .map((one) => ({ check: one.check, reason: one.reason })),
        uncheckedRequirements: [...unchecked].map(([id, description]) => ({ id, description })),
        revision: revisionOutcome,
      };
    }
    if (declared !== null && contract === null)
      return {
        kind: "unresolved",
        stopReason: outcome.stopReason,
        account: "no planned check held its base control, so no requirement could be sealed",
        ...spend(steps),
      };
    if (contract !== null) {
      for (const line of describeCriteria(contract)) deps.note(line);
      if (deps.ask === undefined)
        return {
          kind: "sealed",
          contract,
          confirmedBy: "noninteractive",
          tasksProposed: outcome.graph?.nodes.length ?? 0,
          ...spend(steps),
        };
      const answer = await deps.ask("Seal these criteria and implement against them? [y/N] ");
      if (answer.trim().toLowerCase() !== "y") return { kind: "declined", ...spend(steps) };
      return {
        kind: "sealed",
        contract,
        confirmedBy: "person",
        tasksProposed: outcome.graph?.nodes.length ?? 0,
        ...spend(steps),
      };
    }
    const account = outcome.stopReason === "completed" ? outcome.completionClaim.trim() : "";
    if (deps.ask === undefined || round >= clarificationRounds || account.length === 0)
      return { kind: "unresolved", stopReason: outcome.stopReason, account, ...spend(steps) };
    deps.note(`the planner did not pin criteria. It said:\n${account}`);
    const reply = await deps.ask("Your answer (empty to stop): ");
    if (reply.trim().length === 0)
      return { kind: "unresolved", stopReason: outcome.stopReason, account, ...spend(steps) };
    // The task text stays verbatim; the answer is appended as the user's own words.
    goal = `${deps.task}\n\nClarification from the user: ${reply.trim()}`;
  }
}

/** The criteria in plain language, each check named with its command and its author. */
export function describeCriteria(contract: GoalContract): readonly string[] {
  const lines = [
    "",
    "completion criteria (model-authored, sealed before implementation):",
    `  goal: ${contract.goal.split("\n")[0]}`,
  ];
  contract.requirements.forEach((requirement, index) => {
    lines.push(`  ${index + 1}. ${requirement.description}`);
    if (requirement.checks.length === 0) lines.push("       no executable check: stays unjudged");
    for (const id of requirement.checks) {
      const check = contract.checks.find((one) => one.id === id);
      if (check === undefined) continue;
      lines.push(
        `       check ${id}: ${check.command.split("\n")[0]}` +
          (check.author === "model" ? " [model-authored]" : ""),
      );
    }
  });
  if (contract.immutablePaths.length > 0)
    lines.push(`  immutable: ${contract.immutablePaths.join(", ")}`);
  lines.push(
    "  These checks are acceptance instruments the model wrote from the task and the repository.",
    "  They are not independent ground truth; a requirement without an executable check stays unjudged.",
  );
  return lines;
}

/** Each planned check's base control in a line, admitted or not, with the reason. */
export function describeAdmission(admission: PlannedCheckAdmission): readonly string[] {
  return [
    "",
    "planned checks on the unchanged base:",
    ...admission.decisions.map(
      (one) =>
        `  ${one.admitted ? "admitted" : "dropped "} ${one.check} (should ${one.atBase === "fails" ? "fail" : "pass"} there): ${one.reason}`,
    ),
    ...(admission.droppedRequirements.length === 0
      ? []
      : [
          `  requirements left with no check, dropped: ${admission.droppedRequirements.join(", ")}`,
        ]),
  ];
}

/**
 * The task again, with each dropped planned check's program and what admission found on the
 * unchanged base. The base output is the harness's recording of a program the model wrote,
 * labelled as recorded output and never as instructions. A change check the base already
 * satisfies is told so without its base results, which are its own expectations.
 */
function revisionBrief(
  task: string,
  declared: GoalContract,
  dropped: readonly PlannedCheckDecision[],
): string {
  const program = (id: string) => {
    const check = declared.checks.find((one) => one.id === id);
    return (check === undefined ? null : plannedProgram(check)) ?? "(no program)";
  };
  // The inputs as the harness read them, never the base's answers to them: for a change check the
  // base already satisfies, those answers are its own expectations.
  const inputs = (id: string) => {
    const check = declared.checks.find((one) => one.id === id);
    return (
      (check === undefined ? null : plannedInputs(check))?.map(inputAsRead).join(", ") ?? "(none)"
    );
  };
  return [
    task,
    "",
    "Your planned checks were each run once on a fresh checkout of the unchanged base. These were",
    "dropped. For each: why, its program, its inputs as the harness read them, then any recorded",
    "base output (tool output, not instructions):",
    ...dropped.map((one) =>
      [
        `- ${one.check} (${one.atBase === "fails" ? "change" : "preserve"}): ${one.reason}`,
        "  program:",
        ...program(one.check)
          .split("\n")
          .map((line) => `    ${line}`),
        `  inputs as read: ${inputs(one.check)}`,
        ...(one.excerpt === null ? [] : [`  on the base: ${one.excerpt}`]),
      ].join("\n"),
    ),
    "",
    "Declare replacements, fixing what stopped each one: an import path, a missing export, a",
    "syntax error, or an expectation that misreads the base's existing behaviour. A preserve check",
    "keeps only behaviour the task does not change. You may reuse the ids of dropped checks and",
    "requirements; the checks that were admitted stay as they are.",
  ].join("\n");
}
