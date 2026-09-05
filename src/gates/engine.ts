import { join } from "node:path";
import type { Clock } from "../core/clock.ts";
import type { LoopEvent } from "../core/loop-events.ts";
import type { EvidenceRecorder } from "../evidence/session.ts";
import { harnessChildEnvironment } from "../exec/child-environment.ts";
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
import { type BondOutcome, runBonds } from "./bond-runner.ts";
import { assembleGates, type GateSetOptions } from "./default-gates.ts";
import type { FileSetRegistry } from "./file-set.ts";
import type { DiffBudget, GateContext, GateDefinition } from "./gate-definition.ts";
import { observe } from "./gate-runner.ts";
import { describeGateSet, sealGateSet } from "./gate-set-seal.ts";
import {
  createGitCheckpoint,
  createGitWorkspaceProbe,
  revertSourceToBase,
} from "./git-workspace.ts";
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
  /**
   * Whether the caller already sealed the criteria on the chain, which a task run does before
   * its loop. A caller that has not gets the seal written here, before the first gate runs,
   * so no bundle in which gates ran is without the record the verifier holds them to.
   */
  readonly criteriaSealed?: boolean;
  /**
   * The commit the gate commands are read from. Defaults to the base, which is right for one
   * run. A session moves its base to the end of each turn, and a run that read its criteria
   * from there would run the commands the previous turn's model wrote into the manifest; the
   * session names the commit it started from here instead, and every turn is measured by it.
   */
  readonly criteriaRef?: string;
}

export interface GatesEngineRun {
  readonly detection: ProjectDetection;
  readonly gates: readonly GateDefinition[];
  readonly outcome: AutoResolveOutcome;
  /** One per gate that passed in the final cycle: whether that pass was shown able to fail. */
  readonly bonds: readonly BondOutcome[];
}

export interface CriteriaInput {
  readonly workspaceRoot: string;
  /** The commit whose manifests decide the gates: the base of a run, the start of a session. */
  readonly criteriaRef: string;
  readonly gateOptions?: GateSetOptions;
}

/**
 * Detection and assembly, in one place, so the set sealed before the loop and the set the
 * engine runs after it are built by the same function from the same inputs. Read from the
 * criteria commit, falling back to the tree only where that commit had no manifest at all: a
 * run must not author the command that measures it (see below), and neither may the turn or
 * the worker before it.
 */
export async function assembleGateSet(
  input: CriteriaInput,
): Promise<{ readonly detection: ProjectDetection; readonly gates: readonly GateDefinition[] }> {
  const probe = createGitWorkspaceProbe({
    workspaceRoot: input.workspaceRoot,
    baseRef: input.criteriaRef,
  });
  const detection = await detectProject(
    async (manifest) => (await probe.readBase(manifest)) ?? (await probe.readCurrent(manifest)),
  );
  return { detection, gates: assembleGates(detection, { ...(input.gateOptions ?? {}) }) };
}

/**
 * The criteria, on the chain before anything they govern runs. Returns false where the
 * workspace cannot be read for them, and raises nothing: the gates raise their own error when
 * they run, with the remedy, and a worse one here would replace it.
 */
export async function sealAssembledCriteria(
  input: CriteriaInput & {
    readonly evidence: EvidenceRecorder;
    readonly budgets: DiffBudget;
    readonly attemptCap: number;
  },
): Promise<boolean> {
  let assembled: Awaited<ReturnType<typeof assembleGateSet>>;
  try {
    assembled = await assembleGateSet(input);
  } catch {
    return false;
  }
  await sealGateSet(
    input.evidence,
    describeGateSet({
      detection: assembled.detection,
      gates: assembled.gates,
      criteriaRef: input.criteriaRef,
      budgets: input.budgets,
      attemptCap: input.attemptCap,
    }),
  );
  return true;
}

/**
 * The composition root for the gates: detect, assemble, run, ratchet, escalate. Every
 * ambient thing (the shell, git, the clock) enters here, so the engine itself stays
 * testable against doubles.
 */
export async function runGatesEngine(options: GatesEngineOptions): Promise<GatesEngineRun> {
  const workspace = { workspaceRoot: options.workspaceRoot, baseRef: options.baseRef };
  const probe = createGitWorkspaceProbe(workspace);
  const commands = createNodeCommandRunner(options.clock, harnessChildEnvironment());
  // Read from the base commit, falling back to the tree only where the base had no manifest at
  // all. A run must not author the command that measures it: one rewrote package.json's test
  // script from `node --test` to a python runner that is not installed on the machine, and the
  // tests gate then measured nothing while reporting only that the command was missing. That is
  // invariant 7's rule about the code under measurement authoring its own number, one level up:
  // here it authored the instrument. A workspace whose base declares no manifest is a run
  // establishing measurement rather than escaping it, and what it declares is itself measured
  // by whether the tests it wrote are collected.
  const criteriaRef = options.criteriaRef ?? options.baseRef;
  const { detection, gates } = await assembleGateSet({
    workspaceRoot: options.workspaceRoot,
    criteriaRef,
    ...(options.gateOptions === undefined ? {} : { gateOptions: options.gateOptions }),
  });
  const budgets = options.budgets ?? defaultDiffBudget;
  if (options.criteriaSealed !== true) {
    await sealGateSet(
      options.evidence,
      describeGateSet({
        detection,
        gates,
        criteriaRef,
        budgets,
        attemptCap: options.cap ?? defaultAttemptCap,
      }),
    );
  }

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
    // The base tree, in the working tree rather than a fresh checkout, so the installed
    // dependencies stay and a failure there is about the code rather than the environment.
    measureAtBase: async (gate) => {
      if (gate.source.kind !== "command") {
        return null;
      }
      const swap = await revertSourceToBase(workspace, () => false);
      try {
        return (
          await observe(gate, await context(), {
            commands,
            evidence: options.evidence,
            emit: options.emit,
          })
        ).observation;
      } finally {
        await swap.restore();
      }
    },
  });

  // After the fixed point, over the tree the run is judged on: each pass in the final cycle
  // is handed a change it has to refuse. A pass that survives its bond is recorded as
  // vacuous rather than as a pass, whatever the cycle above said.
  const bonds = await runBonds({
    gates,
    finalCycle: outcome.finalCycle,
    context,
    deps: { commands, evidence: options.evidence, emit: options.emit },
    evidence: options.evidence,
    workspaceRoot: options.workspaceRoot,
    detectedTypes: detection.types,
  });

  return { detection, gates, outcome, bonds };
}

/** A blocking gate whose pass could not be made to fail has not passed (section 3.6). */
export function vacuousBlockingBonds(bonds: readonly BondOutcome[]): readonly BondOutcome[] {
  return bonds.filter((bond) => bond.severity === "blocking" && bond.verdict === "vacuous");
}
