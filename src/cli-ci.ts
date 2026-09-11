import { readFile, writeFile } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { eventsFromClaudeCodeStream, eventsFromGenericJsonl } from "./adapters/external-agent.ts";
import { describeOracleBond } from "./cli-bond-report.ts";
import type { CiCommand } from "./cli-options.ts";
import { createSystemClock, createSystemRandom } from "./cli-runtime-inputs.ts";
import type { Clock } from "./core/clock.ts";
import { bundleSourceFromRecorder, exportBundle } from "./evidence/bundle.ts";
import { createSessionId, defaultSessionRoot, openEvidenceSession } from "./evidence/session.ts";
import { createKeychainSecretStore, resolveSigningKey } from "./evidence/signing.ts";
import { harnessChildEnvironment } from "./exec/child-environment.ts";
import { type ExecutionMode, selfTestContainment } from "./exec/execution-mode.ts";
import { parseIsolationOption } from "./exec/isolation-option.ts";
import { createRunCancellation } from "./exec/run-cancellation.ts";
import { recordedContainerBackend } from "./exec/runtime-resource.ts";
import { acceptancePackageExecutor } from "./gates/acceptance-package.ts";
import { resolveBaseCommit } from "./gates/git-workspace.ts";
import { verifyIndependently } from "./gates/independent-verification.ts";
import { createNodeCommandRunner } from "./gates/node-command-runner.ts";
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
    return await verifyPatchUnderCancellation(options, clock, stopping.signal);
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
): Promise<number> {
  const baseCommit = await resolveBaseCommit(options.workspace, options.baseRef);
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
  const evidence = await openEvidenceSession({
    root: defaultSessionRoot(homedir()),
    sessionId: createSessionId(clock, createSystemRandom()),
    clock,
  });
  const isolation = parseIsolationOption(options.isolation ?? null, options.workspace);
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
    return createNodeCommandRunner(clock, harnessChildEnvironment(), backend, stopping);
  };
  const patch = await readFile(options.patchFile, "utf8");
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
  let bundleDirectory = options.bundleDirectory ?? join(evidence.directory, "bundle");
  let result: Awaited<ReturnType<typeof verifyIndependently>>;
  try {
    result = await verifyIndependently({
      repositoryRoot: options.workspace,
      checkoutRoot: evidence.directory,
      baseCommit,
      patch,
      ...(acceptance === undefined ? {} : { acceptance }),
      commandsForCheckout: commands,
      immutablePaths: options.immutablePaths,
      installDependencies: options.installDependencies,
      ...(options.oracleOnly ? { repositoryChecks: "skip" as const } : {}),
      ...(options.taskOracle === null ? {} : { taskOracle: { command: options.taskOracle } }),
      commands: preparationCommands,
      clock,
    });

    await evidence.record({
      type: "independent-verification",
      actor: "harness",
      provenance: ["tool-output"],
      payload: JSON.parse(JSON.stringify({ ...result, executionTrust })),
    });
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
    const signing = await resolveSigningKey(createKeychainSecretStore({ platform: platform() }));
    if (signing.notice !== null) process.stderr.write(`[signing] ${signing.notice}\n`);
    const bundle = await exportBundle({
      source: bundleSourceFromRecorder(evidence),
      destination: bundleDirectory,
      signingKey: signing.key,
      clock,
    });
    bundleDirectory = bundle.directory;
    process.stderr.write(`verification evidence: ${bundleDirectory}\n`);
  }

  if (options.json) {
    process.stdout.write(
      `${JSON.stringify({ schema: "swarm.ci.v1", baseCommit, executionTrust, bundleDirectory, ...result })}\n`,
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
      `oracle reach: ${result.oracleReach}${describeUnreached(result.unreachedByOracle)}\n` +
      `oracle bond: ${result.oracleBond}${describeOracleBond(result)}\n` +
      (result.verified
        ? result.acceptance === undefined
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

function readAgentStream(text: string, format: "generic" | "claude-code") {
  return format === "claude-code" ? eventsFromClaudeCodeStream(text) : eventsFromGenericJsonl(text);
}
