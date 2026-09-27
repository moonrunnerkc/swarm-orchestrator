import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { measureWorkspace, type WorkspaceMeasurement } from "./cli-gates.ts";
import { createSystemClock } from "./cli-runtime-inputs.ts";
import type { CheckCommand } from "./cli-verify-options.ts";
import { asJsonValue } from "./evidence/canonical-json.ts";
import { scrubText } from "./evidence/scrub.ts";
import type { EvidenceRecorder } from "./evidence/session.ts";
import { createRunCancellation } from "./exec/run-cancellation.ts";
import { type CheckPlan, planCheck } from "./gates/check-plan.ts";
import { requireBaseCommit } from "./gates/git-workspace.ts";
import { exitCodes } from "./machine-output.ts";

/**
 * The first-run command: no subcommand, no configuration, no model. It reads what the project
 * declares, says what it is about to run and what that can vouch for, runs it the way a CI job
 * would, and reports five conclusions separately: whether the command ran, what the checks
 * found, how the execution was contained, whether any requirement was judged, and whether any
 * check was challenged. A pass here is a regression-only pass and is printed as one. Nothing
 * writes to the workspace; the evidence goes to the session store and its bundle.
 */
export const checkSchemaName = "swarm.check.v1";

export type CheckResult = "pass" | "fail" | "incomplete" | "cancelled" | "preview";

export interface CheckConclusions {
  readonly command: {
    readonly status: "ran" | "not-run";
    readonly detail: string;
  };
  readonly checks: readonly {
    readonly id: string;
    readonly status: "passed" | "failed" | "not-applicable";
    readonly severity: "blocking" | "advisory";
    readonly detail: string;
    readonly measures: Readonly<Record<string, number>>;
    /** The last lines the command printed, for a check that failed; absent otherwise. */
    readonly output?: string;
  }[];
  readonly executionTrust: {
    readonly mode: string;
    readonly detail: string;
  };
  readonly requirements: { readonly status: "unmeasured"; readonly detail: string };
  readonly challenges: { readonly status: "none"; readonly detail: string };
}

export interface CheckReport {
  readonly schema: typeof checkSchemaName;
  readonly plan: CheckPlan;
  readonly tree: { readonly commit: string; readonly dirty: boolean } | null;
  readonly conclusions: CheckConclusions | null;
  readonly result: CheckResult;
  readonly exitCode: number;
  readonly bundleDirectory: string | null;
}

function writeOut(line: string): void {
  process.stdout.write(`${line}\n`);
}

/** Check a workspace with nothing configured. */
export async function check(options: CheckCommand): Promise<number> {
  const stopping = createRunCancellation({ clock: createSystemClock(), wallBudgetMs: null });
  const interrupt = () => stopping.cancel("interrupted");
  const terminate = () => stopping.cancel("terminated");
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", terminate);
  try {
    return await checkUnderCancellation(options, stopping.signal);
  } finally {
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", terminate);
    stopping.dispose();
  }
}

async function checkUnderCancellation(options: CheckCommand, signal: AbortSignal): Promise<number> {
  const emit = (report: CheckReport): number => {
    if (options.json) {
      process.stdout.write(`${scrubText(JSON.stringify(report)).value}\n`);
    } else {
      for (const line of renderReport(report)) writeOut(line);
    }
    return report.exitCode;
  };

  const plan = await planCheck({
    workspace: options.workspace,
    ...(options.packages === undefined ? {} : { packages: options.packages }),
  });

  let tree: CheckReport["tree"] = null;
  try {
    const commit = await requireBaseCommit(options.workspace, options.baseRef);
    tree = { commit, dirty: await workingTreeIsDirty(options.workspace) };
  } catch {
    tree = null;
  }

  if (options.explain) {
    return emit({
      schema: checkSchemaName,
      plan,
      tree,
      conclusions: null,
      result: "preview",
      exitCode: exitCodes.acceptable,
      bundleDirectory: null,
    });
  }

  const blocked = incompleteReason(plan, tree);
  if (blocked !== null) {
    return emit({
      schema: checkSchemaName,
      plan,
      tree,
      conclusions: {
        command: { status: "not-run", detail: blocked },
        checks: [],
        executionTrust: { mode: "not-run", detail: "nothing executed" },
        requirements: requirementsConclusion(),
        challenges: challengesConclusion(),
      },
      result: "incomplete",
      exitCode: exitCodes.unavailable,
      bundleDirectory: null,
    });
  }

  const notes: string[] = [];
  const measured = await measureWorkspace(
    {
      workspace: options.workspace,
      baseRef: options.baseRef,
      packages: options.packages,
      bundleDirectory: options.bundleDirectory,
      allowedFiles: null,
      task: "check",
      beforeSealing: (evidence) => recordPlan(evidence, plan),
      note: (line) => notes.push(line),
    },
    signal,
  );
  const report = reportOf(plan, tree, measured, signal.aborted);
  const code = emit(report);
  if (!options.json) for (const line of notes) writeOut(line);
  return code;
}

