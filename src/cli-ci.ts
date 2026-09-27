import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { eventsFromClaudeCodeStream, eventsFromGenericJsonl } from "./adapters/external-agent.ts";
import { describeOracleBond } from "./cli-bond-report.ts";
import { createSystemClock } from "./cli-runtime-inputs.ts";
import { withVerificationEvidence } from "./cli-verification-evidence.ts";
import type { CiCommand } from "./cli-verify-options.ts";
import type { Clock } from "./core/clock.ts";
import { renderCiSummary } from "./evidence/ci-summary.ts";
import { declareGoalContract } from "./evidence/goal-contract.ts";
import { scrubText } from "./evidence/scrub.ts";
import type { EvidenceRecorder } from "./evidence/session.ts";
import { harnessChildEnvironment } from "./exec/child-environment.ts";
import { type ExecutionMode, selfTestContainment } from "./exec/execution-mode.ts";
import { parseIsolationOption } from "./exec/isolation-option.ts";
import { createRunCancellation } from "./exec/run-cancellation.ts";
import { recordedContainerBackend } from "./exec/runtime-resource.ts";
import { acceptancePackageExecutor } from "./gates/acceptance-package.ts";
import { resolveChangeSource } from "./gates/change-source.ts";
import { resolveGithubPullRequest } from "./gates/github-source.ts";
import { verifyIndependently } from "./gates/independent-verification.ts";
import { createNodeCommandRunner } from "./gates/node-command-runner.ts";
import { pathsInPatch } from "./gates/patch-paths.ts";
import { exitCodes } from "./machine-output.ts";
export async function verifyPatch(options: CiCommand): Promise<number> {
  const clock = createSystemClock();
  // Verification spawns test runners in a checkout, and this command had nothing that stopped
  // them when it was stopped itself. A Ctrl-C or a supervisor's SIGTERM ended the CLI and left
  // the runner reparented and running: two node processes from an oracle were still holding a
  // checkout open five hours after the run that started them had gone.
  const stopping = createRunCancellation({ clock, wallBudgetMs: null });
  const onInterrupt = () => stopping.cancel("interrupted");
  const onTerminate = () => stopping.cancel("terminated");
  process.on("SIGINT", onInterrupt);
  process.on("SIGTERM", onTerminate);
  try {
    return await withVerificationEvidence(
      clock,
      options.bundleDirectory,
      (evidence, bundleDirectory, exportEvidence) =>
        verifyPatchUnderCancellation(
          options,
          clock,
          stopping.signal,
          evidence,
          bundleDirectory,
          exportEvidence,
        ),
    );
  } finally {
    process.off("SIGINT", onInterrupt);
    process.off("SIGTERM", onTerminate);
    stopping.dispose();
  }
}

