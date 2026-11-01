import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { RequirementOutcome } from "swarm-verify";
import type { Finalized } from "./finalize.ts";
import type { LoadedInstruction } from "./instructions.ts";
import type { LoopResult } from "./loop.ts";
import type { TurnUsage } from "./loop-types.ts";
import { describePythonEnvironment, type PythonEnvironment } from "./python-environment.ts";
import type { ReviewOutcome } from "./review.ts";
import type { Delivery, StartingState } from "./workspace.ts";

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
    readonly inputTokens: number;
    readonly outputTokens: number;
    /** Turns whose counts were estimated from the text because the runtime reported none. */
    readonly estimatedTurns: number;
    /** Inference time over the turns that reported it; see inferenceTurns. */
    readonly inferenceMs: number;
    /** Turns whose inference time the runtime reported. */
    readonly inferenceTurns: number;
    readonly wallMs: number;
    readonly retries: number;
    readonly escalations: number;
    readonly verifications: number;
    /** The money the run cost where it is known; a local runtime's is none. */
    readonly cost: string;
    /** Every loop turn's counts in order, each reported by the runtime or estimated. */
    readonly turns: readonly TurnUsage[];
  };
}

const pad = (text: string, width: number) => text.padEnd(width);

/** The terminal's closing summary: the state, each requirement, and where the rest is. */
export function summaryLines(
  report: RunReportFile,
  paths: { readonly markdown: string },
): string[] {
  const lines = [
    `${pad("state", 12)} ${report.state}`,
    `${pad("stop", 12)} ${report.stop}${report.reason === null ? "" : `: ${report.reason}`}`,
    ...(report.blocked === null ? [] : [`${pad("blocked", 12)} ${report.blocked}`]),
    ...(report.unchecked === null ? [] : [`${pad("not checked", 12)} ${report.unchecked}`]),
  ];
  const python = report.startingState.python;
  if (python?.state === "not-prepared")
    lines.push(`${pad("python env", 12)} not prepared: ${python.limitation}`);
  for (const one of report.requirements) {
    const why = one.limitation === null ? "" : `  ${one.limitation}`;
    lines.push(`${pad(one.id, 12)} ${pad(one.status, 11)}${why}`);
  }
  if (report.changed.length > 0) {
    const deleted = report.changed.filter((one) => one.status === "deleted").map((one) => one.path);
    const also = deleted.length === 0 ? "" : `, deleting ${deleted.join(", ")}`;
    lines.push(`${pad("changed", 12)} ${report.changed.length} file(s)${also}`);
  }
  if (report.regression !== null) lines.push(`${pad("regression", 12)} ${report.regression}`);
  if (report.execution !== null) lines.push(`${pad("execution", 12)} ${report.execution}`);
  lines.push(
    `${pad("patch", 12)} ${report.snapshot.patch} (sha256 ${report.snapshot.patchSha256})`,
  );
  const applied = report.delivery.applied ? "yes" : `no: ${report.delivery.reason}`;
  lines.push(`${pad("applied", 12)} ${applied}`);
  lines.push(`${pad("report", 12)} ${paths.markdown}`);
  return lines;
}

const cell = (text: string) => text.replaceAll("|", "\\|").replaceAll("\n", " ");

/** Inference time as measured: never a zero for turns whose runtime reported none. */
function inferenceOf(resources: RunReportFile["resources"]): string {
  if (resources.inferenceTurns === 0) return "inference time not reported by the runtime";
  const seconds = `${Math.round(resources.inferenceMs / 1000)} s of inference`;
  return resources.inferenceTurns < resources.steps
    ? `${seconds} over the ${resources.inferenceTurns} of ${resources.steps} turn(s) that reported it`
    : seconds;
}

/** What the review did, said as what was executed: a finding stands only on its own check. */
function reviewLine(review: NonNullable<RunReportFile["review"]>): string {
  const ran =
    review.command === null
      ? ""
      : ` (\`${review.command.split("\n")[0]}\` exited ${review.exitCode ?? "without running"}${review.restored ? "; it changed the tree, which was put back" : ""})`;
  switch (review.outcome) {
    case "confirmed":
      return `a finding its own check confirmed, which reopened the work: ${review.finding}${ran}`;
    case "refuted":
      return `a finding its own check refuted: ${review.finding}${ran}`;
    case "no-finding":
      return "no finding";
    case "unusable":
      return `no usable finding${ran}`;
    case "model-error":
      return `not done: ${review.finding}`;
  }
}

