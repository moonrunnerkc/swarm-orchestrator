import { join } from "node:path";
import type { Clock } from "../core/clock.ts";
import type { LoopEvent } from "../core/loop-events.ts";
import type { EvidenceRecorder } from "../evidence/session.ts";
import {
  type AutoResolveOutcome,
  defaultAttemptCap,
  type ResolveAttempt,
  runAutoResolve,
} from "./auto-resolve.ts";
import {
  createBaseControlRunner,
  type SingleFileCommand,
  singleFileTestCommand,
} from "./base-control.ts";
import { assembleGates, type GateSetOptions } from "./default-gates.ts";
import type { FileSetRegistry } from "./file-set.ts";
import type { DiffBudget, GateContext, GateDefinition } from "./gate-definition.ts";
import { createGitCheckpoint, createGitWorkspaceProbe } from "./git-workspace.ts";
import { changesTheRunMade, type InheritedChanges } from "./inherited-changes.ts";
import { createNodeCommandRunner } from "./node-command-runner.ts";
import { detectProject, type ProjectDetection } from "./project-type.ts";

/** Deliberately generous. The budget is advisory, and a budget nobody can meet is noise. */
export const defaultDiffBudget: DiffBudget = { maxChangedFiles: 12, maxAddedLines: 600 };

interface GatesEngineOptions {
  readonly workspaceRoot: string;
  readonly baseRef: string;
  readonly evidence: EvidenceRecorder;
  readonly fileSet: FileSetRegistry;
  readonly clock: Clock;
  readonly emit: (event: LoopEvent) => void;
  readonly resolve: ResolveAttempt;
  readonly cap?: number;
  readonly budgets?: DiffBudget;
  readonly gateOptions?: GateSetOptions;
  /**
   * Overrides how one test file is run for the escape hatch's two controls. The second
   * argument is where this run is asked to write its own TAP result; an override that ignores
   * it gets no attribution, so its runs clear no individual test.
   */
  readonly singleFileTestCommand?: SingleFileCommand;
  /** Stops the resolve loop where the run was cancelled, rather than spending its attempts. */
  readonly abortSignal?: AbortSignal;
  /**
   * What already differed from the base when the run began. Those files are not attributed to
   * the run unless it went on to edit them, so a dirty workspace is not read as its work.
   */
  readonly inherited?: InheritedChanges;
}

export interface GatesEngineRun {
  readonly detection: ProjectDetection;
  readonly gates: readonly GateDefinition[];
  readonly outcome: AutoResolveOutcome;
}

/**
 * The composition root for the gates: detect, assemble, run, ratchet, escalate. Every
 * ambient thing (the shell, git, the clock) enters here, so the engine itself stays
 * testable against doubles.
 */
export async function runGatesEngine(options: GatesEngineOptions): Promise<GatesEngineRun> {
  const workspace = { workspaceRoot: options.workspaceRoot, baseRef: options.baseRef };
  const probe = createGitWorkspaceProbe(workspace);
  const commands = createNodeCommandRunner(options.clock);
  // Read from the base commit, falling back to the tree only where the base had no manifest at
  // all. A run must not author the command that measures it: one rewrote package.json's test
  // script from `node --test` to a python runner that is not installed on the machine, and the
  // tests gate then measured nothing while reporting only that the command was missing. That is
  // invariant 7's rule about the code under measurement authoring its own number, one level up:
  // here it authored the instrument. A workspace whose base declares no manifest is a run
  // establishing measurement rather than escaping it, and what it declares is itself measured
  // by whether the tests it wrote are collected.
  const detection = await detectProject(
    async (manifest) => (await probe.readBase(manifest)) ?? (await probe.readCurrent(manifest)),
  );
  const gates = assembleGates(detection, {
    ...(options.gateOptions ?? {}),
  });
  const budgets = options.budgets ?? defaultDiffBudget;

  const context = async (): Promise<GateContext> => ({
    workspaceRoot: options.workspaceRoot,
    changes:
      options.inherited === undefined
        ? await probe.changes()
        : await changesTheRunMade(await probe.changes(), probe, options.inherited),
    fileSet: options.fileSet.state(),
    budgets,
    probe,
    // Under the session store, beside the coverage reports and for the same reason: a probe
    // that wrote into the workspace would be visible to the gates measuring the workspace.
    harnessRun: { commands, scratchDirectory: join(options.evidence.directory, "probe") },
  });

  const outcome = await runAutoResolve({
    gates,
    context,
    ...(options.abortSignal === undefined ? {} : { abortSignal: options.abortSignal }),
    cycleDeps: {
      commands,
      evidence: options.evidence,
      emit: options.emit,
    },
    evidence: options.evidence,
    checkpoint: createGitCheckpoint(workspace),
    baseControl: createBaseControlRunner({
      workspace,
      commands,
      singleFileCommand: (testFile) =>
        options.singleFileTestCommand?.(testFile) ?? singleFileTestCommand(detection, testFile),
    }),
    resolve: options.resolve,
    emit: options.emit,
    cap: options.cap ?? defaultAttemptCap,
  });

  return { detection, gates, outcome };
}