async function recordPlan(evidence: EvidenceRecorder, plan: CheckPlan): Promise<void> {
  await evidence.record({
    type: "verification-command",
    actor: "harness",
    provenance: ["file"],
    payload: asJsonValue({ rule: "check-plan-v1", plan }),
  });
}

const runGit = promisify(execFile);

async function workingTreeIsDirty(workspace: string): Promise<boolean> {
  const status = await runGit("git", ["status", "--porcelain", "--untracked-files=normal"], {
    cwd: workspace,
    maxBuffer: 16_000_000,
  });
  return status.stdout.trim().length > 0;
}

/** Why nothing should run yet, or null where the plan is complete enough to execute. */
export function incompleteReason(plan: CheckPlan, tree: CheckReport["tree"]): string | null {
  if (tree === null)
    return "the workspace is not a git repository with a commit to measure against. Run `git init` and commit, or point --workspace at a repository";
  if (plan.scope.kind === "no-manifest") return plan.scope.detail;
  if (plan.scope.kind === "ambiguous") return plan.scope.detail;
  if (plan.prerequisites.length > 0)
    return plan.prerequisites.map((one) => `${one.what}: ${one.remedy}`).join("; ");
  if (plan.tests.interactive !== null)
    return `${plan.tests.interactive}. Declare a script that runs once, or select a package whose script does`;
  const tests = plan.declaredChecks.find((one) => one.id.startsWith("tests"));
  if (
    tests !== undefined &&
    tests.unavailable !== null &&
    plan.declaredChecks.every((one) => one.command === null)
  )
    return `${tests.unavailable}. Declare a test script, then run again`;
  return null;
}

function requirementsConclusion(): CheckConclusions["requirements"] {
  return {
    status: "unmeasured",
    detail:
      "no requirement contract was supplied, so task correctness was not judged. A passing suite says nothing broke, not that the work was done",
  };
}

function challengesConclusion(): CheckConclusions["challenges"] {
  return {
    status: "none",
    detail:
      "no check was challenged: challenges need a requirement contract to name what a check must detect",
  };
}

function reportOf(
  plan: CheckPlan,
  tree: CheckReport["tree"],
  measured: WorkspaceMeasurement,
  cancelled: boolean,
): CheckReport {
  const cycle = measured.run.outcome.firstCycle;
  const tests = cycle.runs.find((run) => run.gateId.startsWith("tests"));
  const checks = cycle.runs.map((run) => ({
    id: run.gateId,
    status: run.status,
    severity: run.severity,
    detail: run.detail,
    measures: run.measures,
    // "the command exited 1" tells a reader nothing about why; the tail of what the command
    // printed is what they would have read at a terminal. Bounded, and scrubbed with the rest.
    ...(run.status === "failed" && run.kind === "command"
      ? { output: lastLines(`${run.observation.stdout}\n${run.observation.stderr}`, 12, 1500) }
      : {}),
  }));
  const commandRan =
    tests !== undefined && tests.observation.unavailable === null && tests.kind === "command";
  const commandDetail =
    tests === undefined
      ? "no test command was assembled"
      : commandRan
        ? `${tests.observation.exitCode === 0 ? "exited 0" : `exited ${tests.observation.exitCode}`} in ${(tests.observation.durationMs / 1000).toFixed(1)}s: ${tests.detail}`
        : (tests.observation.unavailable ?? tests.detail);
  const executed = cycle.runs.some(
    (run) => run.capability === "dynamic" && run.status === "passed",
  );
  const blockingFailed = cycle.blockingFailures.length > 0;
  const result: CheckResult = cancelled
    ? "cancelled"
    : blockingFailed
      ? "fail"
      : measured.verdict.acceptable && executed
        ? "pass"
        : "incomplete";
  const exitCode =
    result === "pass"
      ? exitCodes.acceptable
      : result === "fail"
        ? exitCodes.notAcceptable
        : result === "cancelled"
          ? exitCodes.cancelled
          : exitCodes.unavailable;
  return {
    schema: checkSchemaName,
    plan,
    tree,
    conclusions: {
      command: { status: commandRan ? "ran" : "not-run", detail: commandDetail },
      checks,
      executionTrust: {
        mode: measured.verdict.executionTrust,
        detail: executionTrustDetail(measured.verdict.executionTrust),
      },
      requirements: requirementsConclusion(),
      challenges: challengesConclusion(),
    },
    result,
    exitCode,
    bundleDirectory: measured.bundleDirectory,
  };
}

/** The last non-empty lines of what a command printed, bounded in lines and in characters. */
function lastLines(text: string, lines: number, characters: number): string {
  const kept = text
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)
    .slice(-lines)
    .join("\n");
  return kept.length > characters ? kept.slice(-characters) : kept;
}

function executionTrustDetail(mode: string): string {
  if (mode === "isolated") return "commands ran behind a measured kernel boundary";
  if (mode === "restricted")
    return "commands ran on this host with a built environment and no credentials; that is a policy, not a sandbox, and the project's tests ran the project's code";
  if (mode === "unsafe") return "commands ran on this host with no restriction measured";
  return "the containment self-test could not measure how commands were contained";
}