/** The patch's files, deletions last so they are not lost in the middle of the list. */
function changedLine(changed: RunReportFile["changed"]): string {
  const ordered = [
    ...changed.filter((one) => one.status !== "deleted"),
    ...changed.filter((one) => one.status === "deleted"),
  ];
  return ordered.map((one) => `${one.path} (${one.status})`).join("; ");
}

export function renderMarkdown(report: RunReportFile): string {
  return [
    `# swarm run: ${report.state}`,
    "",
    `Task: ${report.task}`,
    "",
    `Model: ${report.model.name} (${report.model.reason}). Stopped: ${report.stop}${report.reason === null ? "" : `, ${report.reason}`}.`,
    "",
    "| Requirement | Kind | Source | Status | Evidence | Limitation |",
    "| --- | --- | --- | --- | --- | --- |",
    ...report.requirements.map(
      (one) =>
        `| ${one.id}: ${cell(one.text)} | ${one.kind} | ${one.source} | ${one.status} | ${cell(one.evidence.map((ref) => `${ref.ref} (${ref.outcome}, ${ref.authority})`).join("; ") || "none")} | ${cell(one.limitation ?? "")} |`,
    ),
    "",
    `- Delivered patch: \`${report.snapshot.patch}\`, sha256 ${report.snapshot.patchSha256}, against base ${report.snapshot.base}.`,
    `- Verification of that patch: ${report.verification}.`,
    ...(report.changed.length === 0 ? [] : [`- Changed: ${changedLine(report.changed)}.`]),
    ...(report.blocked === null ? [] : [`- Blocked: ${report.blocked}.`]),
    ...(report.unchecked === null ? [] : [`- Not checked: ${report.unchecked}.`]),
    `- Starting state: HEAD ${report.startingState.head}${report.startingState.edits.length > 0 ? ` with your uncommitted edits to ${report.startingState.edits.join(", ")}` : ", no uncommitted edits"}.`,
    ...(report.startingState.python === null
      ? []
      : [`- Python environment: ${describePythonEnvironment(report.startingState.python)}.`]),
    `- Applied to the workspace: ${report.delivery.applied ? "yes" : `no, ${report.delivery.reason}`}.`,
    `- Regression: ${report.regression ?? "not measured"}.`,
    `- Execution: ${report.execution ?? "not measured"}.`,
    `- Attestation: ${report.attestation ?? "none"}.`,
    `- Instructions loaded: ${report.instructions.map((one) => `${one.path} (sha256 ${one.sha256})`).join(", ") || "none"}.`,
    `- Resources: ${report.resources.steps} model turn(s); ${report.resources.inputTokens} input and ${report.resources.outputTokens} output token(s)${report.resources.estimatedTurns > 0 ? ` (${report.resources.estimatedTurns} turn(s) estimated from text)` : " (reported by the runtime)"}; ${inferenceOf(report.resources)} and ${Math.round(report.resources.wallMs / 1000)} s of wall time; ${report.resources.retries} retried request(s); ${report.resources.escalations} escalation(s); ${report.resources.verifications} verification(s) in the loop; cost: ${report.resources.cost}.`,
    ...(report.review === null ? [] : [`- Review: ${reviewLine(report.review)}.`]),
    ...report.notes.map((note) => `- Note: ${note}`),
    "",
  ].join("\n");
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
}): RunReportFile {
  const { finalized, loops, review } = input;
  const result = finalized.result;
  const reviewed = review !== null && review.outcome !== "model-error" ? 1 : 0;
  const sum = (pick: (loop: LoopResult) => number) =>
    loops.reduce((total, loop) => total + pick(loop), 0);
  const inherited = result?.regression.inherited.length ?? 0;
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
      inputTokens: sum((loop) => loop.usage.inputTokens) + (review?.inputTokens ?? 0),
      outputTokens: sum((loop) => loop.usage.outputTokens) + (review?.outputTokens ?? 0),
      estimatedTurns: sum((loop) => loop.usage.estimatedTurns),
      inferenceMs: sum((loop) => loop.usage.inferenceMs) + (review?.inferenceMs ?? 0),
      inferenceTurns:
        sum((loop) => loop.usage.inferenceTurns) + (review?.inferenceMs == null ? 0 : 1),
      wallMs: Date.now() - input.startedAt,
      retries: sum((loop) => loop.usage.retries),
      escalations: input.escalated ? 1 : 0,
      verifications: sum((loop) => loop.verifications),
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
