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