async function verifyPatchUnderCancellation(
  options: CiCommand,
  clock: Clock,
  stopping: AbortSignal,
  evidence: EvidenceRecorder,
  bundleDirectory: string,
  exportEvidence: () => Promise<void>,
): Promise<number> {
  // What the producer said it did, where it said anything. Read strictly: a line this build
  // does not recognize refuses the whole stream rather than being skipped, because a skipped
  // line is evidence that quietly went unread.
  const replayed =
    options.agentStream === null
      ? []
      : readAgentStream(
          await readFile(options.agentStream.path, "utf8"),
          options.agentStream.format,
        );
  if (replayed.length > 0) {
    process.stderr.write(`agent stream: ${replayed.length} event(s) read\n`);
  }
  const isolation = parseIsolationOption(options.isolation ?? null, options.workspace);
  if (options.requireIsolation && isolation === null)
    throw new Error("required isolation needs --isolation docker (or another supported runtime)");
  let executionTrust: ExecutionMode = isolation === null ? "restricted" : "unknown";
  let measuredEnvelope = false;
  const preparationCommands = createNodeCommandRunner(
    clock,
    harnessChildEnvironment(),
    undefined,
    stopping,
  );
  const commands = async (checkout: string) => {
    if (isolation === null) return preparationCommands;
    const backend = recordedContainerBackend({ ...isolation, workspaceRoot: checkout }, evidence);
    const canary = join(evidence.directory, "containment-canary");
    await writeFile(canary, "synthetic containment control");
    const envelope = await selfTestContainment(backend, {
      workspaceRoot: checkout,
      hostFileOutsideWorkspace: canary,
    });
    executionTrust = !measuredEnvelope
      ? envelope.mode
      : executionTrust === "restricted" || envelope.mode === "restricted"
        ? "restricted"
        : executionTrust === "unknown" || envelope.mode === "unknown"
          ? "unknown"
          : "isolated";
    measuredEnvelope = true;
    await evidence.record({
      type: "execution-envelope",
      actor: "harness",
      provenance: ["tool-output"],
      payload: JSON.parse(JSON.stringify(envelope)),
    });
    if (options.requireIsolation && envelope.mode !== "isolated")
      throw new Error(
        `required isolation unavailable: measured ${envelope.mode}; provide a backend that passes containment probes`,
      );
    return createNodeCommandRunner(clock, harnessChildEnvironment(), backend, stopping);
  };
  const { patch, identity: sourceIdentity } = await resolveChangeSource(
    options,
    preparationCommands,
    resolveGithubPullRequest,
  );
  const baseCommit = sourceIdentity.comparisonBase;
  await evidence.record({
    type: "verification-command",
    actor: "harness",
    provenance: ["tool-output"],
    payload: JSON.parse(JSON.stringify(sourceIdentity)),
  });
  const goalContract =
    options.goalContract === undefined
      ? undefined
      : await declareGoalContract(
          evidence,
          JSON.parse(await readFile(options.goalContract, "utf8")),
        );
  const acceptance =
    options.acceptanceContract === undefined
      ? undefined
      : await acceptancePackageExecutor(options.acceptanceContract, {
          repositoryRoot: options.workspace,
          baseCommit,
          candidatePatch: patch,
          evidence,
          preparationCommands,
          commands,
          timeoutMs: 120_000,
        });
  await evidence.record({
    type: "session-started",
    actor: "harness",
    provenance: ["user"],
    payload: { task: "independent verification", baseCommit, repository: options.workspace },
  });
  const changedPaths = pathsInPatch(patch);
  let assessmentDigest = "";
  let result: Awaited<ReturnType<typeof verifyIndependently>>;
  try {
    result = await verifyIndependently({
      repositoryRoot: options.workspace,
      checkoutRoot: evidence.directory,
      baseCommit,
      patch,
      ...(options.packages === undefined ? {} : { gateOptions: { packages: options.packages } }),
      ...(acceptance === undefined ? {} : { acceptance }),
      ...(goalContract === undefined
        ? {}
        : { goal: { contract: goalContract, evidence, tree: "" } }),
      commandsForCheckout: commands,
      immutablePaths: options.immutablePaths,
      installDependencies: options.installDependencies,
      ...(options.oracleOnly ? { repositoryChecks: "skip" as const } : {}),
      ...(options.taskOracle === null ? {} : { taskOracle: { command: options.taskOracle } }),
      commands: preparationCommands,
      clock,
    });

    const assessment = await evidence.record({
      type: "independent-verification",
      actor: "harness",
      provenance: ["tool-output"],
      payload: JSON.parse(
        JSON.stringify({ ...result, executionTrust, sourceIdentity, changedPaths }),
      ),
    });
    assessmentDigest = assessment.record.payloadDigest;
  } catch (cause) {
    await evidence.record({
      type: "session-stopped",
      actor: "harness",
      provenance: ["tool-output"],
      payload: {
        stopReason: stopping.aborted ? "interrupted" : "verification-error",
        detail: cause instanceof Error ? cause.message : String(cause),
      },
    });
    throw cause;
  } finally {
    await exportEvidence();
  }

  if (options.summaryFile !== undefined)
    await writeFile(
      options.summaryFile,
      renderCiSummary({
        result,
        source: sourceIdentity,
        executionTrust,
        bundleDirectory,
        assessmentDigest,
        changedPaths,
      }),
      { mode: 0o600 },
    );
  if (options.json) {
    process.stdout.write(
      `${scrubText(JSON.stringify({ schema: "swarm.ci.v1", changedPaths, assessmentDigest, sourceIdentity, baseCommit, executionTrust, bundleDirectory, ...result })).value}\n`,
    );
    return result.verified ? exitCodes.acceptable : exitCodes.notAcceptable;
  }

  process.stdout.write(`base: ${baseCommit}\n`);
  if (result.refusal !== null) {
    process.stdout.write(`refused: ${result.refusal}\n`);
    return exitCodes.notAcceptable;
  }
  if (!result.applied) {
    process.stdout.write(
      "the patch did not apply to a fresh checkout of the base, so nothing was measured. " +
        "That is not a failing check, it is no check at all.\n",
    );
    return exitCodes.notAcceptable;
  }
  if (result.install !== null) {
    process.stdout.write(
      `  install  ${result.install.succeeded ? "ok" : "failed"}: ${result.install.detail}\n`,
    );
  }
  for (const check of result.checks) {
    const label = check.status === "not-applicable" ? "n/a" : check.status;
    process.stdout.write(`  ${label.padEnd(8)} ${check.id}: ${check.detail}\n`);
  }
  if (result.unmeasured) {
    // Not the same finding as a refusal, and the difference is the whole point: a reader told
    // "not verified" over a checkout where nothing ran learns nothing about the patch.
    process.stdout.write(`\nnot measured: ${result.advice}\n`);
    return exitCodes.notAcceptable;
  }
  process.stdout.write(
    `\nregression: ${result.regression}   task: ${result.task}   ` +
      `oracle reach: ${result.oracleReach}${describeUnreached(result.unreachedByOracle)}` +
      `${describeSetAside(result.setAsideByReach)}\n` +
      `oracle bond: ${result.oracleBond}${describeOracleBond(result)}\n` +
      (result.verified
        ? result.acceptance === undefined && result.goalAcceptance === undefined
          ? "verified: no regression, and the oracle says the task was done.\n"
          : "verified: regression passed and every applicable required obligation was accepted.\n"
        : `not verified. ${result.advice}\n`),
  );
  return result.verified ? exitCodes.acceptable : exitCodes.notAcceptable;
}

/** Which added lines the oracle never ran, so "extend the oracle" names something to extend. */
function describeUnreached(
  unreached: readonly { readonly path: string; readonly lines: readonly number[] }[],
): string {
  if (unreached.length === 0) {
    return "";
  }
  const named = unreached
    .map(
      (file) =>
        `${file.path}: ${file.lines.slice(0, 8).join(", ")}${file.lines.length > 8 ? ", ..." : ""}`,
    )
    .join("; ");
  return ` (${named})`;
}

/** What reach did not judge and why, so `reached` never reads as wider than it was. */
function describeSetAside(
  setAside: readonly { readonly path: string; readonly reason: string }[] | undefined,
): string {
  if (setAside === undefined || setAside.length === 0) {
    return "";
  }
  const named = setAside.slice(0, 6).map((file) => `${file.path} (${file.reason})`);
  return `\n  reach set aside: ${named.join(", ")}${setAside.length > 6 ? ", ..." : ""}`;
}

function readAgentStream(text: string, format: "generic" | "claude-code") {
  return format === "claude-code" ? eventsFromClaudeCodeStream(text) : eventsFromGenericJsonl(text);
}
