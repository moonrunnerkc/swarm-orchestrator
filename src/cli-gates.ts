import { writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { announceBundle, writeBundle } from "./cli-bundle.ts";
import { describeCycle, reportBonds } from "./cli-run-report.ts";
import {
  diffBudgetFrom,
  gateOptionsFrom,
  noFlagSettings,
  settingsFor,
} from "./cli-run-settings.ts";
import { createSystemClock, createSystemRandom } from "./cli-runtime-inputs.ts";
import type { GatesCommand } from "./cli-verify-options.ts";
import { recordRunAssessment } from "./evidence/run-assessment.ts";
import {
  createSessionId,
  defaultSessionRoot,
  type EvidenceRecorder,
  openEvidenceSession,
} from "./evidence/session.ts";
import { describeVerdict, type RunVerdict } from "./evidence/verdict.ts";
import {
  type ContainmentSelfTest,
  hostExecutionBackend,
  selfTestContainment,
} from "./exec/execution-mode.ts";
import { parseIsolationOption } from "./exec/isolation-option.ts";
import { createRunCancellation } from "./exec/run-cancellation.ts";
import { recordedContainerBackend } from "./exec/runtime-resource.ts";
import {
  defaultDiffBudget,
  type GatesEngineRun,
  runGatesEngine,
  sealAssembledCriteria,
} from "./gates/engine.ts";
import { createFileSetRegistry } from "./gates/file-set.ts";
import { citedRecords, outstandingJustifications } from "./gates/gate-runner.ts";
import { resolveBaseCommit } from "./gates/git-workspace.ts";

function writeOut(line: string): void {
  process.stdout.write(`${line}\n`);
}

/** The gates on their own: no model, no retries, just what the workspace measures right now. */
export async function gates(options: GatesCommand): Promise<number> {
  const stopping = createRunCancellation({ clock: createSystemClock(), wallBudgetMs: null });
  const interrupt = () => stopping.cancel("interrupted");
  const terminate = () => stopping.cancel("terminated");
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", terminate);
  try {
    return await gatesUnderCancellation(options, stopping.signal);
  } finally {
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", terminate);
    stopping.dispose();
  }
}

/** What one measurement of a workspace produced, for a caller that renders it its own way. */
export interface WorkspaceMeasurement {
  readonly evidence: EvidenceRecorder;
  readonly baseRef: string;
  readonly envelope: ContainmentSelfTest;
  readonly run: GatesEngineRun;
  readonly verdict: RunVerdict;
  readonly bundleDirectory: string;
}

export interface WorkspaceMeasurementOptions {
  readonly workspace: string;
  readonly baseRef: string;
  readonly isolation?: string | null | undefined;
  readonly packages?: readonly string[] | undefined;
  readonly bundleDirectory: string | null;
  readonly allowedFiles: readonly string[] | null;
  /** What the session records as the task it was asked to do. */
  readonly task: string;
  /** Recorded on the chain before the criteria are sealed, where the caller planned first. */
  readonly beforeSealing?: (evidence: EvidenceRecorder) => Promise<void>;
  readonly note: (line: string) => void;
  /** Untracked Python virtual environments the caller named and left out of the change. */
  readonly excludedEnvironments?: readonly string[];
}

/**
 * Seal the criteria, run every gate once, bond each pass, assess, and export. Shared by
 * `gates` and `check`, which differ only in what they print and what they say beforehand.
 */
export async function measureWorkspace(
  options: WorkspaceMeasurementOptions,
  signal: AbortSignal,
): Promise<WorkspaceMeasurement> {
  const settings = await settingsFor(options.workspace, noFlagSettings);
  const clock = createSystemClock();
  const random = createSystemRandom();
  const evidence = await openEvidenceSession({
    root: defaultSessionRoot(homedir()),
    sessionId: createSessionId(clock, random),
    clock,
  });
  const fileSet = createFileSetRegistry(evidence);
  const baseRef = await resolveBaseCommit(options.workspace, options.baseRef);

  await evidence.record({
    type: "session-started",
    actor: "harness",
    provenance: ["user"],
    // The commit that was measured, not the name it was asked for: a bundle saying HEAD
    // names whatever HEAD points at when someone reads the bundle.
    payload: { task: options.task, workspace: options.workspace, baseRef },
  });
  await options.beforeSealing?.(evidence);

  const requestedBackend = parseIsolationOption(options.isolation ?? null, options.workspace);
  const backend =
    requestedBackend === null
      ? hostExecutionBackend
      : recordedContainerBackend(requestedBackend, evidence);
  const canary = join(evidence.directory, "containment-canary");
  await writeFile(canary, "synthetic containment control");
  const envelope = await selfTestContainment(backend, {
    workspaceRoot: options.workspace,
    hostFileOutsideWorkspace: canary,
  });
  await evidence.record({
    type: "execution-envelope",
    actor: "harness",
    provenance: ["tool-output"],
    payload: JSON.parse(JSON.stringify(envelope)),
  });

  const gateOptions = {
    ...gateOptionsFrom(settings),
    ...(options.packages ? { packages: options.packages } : {}),
  };
  const diffBudget = diffBudgetFrom(settings);
  // Sealed before anything runs, exactly as a task run seals its criteria before the loop, so
  // a gates-only bundle is held to the same conformance check by the verifier.
  const criteriaSealed = await sealAssembledCriteria({
    workspaceRoot: options.workspace,
    criteriaRef: baseRef,
    ...(gateOptions === undefined ? {} : { gateOptions }),
    evidence,
    budgets: diffBudget ?? defaultDiffBudget,
    attemptCap: 0,
  });
  const run = await runGatesEngine({
    workspaceRoot: options.workspace,
    abortSignal: signal,
    ...(requestedBackend === null ? {} : { isolation: backend }),
    baseRef,
    evidence,
    fileSet,
    // This command has no planner, so nothing declared an intended set. Without a scope the
    // caller authorised, the file-set gate reports what it observed and abstains rather than
    // failing every changed repository for a declaration nobody was there to make.
    authorizedScope:
      options.allowedFiles === null
        ? { kind: "observed" }
        : { kind: "allowed-files", files: options.allowedFiles },
    clock,
    emit: () => {},
    // No retries are offered, so none are spent: this command measures and reports.
    cap: 0,
    criteriaSealed,
    resolve: () => Promise.reject(new Error("swarm gates reports; it does not fix")),
    ...(gateOptions === undefined ? {} : { gateOptions }),
    ...(diffBudget === undefined ? {} : { budgets: diffBudget }),
    ...(options.excludedEnvironments === undefined
      ? {}
      : { excludedEnvironments: options.excludedEnvironments }),
  });

  // The verdict rather than a boolean: a change nothing executed used to exit 0 here, because
  // "no blocking gate failed" is true of a run where the only thing that passed was a linter.
  // Each dimension is reported with its reason, and unmeasured is never coerced into a pass.
  const verdict = await recordRunAssessment(
    evidence,
    run,
    signal.aborted ? "interrupted" : "completed",
    envelope.mode,
    signal.aborted,
  );
  const bundle = await writeBundle(evidence, options.bundleDirectory, clock, options.note);
  return { evidence, baseRef, envelope, run, verdict, bundleDirectory: bundle.directory };
}

async function gatesUnderCancellation(options: GatesCommand, signal: AbortSignal): Promise<number> {
  const measured = await measureWorkspace(
    {
      workspace: options.workspace,
      baseRef: options.baseRef,
      isolation: options.isolation,
      packages: options.packages,
      bundleDirectory: options.bundleDirectory,
      allowedFiles: options.allowedFiles,
      task: "gates",
      note: writeOut,
    },
    signal,
  );
  const { run, evidence, verdict } = measured;
  process.stdout.write(
    `project: ${run.detection.types.join(", ") || "no manifest detected"}\n\n` +
      `${describeCycle(run.outcome.firstCycle)}\n`,
  );
  for (const gate of outstandingJustifications(run.outcome.firstCycle, citedRecords(evidence))) {
    process.stdout.write(`\nthe ${gate.gateId} gate asked for a justification: ${gate.detail}\n`);
  }
  reportBonds(run.bonds, writeOut);
  process.stdout.write(`\n${describeVerdict(verdict).join("\n")}\n`);
  announceBundle(measured.bundleDirectory);
  return verdict.acceptable ? 0 : 1;
}