/** The human rendering: one line per conclusion, the widest word first. */
export function renderReport(report: CheckReport): readonly string[] {
  const lines: string[] = [];
  const plan = report.plan;
  const treeText =
    report.tree === null
      ? "not a git repository"
      : `${report.tree.commit.slice(0, 12)}${report.tree.dirty ? ", working tree has uncommitted changes" : ", clean"}`;
  lines.push(`workspace    ${plan.workspace} (${treeText})`);
  lines.push(
    `project      ${plan.project.types.length === 0 ? "no manifest" : plan.project.types.join(" + ")}` +
      `${plan.project.nodeManager === null ? "" : `, ${plan.project.nodeManager}`}` +
      `${plan.project.lockfiles.length === 0 ? "" : `, ${plan.project.lockfiles.join(" and ")}`}` +
      `${plan.packages.length === 0 ? "" : `, ${plan.packages.length} workspace package(s)`}`,
  );
  lines.push(`scope        ${plan.scope.kind}: ${plan.scope.detail}`);
  const declared = plan.declaredChecks.find((one) => one.id.startsWith("tests"));
  lines.push(
    `command      ${declared?.command ?? "none declared"}` +
      `${plan.tests.body === null ? "" : ` [${plan.tests.body}]`}` +
      ` (${plan.tests.runner}; ${plan.tests.noninteractiveBy.join(", ")})`,
  );
  if (report.result === "preview") {
    for (const one of plan.declaredChecks.filter(
      (one) => one.command !== null && !one.id.startsWith("tests"),
    ))
      lines.push(`             also ${one.id}: ${one.command}`);
    for (const one of plan.prerequisites) lines.push(`missing      ${one.what}. ${one.remedy}`);
    for (const one of plan.unmeasured) lines.push(`unmeasured   ${one.area}: ${one.reason}`);
    lines.push("result       preview only; nothing ran (exit 0)");
    return lines;
  }
  const conclusions = report.conclusions;
  if (conclusions === null) return lines;
  lines.push(
    `             ${conclusions.command.status === "ran" ? "ran" : "not run"}: ${conclusions.command.detail}`,
  );
  const passed = conclusions.checks.filter((one) => one.status === "passed");
  const failed = conclusions.checks.filter((one) => one.status === "failed");
  const notRun = conclusions.checks.filter((one) => one.status === "not-applicable");
  lines.push(
    `checks       passed ${passed.length} (${passed.map((one) => one.id).join(", ") || "none"}), ` +
      `failed ${failed.length}${failed.length === 0 ? "" : ` (${failed.map((one) => one.id).join(", ")})`}, ` +
      `not run ${notRun.length}${notRun.length === 0 ? "" : ` (${notRun.map((one) => one.id).join(", ")})`}`,
  );
  for (const one of failed) {
    lines.push(`             ${one.id}: ${one.detail}`);
    for (const printed of (one.output ?? "").split("\n").filter((line) => line.length > 0))
      lines.push(`               | ${printed}`);
  }
  for (const one of notRun) lines.push(`             ${one.id}: ${one.detail}`);
  lines.push(
    `execution    ${conclusions.executionTrust.mode}: ${conclusions.executionTrust.detail}`,
  );
  lines.push(`requirements ${conclusions.requirements.status}: ${conclusions.requirements.detail}`);
  lines.push(`challenges   ${conclusions.challenges.status}: ${conclusions.challenges.detail}`);
  // The checks the run reported as not run are already above; what is left to say is what no
  // gate could have said, such as the packages a root script does not vouch for.
  const reported = new Set(conclusions.checks.map((one) => one.id));
  for (const one of plan.unmeasured.filter(
    (one) => one.area !== "task correctness" && !reported.has(one.area),
  ))
    lines.push(`unmeasured   ${one.area}: ${one.reason}`);
  lines.push(`result       ${describeResult(report)} (exit ${report.exitCode})`);
  if (report.bundleDirectory !== null) {
    lines.push(`evidence     ${report.bundleDirectory}`);
    lines.push(
      `             verify it anywhere: node ${join(report.bundleDirectory, "verify.mjs")} ${report.bundleDirectory}`,
    );
  }
  return lines;
}

function describeResult(report: CheckReport): string {
  switch (report.result) {
    case "pass":
      return "regression-only pass: the declared checks passed on this tree; task correctness is unmeasured";
    case "fail":
      return "fail: a blocking check failed";
    case "cancelled":
      return "cancelled before the assessment completed";
    case "incomplete":
      return `incomplete: ${report.conclusions?.command.detail ?? "the assessment could not be completed"}`;
    case "preview":
      return "preview";
  }
}

/** Read a report a previous run wrote, for a client that only has the bundle. */
export async function readCheckReport(path: string): Promise<CheckReport> {
  return JSON.parse(await readFile(path, "utf8")) as CheckReport;
}
