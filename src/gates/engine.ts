import type { Clock } from "../core/clock.ts";
import type { LoopEvent } from "../core/loop-events.ts";
import type { EvidenceRecorder } from "../evidence/session.ts";
import {
  type AutoResolveOutcome,
  defaultAttemptCap,
  type ResolveAttempt,
  runAutoResolve,
} from "./auto-resolve.ts";
import { createBaseControlRunner, singleFileTestCommand } from "./base-control.ts";
import { assembleGates, type GateSetOptions } from "./default-gates.ts";
import type { FileSetRegistry } from "./file-set.ts";
import type { DiffBudget, GateContext, GateDefinition } from "./gate-definition.ts";
import { createGitCheckpoint, createGitWorkspaceProbe } from "./git-workspace.ts";
import { createNodeCommandRunner } from "./node-command-runner.ts";
import { detectProject, type ProjectDetection } from "./project-type.ts";

/** Deliberately generous. The budget is advisory, and a budget nobody can meet is noise. */
export const defaultDiffBudget: DiffBudget = { maxChangedFiles: 12, maxAddedLines: 600 };

export interface GatesEngineOptions {
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
  /** Overrides how one test file is run for the escape hatch's two controls. */
  readonly singleFileTestCommand?: (testFile: string) => string | null;
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
  const detection = await detectProject(probe.readCurrent);
  const gates = assembleGates(detection, options.gateOptions ?? {});
  const budgets = options.budgets ?? defaultDiffBudget;

  const context = async (): Promise<GateContext> => ({
    workspaceRoot: options.workspaceRoot,
    changes: await probe.changes(),
    fileSet: options.fileSet.state(),
    budgets,
    probe,
  });

  const outcome = await runAutoResolve({
    gates,
    context,
    cycleDeps: { commands, evidence: options.evidence, emit: options.emit },
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
