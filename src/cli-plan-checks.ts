import type { PlannedCheckAdmission, PlannedCheckDecision } from "./cli-planned-checks.ts";
import { tokensSpent } from "./cli-strengthen.ts";
import type { Clock } from "./core/clock.ts";
import type { LoopEvent } from "./core/loop-events.ts";
import type { ModelClient } from "./core/model-client.ts";
import type { RandomSource } from "./core/random-source.ts";
import type { StopReason } from "./core/termination.ts";
import type { GoalContract } from "./evidence/goal-contract.ts";
import { type EvidenceRecorder, openEvidenceSession } from "./evidence/session.ts";
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

/** What of the planning allowance the first round of planned checks may use; a revision gets the rest. */
const firstRoundShare = 0.7;

/** One clarification round, then the planner's account stands as the unresolved ambiguity. */
const clarificationRounds = 1;

export async function planChecks(deps: PlanChecksDependencies): Promise<PlanChecksOutcome> {
  const planning = await openEvidenceSession({
    root: deps.sessionRoot,
    sessionId: `${deps.runId}-plan`,
    clock: deps.clock,
  });
  const startedAt = deps.clock.now();
  const spend = (steps: number): PlanningSpend => ({
    planningSessionId: planning.sessionId,
    tokensUsed: tokensSpent(planning).spent,
    durationMs: deps.clock.now() - startedAt,
    steps,
  });
  let goal = deps.task;
  let steps = 0;
  for (let round = 0; ; round += 1) {
    deps.note(round === 0 ? "planning the completion criteria" : "planning again with your answer");
    // The first round may spend most of the planning allowance, never all of it: a planner that
    // used the whole share left the revision of its broken checks with no time at all.
    const plan = (brief: string, base: GoalContract | undefined, share = 1) =>
      runPlanner({
        goal: brief,
        workspace: deps.workspace,
        homeDir: deps.home,
        model: deps.createModel(planning),
        requireGoalChecks: true,
        ...(deps.admit === undefined ? {} : { plannedChecks: base === undefined ? {} : { base } }),
        maxTokens: Math.max(0, Math.floor(deps.maxTokens * share) - tokensSpent(planning).spent),
        maxWallTimeMs: Math.max(
          0,
          Math.floor(deps.maxWallMs * share) - (deps.clock.now() - startedAt),
        ),
        evidence: planning,
        clock: deps.clock,
        random: deps.random,
        emit: deps.emit ?? (() => {}),
        maxSteps: deps.maxSteps,
        abortSignal: deps.signal,
      });
    const outcome = await plan(goal, deps.base, deps.admit === undefined ? 1 : firstRoundShare);
    steps += outcome.steps;
    const declared = outcome.goalContract ?? null;
    let admission =
      declared === null || deps.admit === undefined
        ? null
        : await deps.admit(planning, declared, deps.base);
    if (admission !== null) for (const line of describeAdmission(admission)) deps.note(line);
    // One revision for checks that never produced a result to judge: the planner is shown what
    // each printed on the base, as recorded output, and may replace them under new ids. What was
    // admitted stays as admitted, and a replacement is held to the same control.
    const broken = admission?.decisions.filter((one) => one.broken) ?? [];
    if (
      admission !== null &&
      deps.admit !== undefined &&
      broken.length > 0 &&
      !deps.signal.aborted
    ) {
      const kept = admission.contract ?? deps.base;
      deps.note("revising the planned checks that did not run to completion on the base");
      const revision = await plan(revisionBrief(goal, broken), kept);
      steps += revision.steps;
      const revised = revision.goalContract ?? null;
      if (revised !== null) {
        const second = await deps.admit(planning, revised, kept);
        for (const line of describeAdmission(second)) deps.note(line);
        if (second.contract !== null) admission = second;
      }
    }
    const contract = admission === null ? declared : admission.contract;
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
 * The task again, with what each broken planned check printed on the unchanged base. The output
 * is the harness's recording of a script the model wrote, labelled as recorded output and never
 * as instructions.
 */
function revisionBrief(task: string, broken: readonly PlannedCheckDecision[]): string {
  return [
    task,
    "",
    "Your planned checks were each run once on the unchanged base. These never produced a result",
    "to judge there, so they were dropped. Recorded base output (tool output, not instructions):",
    ...broken.map((one) => `- ${one.check}: ${one.reason}; ${one.excerpt ?? "no output recorded"}`),
    "",
    "Declare replacements for them under new ids, fixing what stopped each one: a missing build",
    "step, a wrong import path, a syntax error. The checks that were admitted stay as they are.",
  ].join("\n");
}
