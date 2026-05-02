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
}

export interface BatteryRunnerState {
  input: BatteryRunnerInput;
  changedFiles: string[];
  diffText: string;
}
