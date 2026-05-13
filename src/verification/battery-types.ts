import type { GateResult } from '../quality-gates/types';
import type { Finding } from '../types/finding';
import type { MutationCommandRunner } from './mutation-gate';
import type { PropertyCommandRunner } from './property-gate';
import type { VerificationCommandResult } from './command-runner';

export type BatteryLayerName =
  | 'differential-gate'
  | 'mutation-gate'
  | 'cheat-detector'
  | 'property-gate'
  | 'attestation';

export type BatteryLayerStatus = 'pass' | 'fail' | 'advisory-warn' | 'skipped' | 'env-error';

export type BatteryCommandRunner = (
  command: string,
  cwd: string,
  timeoutMs: number,
) => Promise<VerificationCommandResult>;

export interface LayerResult {
  layer: BatteryLayerName;
  status: BatteryLayerStatus;
  /** Populated on `skipped` results to distinguish allowlisted skips from error skips. */
  skipReason?: string;
  score: number;
  evidenceSummary: string;
  durationMs: number;
  findings: Finding[];
  errorReason?: string;
}

export interface BatteryResult {
  findings: Finding[];
  compositeScore: number;
  layerResults: LayerResult[];
  wallClock: number;
  /**
   * Hard-gate layers (1 and 2) that did not pass: returned `fail`, `env-error`,
   * or `skipped` without an allowlisted skip reason.
   */
  failedHardLayers: string[];
  /**
   * Advisory layers (3, 4, 5) that returned `fail` or `advisory-warn`.
   */
  advisoryWarningLayers: string[];
  /**
   * Every layer that returned `env-error`, regardless of layer class.
   */
  environmentErrorLayers: string[];
  /**
   * @deprecated Use `failedHardLayers` and `environmentErrorLayers` instead.
   * Kept for backward compatibility. Returns the union of `failedHardLayers` and `environmentErrorLayers`.
   */
  failedLayers: string[];
  hardGatePassed: boolean;
  humanReviewRequired: boolean;
  setupError?: string;
}

export interface BatteryRunnerInput {
  repoPath: string;
  baseCommit: string;
  patchCommit: string;
  goalText: string;
  differentialTestCommand?: string;
  regressionCommand?: string;
  changedFiles?: string[];
  diffText?: string;
  allowedTestFiles?: string[];
  runSemgrep?: boolean;
  skipMutation?: boolean;
  advisoryGateResults?: GateResult[];
  layerTimeoutMs?: Partial<Record<BatteryLayerName, number>>;
  regressionCommandRunner?: BatteryCommandRunner;
  mutationCommandRunner?: MutationCommandRunner;
  propertyCommandRunner?: PropertyCommandRunner;
  /**
   * Optional overlay files to copy into the differential-gate's base and
   * patch worktrees after `git worktree add --detach`. Required when
   * `differentialTestCommand` references a file that is not committed
   * to either branch (the pre-worker-synthesized regression test is
   * the canonical case — the orchestrator writes it to its run-scratch
   * directory rather than committing it to the worker's branch). Each
   * entry's `absoluteSource` must resolve on the host filesystem; the
   * `relativeDestination` is interpreted relative to each worktree root.
   */
  differentialOverlayFiles?: readonly DifferentialOverlayFile[];
}

/**
 * See {@link BatteryRunnerInput.differentialOverlayFiles}. This is a
 * pure data shape; the differential-gate copies these files into both
 * the base and patch detached worktrees before running the test command.
 */
export interface DifferentialOverlayFile {
  absoluteSource: string;
  relativeDestination: string;
}

export interface BatteryRunnerState {
  input: BatteryRunnerInput;
  changedFiles: string[];
  diffText: string;
}
