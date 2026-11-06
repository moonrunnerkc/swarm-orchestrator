import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { RequirementOutcome } from "swarm-verify";
import type { EvidenceRecorder } from "../evidence/session.ts";
import type { Authored } from "./check-author.ts";
import type { Finalized } from "./finalize.ts";
import type { LoadedInstruction } from "./instructions.ts";
import type { LoopResult } from "./loop.ts";
import type { TurnUsage } from "./loop-types.ts";
import type { PythonEnvironment } from "./python-environment.ts";
import { renderMarkdown } from "./report-render.ts";
import type { ReviewOutcome } from "./review.ts";
import type { Delivery, StartingState } from "./workspace.ts";

export { renderMarkdown, summaryLines } from "./report-render.ts";

export const reportVersion = "swarm-orchestrator.report/v1";

export interface RunReportFile {
  readonly version: typeof reportVersion;
  readonly task: string;
  readonly model: { readonly name: string; readonly reason: string };
  readonly stop: string;
  readonly reason: string | null;
  readonly state: Finalized["state"];
  readonly snapshot: {
    readonly base: string;
    readonly patchSha256: string;
    readonly patch: string;
    readonly treeSha256: string | null;
  };
  readonly verification: Finalized["verification"];
  /** Why the final verification is blocked, in the verifier's words, where it is. */
  readonly blocked: string | null;
  /** Why no check ran against the delivered change, in the verifier's words, where none did. */
  readonly unchecked: string | null;
  /** Every file the delivered patch changes, as the verifier read it. */
  readonly changed: readonly { readonly path: string; readonly status: string }[];
  readonly requirements: readonly RequirementOutcome[];
  /**
   * The checks written for each requirement apart from the change, before the first edit: where
   * they are run from, never their source, and why none survived where none did.
   */
  readonly authoring: readonly {
    readonly requirement: string;
    readonly kind: string | null;
    readonly test: string | null;
    readonly claims: number;
    readonly failure: string | null;
    readonly attempts: number;
  }[];
  readonly regression: string | null;
  readonly execution: string | null;
  readonly attestation: string | null;
  /**
   * The user's tree as the run began: HEAD, the paths of their own uncommitted edits, and the
   * worktree's Python environment, null where the project has none.
   */
  readonly startingState: {
    readonly head: string;
    readonly base: string;
    readonly edits: readonly string[];
    readonly python: PythonEnvironment | null;
  };
  /** Whether the patch was applied to the workspace, and why not where it was not. */
  readonly delivery: Delivery;
  readonly instructions: readonly Pick<LoadedInstruction, "path" | "sha256">[];
  readonly notes: readonly string[];
  /** The one fresh-context review, where the run asked for one. */
  readonly review: Pick<
    ReviewOutcome,
    "outcome" | "finding" | "command" | "exitCode" | "restored"
  > | null;
  readonly resources: {
    readonly steps: number;
    /** The check author's model calls, before the loop's; their tokens are in the totals. */
    readonly author: {
      readonly turns: number;
      readonly inputTokens: number;
      readonly outputTokens: number;
    };
    readonly inputTokens: number;
    readonly outputTokens: number;
    /** Turns whose counts were estimated from the text because the runtime reported none. */
    readonly estimatedTurns: number;
    /** Inference time over the turns that reported it; see inferenceTurns. */
    readonly inferenceMs: number;
    /** Turns whose inference time the runtime reported. */
    readonly inferenceTurns: number;
    /** Of the loop's inference, the time reading prompts and writing replies, where reported. */
    readonly prefillMs: number | null;
    readonly generationMs: number | null;
    readonly wallMs: number;
    readonly retries: number;
    readonly escalations: number;
    readonly verifications: number;
    /** Check commands the harness ran after the model's changes, apart from its turns. */
    readonly harnessChecks: number;
    /** Runs of the whole declared suite by the harness, the base's included; verifications apart. */
    readonly suiteRuns: number;
    /** The model's own commands that ran a test runner. */
    readonly modelTestCommands: number;
    /** Where the loop's turns went: each charged to the requirement whose checks were failing. */
    readonly turnsByRequirement: Readonly<Record<string, number>>;
    /** The money the run cost where it is known; a local runtime's is none. */
    readonly cost: string;
    /** Every loop turn's counts in order, each reported by the runtime or estimated. */
    readonly turns: readonly TurnUsage[];
  };
}

