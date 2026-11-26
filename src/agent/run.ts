import { mkdir, readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { snapshotWorkingTree } from "swarm-verify";
import { createSessionId, openEvidenceSession } from "../evidence/session.ts";
import { createChokepoint } from "../tools/chokepoint.ts";
import { type Progress, runAttempts } from "./attempts.ts";
import { type CheckGate, checkGate } from "./check-gate.ts";
import { prepareContained } from "./dependencies.ts";
import { finalize } from "./finalize.ts";
import { gitText } from "./git.ts";
import { assembleReport, recordStopped, writeReport } from "./report.ts";
import { initialRecord } from "./requirement-record.ts";
import { deriveForRun } from "./run-derived.ts";
import { runEnvironment } from "./run-environment.ts";
import type { RunOptions, RunReport } from "./run-options.ts";
import { stablePrefix } from "./stable-prefix.ts";
import { suppliedPaths } from "./supplied.ts";
import { behaviorChangeNote, createVerifier, swarmHome } from "./verification.ts";
import { versionConstraintsOf, workspaceDependencies } from "./version-constraints.ts";
import { deliver, emptySha256, openWorkspace } from "./workspace.ts";

export type { RunOptions, RunReport } from "./run-options.ts";

/**
 * Runs the loop in a managed worktree seeded with the user's tree as it stands, finalizes the
 * tree it leaves whatever ends the loop, and delivers the patch to the workspace only where the
 * workspace has not changed meanwhile.
 */
export async function runAgent(options: RunOptions): Promise<RunReport> {
  const started = Date.now();
  const repository = await gitText(options.workspace, ["rev-parse", "--show-toplevel"]);
  const home = swarmHome();
  const evidence = await openEvidenceSession({
    root: join(home, "sessions"),
    sessionId: createSessionId(Date.now()),
    now: Date.now,
  });
  const final = join(evidence.directory, "final");
  await mkdir(final, { recursive: true, mode: 0o700 });
  // Beside the repository, so a dependency it names by a relative path (file:../sibling) resolves
  // from the worktree as it does from the repository.
  const managed = await openWorkspace(
    repository,
    join(dirname(repository), `.${basename(repository)}.swarm-${evidence.sessionId}`),
    final,
    suppliedPaths(options.supplied ?? []),
    options.isolation === "host",
  );
  try {
    const workspace = managed.directory;
    const base = managed.start.base;
    const { guard, deadline, python, execution, executor, unavailable } = await runEnvironment({
      options,
      workspace,
      repository,
      home,
      childHome: join(evidence.directory, "home"),
      started,
    });
    const derived = await deriveForRun({ home, repository, workspace, options, evidence });
    // After the Python environment, so the probe and the layout see the .venv the model will.
    const prefix = await stablePrefix({
      workspace,
      executor,
      task: options.task,
      conventions: derived.block,
      signal: options.signal,
    });
    const { instructions, rendered, digests, promptSha256 } = prefix;
    await evidence.record({
      type: "session-started",
      actor: "harness",
      provenance: ["user"],
      payload: {
        task: options.task,
        model: options.model.model,
        base,
        head: managed.start.head,
        startingEdits: [...managed.start.paths],
        python: python === null ? null : { ...python },
        promptSha256,
        environment: prefix.environment,
        instructions: digests,
        instructionNotes: instructions.notes,
        behaviorChange: options.behaviorChange ?? "none",
        conventions: derived.profile ?? null,
        security: derived.applicability.map((one) => ({ ...one })),
      },
    });

    const declared = await workspaceDependencies(workspace);
    const stated = versionConstraintsOf(options.task, declared.dependencies);
    const progress: Progress = {
      model: options.model,
      loops: [],
      record: initialRecord(
        options.task,
        stated.constraints,
        [...declared.notes, ...stated.notes],
        options.obligations ?? [],
      ),
      review: null,
      escalated: false,
    };
    const verifier = createVerifier({
      workspace,
      base,
      execution,
      behaviorChange: options.behaviorChange ?? "none",
      evidence,
      producer: {
        name: "swarm-orchestrator",
        version: options.version,
        promptSha256,
        instructions: digests,
        ...(derived.profile === undefined ? {} : { profile: derived.profile }),
      },
      model: () => progress.model.model,
      trusted: () => gate?.trusted ?? [],
      behavior: derived.behavior,
      signal: options.signal,
    });
    const chokepoint = createChokepoint({
      guard,
      executor,
      evidence,
      approval: options.approval,
      confirm: options.confirm,
      timeoutMs: 600_000,
      signal: options.signal,
    });

    let stop: RunReport["stop"] = "interrupted";
    let reason: string | null = null;
    let gate: CheckGate | null = null;
    // Why nothing may run: no container could be made, or the base's dependencies did not install.
    let early = unavailable ?? derived.blocked;
    const setupNotes: string[] = [];
    try {
      // In a container the base's dependencies are installed there, before anything else runs.
      const prepared =
        early === null && executor.mode === "isolated"
          ? await prepareContained(chokepoint, workspace)
          : null;
      early ??= prepared?.blocked ?? null;
      setupNotes.push(...(prepared?.notes ?? []));
      if (early !== null) [stop, reason] = ["blocked", early];
      else {
        // The user's checks, or the author's for R1 written apart from the change, before any edit.
        gate = await checkGate({
          model: options.model,
          chokepoint,
          evidence,
          workspace,
          task: options.task,
          record: progress.record,
          home,
          turnTokens: options.turnTokens,
          // Inside the commands' HOME: a test runner writes its report there from the container too.
          scratch: join(evidence.directory, "home", "checks"),
          supplied: options.supplied ?? [],
          mode: options.checksMode ?? { kind: "accept-authored" },
          behaviorChangeAuthorized: options.behaviorChange === "authorized",
          derived: derived.turnChecks(base),
          signal: options.signal,
        });
        // Derived requirements join the user's here, once, and are fixed with them.
        progress.record = await derived.fix(gate.record);
        if (gate.blocked !== null) [stop, reason] = ["blocked", gate.blocked];
        else
          ({ stop, reason } = await runAttempts({
            shared: {
              task: options.task,
              chokepoint,
              evidence,
              environment: prefix.environment.block,
              instructions: rendered,
              status: () =>
                gitText(workspace, ["status", "--short", "--", ".", ":(exclude).swarm"]),
              // The patch the verifier would judge, new files included, kept in the session.
              diff: async () =>
                readFile(
                  (
                    await snapshotWorkingTree(
                      workspace,
                      base,
                      join(evidence.directory, "turn.patch"),
                    )
                  ).path,
                  "utf8",
                ),
              verify: verifier.tree,
              checks: gate.checks,
              turnTokens: options.turnTokens,
              turnTime: () => ({
                leftMs: deadline - Date.now() - verifier.reserveMs(),
                wallMs: options.maxWallMs ?? Number.POSITIVE_INFINITY,
              }),
              contextTokens: options.contextTokens,
              outputs: { directory: join(workspace, ".swarm", "outputs"), root: workspace },
              signal: options.signal,
              log: options.log,
            },
            escalation: options.escalation ?? null,
            review: options.review === true,
            maxSteps: options.maxSteps,
            // One allowance for the run: the check author's calls came out of it first.
            maxTokens:
              options.maxTokens -
              derived.tokens() -
              gate.authored.reduce((sum, one) => sum + one.inputTokens + one.outputTokens, 0),
            verifier,
            evidence,
            base,
            reviewDirectory: join(evidence.directory, "review"),
            progress,
          }));
      }
    } catch (error) {
      stop = options.signal?.aborted ? "cancelled" : "interrupted";
      // A cancelled run says why it was cancelled, not which operation the abort interrupted.
      const cause = options.signal?.aborted ? options.signal.reason : error;
      reason = cause instanceof Error ? cause.message : String(cause);
    }

    options.log("finalizing the delivered tree");
    const finalized = await finalize({
      workspace,
      base,
      directory: final,
      record: progress.record,
      held: verifier.held(),
      blocked: gate?.blocked ?? early,
      cannotVerify:
        stop === "cancelled"
          ? "the run was cancelled"
          : Date.now() >= deadline
            ? "the run's time budget was spent"
            : null,
      verify: (snapshot) =>
        verifier.snapshot(snapshot, progress.record, join(final, "verification")),
    });
    const delivery =
      options.apply && finalized.snapshot.sha256 !== emptySha256
        ? await deliver(repository, managed.start, finalized.snapshot.path, final)
        : {
            applied: false as const,
            reason: options.apply ? "the run changed nothing" : "kept as a patch, as asked",
          };
    const report = assembleReport({
      options,
      stop,
      reason,
      finalized,
      loops: progress.loops,
      review: progress.review,
      escalated: progress.escalated,
      digests,
      notes: [
        ...instructions.notes,
        ...setupNotes,
        ...derived.notes(),
        ...(gate?.notes ?? []),
        ...(progress.escalationNote === undefined
          ? []
          : [`Not escalated: ${progress.escalationNote}.`]),
        ...(options.behaviorChange === "authorized" ? [behaviorChangeNote(finalized.result)] : []),
      ],
      start: managed.start,
      python,
      commands: executor.statement,
      delivery,
      startedAt: started,
      authored: gate?.authored ?? [],
      user: gate?.user ?? [],
      blocked: gate?.blocked ?? early,
    });
    const paths = await writeReport(final, report);
    await recordStopped(evidence, {
      stop,
      reason,
      finalized,
      applied: delivery.applied,
      report: paths.json,
    });
    return {
      stop,
      report,
      sessionDirectory: evidence.directory,
      reportPath: paths.markdown,
      result: finalized.result,
    };
  } finally {
    await managed.remove();
  }
}