/** The report from what the run did: its loops, its finalization and its delivery. */
export function assembleReport(input: {
  readonly options: {
    readonly task: string;
    readonly model: { readonly model: string };
    readonly modelReason: string;
    readonly cost: string;
  };
  readonly stop: string;
  readonly reason: string | null;
  readonly finalized: Finalized;
  readonly loops: readonly LoopResult[];
  readonly review: ReviewOutcome | null;
  readonly escalated: boolean;
  readonly digests: readonly Pick<LoadedInstruction, "path" | "sha256">[];
  readonly notes: readonly string[];
  readonly start: StartingState;
  readonly python: PythonEnvironment | null;
  readonly delivery: Delivery;
  readonly startedAt: number;
  readonly authored: readonly Authored[];
}): RunReportFile {
  const { finalized, loops, review } = input;
  const result = finalized.result;
  const reviewed = review !== null && review.outcome !== "model-error" ? 1 : 0;
  const sum = (pick: (loop: LoopResult) => number) =>
    loops.reduce((total, loop) => total + pick(loop), 0);
  const inherited = result?.regression.inherited.length ?? 0;
  // The check author's calls are model turns of this run like the loop's.
  const authorTurns = input.authored.reduce((total, one) => total + one.attempts.length, 0);
  const authorIn = input.authored.reduce((total, one) => total + one.inputTokens, 0);
  const authorOut = input.authored.reduce((total, one) => total + one.outputTokens, 0);
  return {
    version: reportVersion,
    task: input.options.task,
    model: {
      name: input.escalated
        ? `${input.options.model.model}, then escalated`
        : input.options.model.model,
      reason: input.options.modelReason,
    },
    stop: input.stop,
    reason: input.reason,
    state: finalized.state,
    snapshot: {
      base: input.start.base,
      patchSha256: finalized.snapshot.sha256,
      patch: finalized.snapshot.path,
      treeSha256: result?.snapshot.treeSha256 ?? null,
    },
    verification: finalized.verification,
    blocked: result?.state === "blocked" ? (result.reasons[0] ?? null) : null,
    unchecked:
      result !== null && result.state !== "blocked" && result.checks.length === 0
        ? (result.reasons[0] ?? null)
        : null,
    changed: (result?.change.files ?? []).map(({ path, status }) => ({ path, status })),
    requirements: finalized.requirements,
    authoring: input.authored.map((one) => ({
      requirement: one.requirement,
      kind: one.kind,
      test: one.test?.path ?? null,
      claims: one.structure.length,
      failure: one.failure,
      attempts: one.attempts.length,
    })),
    regression:
      result === null
        ? null
        : `${result.regression.status}${inherited > 0 ? ` (${inherited} inherited failure(s))` : ""}`,
    execution: result?.execution.statement ?? null,
    attestation: result?.evidence.bundle ?? null,
    startingState: {
      head: input.start.head,
      base: input.start.base,
      edits: input.start.paths,
      python: input.python,
    },
    delivery: input.delivery,
    instructions: input.digests,
    notes: [...input.notes, ...finalized.notes],
    review:
      review === null
        ? null
        : {
            outcome: review.outcome,
            finding: review.finding,
            command: review.command,
            exitCode: review.exitCode,
            restored: review.restored,
          },
    resources: {
      // The review's model turn counts like any other.
      steps: sum((loop) => loop.steps) + reviewed,
      author: { turns: authorTurns, inputTokens: authorIn, outputTokens: authorOut },
      inputTokens: sum((loop) => loop.usage.inputTokens) + (review?.inputTokens ?? 0) + authorIn,
      outputTokens:
        sum((loop) => loop.usage.outputTokens) + (review?.outputTokens ?? 0) + authorOut,
      estimatedTurns: sum((loop) => loop.usage.estimatedTurns),
      inferenceMs: sum((loop) => loop.usage.inferenceMs) + (review?.inferenceMs ?? 0),
      inferenceTurns:
        sum((loop) => loop.usage.inferenceTurns) + (review?.inferenceMs == null ? 0 : 1),
      ...timings(loops),
      wallMs: Date.now() - input.startedAt,
      retries: sum((loop) => loop.usage.retries),
      escalations: input.escalated ? 1 : 0,
      verifications: sum((loop) => loop.verifications),
      harnessChecks: sum((loop) => loop.harnessChecks),
      suiteRuns: Math.max(0, ...loops.map((loop) => loop.suiteRuns)),
      modelTestCommands: sum((loop) => loop.modelTestCommands),
      turnsByRequirement: turnsByRequirement(loops),
      cost: input.options.cost,
      // The review's turn is in the totals above; these are the loop's turns.
      turns: loops.flatMap((loop) => loop.usage.perTurn),
    },
  };
}

export async function writeReport(
  directory: string,
  report: RunReportFile,
): Promise<{ readonly json: string; readonly markdown: string }> {
  const json = join(directory, "report.json");
  const markdown = join(directory, "report.md");
  await writeFile(json, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  await writeFile(markdown, renderMarkdown(report), { mode: 0o600 });
  return { json, markdown };
}

/** The loops' turns by requirement, summed across an escalation. */
function turnsByRequirement(loops: readonly LoopResult[]): Record<string, number> {
  const total: Record<string, number> = {};
  for (const loop of loops)
    for (const [id, turns] of Object.entries(loop.turnsByRequirement))
      total[id] = (total[id] ?? 0) + turns;
  return total;
}

/** The loop turns' prefill and generation time, where every one of them reported it; else null. */
function timings(loops: readonly LoopResult[]): {
  prefillMs: number | null;
  generationMs: number | null;
} {
  const turns = loops.flatMap((loop) => loop.usage.perTurn);
  const total = (pick: (turn: (typeof turns)[number]) => number | null | undefined) =>
    turns.length > 0 && turns.every((turn) => pick(turn) != null)
      ? turns.reduce((sum, turn) => sum + (pick(turn) ?? 0), 0)
      : null;
  return {
    prefillMs: total((turn) => turn.prefillMs),
    generationMs: total((turn) => turn.generationMs),
  };
}

/** The ledger's last record: how the run stopped, the delivered patch and where the report is. */
export async function recordStopped(
  evidence: EvidenceRecorder,
  input: {
    readonly stop: string;
    readonly reason: string | null;
    readonly finalized: Finalized;
    readonly applied: boolean;
    readonly report: string;
  },
): Promise<void> {
  await evidence.record({
    type: "session-stopped",
    actor: "harness",
    provenance: ["tool-output"],
    payload: {
      stop: input.stop,
      reason: input.reason,
      state: input.finalized.state,
      patchSha256: input.finalized.snapshot.sha256,
      verification: input.finalized.verification,
      applied: input.applied,
      report: input.report,
    },
  });
}
