import { discoverTestCommand } from '../test-command-discovery';
import { createFinding, type Finding } from '../types/finding';
import { runCheatDetector } from './cheat-detector';
import { runDifferentialGate } from './differential-gate';
import { runMutationGate } from './mutation-gate';
import { runPropertyGate } from './property-gate';
import { runVerificationCommand } from './command-runner';
import { verifyAttestation } from './attestation';
import type {
  BatteryLayerName,
  BatteryLayerStatus,
  BatteryRunnerInput,
  BatteryRunnerState,
  LayerResult,
} from './battery-types';

type LayerRunner = (state: BatteryRunnerState, started: number) => Promise<LayerResult>;

function timeoutFor(input: BatteryRunnerInput, layer: BatteryLayerName, fallback: number): number {
  return input.layerTimeoutMs?.[layer] ?? fallback;
}

function elapsed(started: number): number {
  return Date.now() - started;
}

function layerResult(input: {
  layer: BatteryLayerName;
  status: BatteryLayerStatus;
  score: number;
  evidenceSummary: string;
  durationMs: number;
  findings?: Finding[];
  errorReason?: string;
}): LayerResult {
  return {
    layer: input.layer,
    status: input.status,
    score: input.score,
    evidenceSummary: input.evidenceSummary,
    durationMs: input.durationMs,
    findings: input.findings ?? [],
    ...(input.errorReason !== undefined ? { errorReason: input.errorReason } : {}),
  };
}

function crashResult(layer: BatteryLayerName, started: number, error: unknown): LayerResult {
  const message = error instanceof Error ? error.message : String(error);
  return layerResult({
    layer,
    status: 'env-error',
    score: 0,
    evidenceSummary: `${layer} crashed; inspect the layer error and fix the runner environment`,
    durationMs: elapsed(started),
    errorReason: message,
  });
}

function regressionFailureFinding(command: string): Finding {
  return createFinding({
    scope: 'summary',
    producerId: 'mutation-gate',
    ruleId: 'regression-command-failed',
    severity: 'high',
    message: `Regression command failed before mutation testing: ${command.slice(0, 120)}`,
  });
}

async function runDifferentialLayer(state: BatteryRunnerState, started: number): Promise<LayerResult> {
  const command = state.input.differentialTestCommand?.trim();
  if (!command) {
    return layerResult({
      layer: 'differential-gate',
      status: 'skipped',
      score: 1,
      evidenceSummary: 'no synthesized FAIL_TO_PASS test command was available for Layer 1',
      durationMs: elapsed(started),
    });
  }

  const result = await runDifferentialGate({
    repoPath: state.input.repoPath,
    baseCommit: state.input.baseCommit,
    agentBranch: state.input.patchCommit,
    testCommand: command,
    timeoutMs: timeoutFor(state.input, 'differential-gate', 120_000),
  });
  const status = result.status === 'PASS'
    ? 'pass'
    : result.status === 'INVALID_TEST'
      ? 'skipped'
      : 'fail';
  return layerResult({
    layer: 'differential-gate',
    status,
    score: result.status === 'FAIL' ? 0 : 1,
    evidenceSummary: result.reason,
    durationMs: result.durationMs,
    findings: result.findings,
  });
}

async function runMutationLayer(state: BatteryRunnerState, started: number): Promise<LayerResult> {
  const command = state.input.regressionCommand?.trim() || discoverTestCommand(state.input.repoPath).command;
  const regressionRunner = state.input.regressionCommandRunner ?? runVerificationCommand;
  const regression = await regressionRunner(command, state.input.repoPath, timeoutFor(state.input, 'mutation-gate', 600_000));
  if (regression.exitCode !== 0 || regression.timedOut) {
    return layerResult({
      layer: 'mutation-gate',
      status: 'fail',
      score: 0,
      evidenceSummary: regression.timedOut
        ? `regression command timed out before mutation testing: ${command}`
        : `regression command failed before mutation testing: ${command}`,
      durationMs: elapsed(started),
      findings: [regressionFailureFinding(command)],
    });
  }

  if (state.input.skipMutation === true) {
    return layerResult({
      layer: 'mutation-gate',
      status: 'skipped',
      score: 1,
      evidenceSummary: 'regression command passed; mutation testing skipped by runner option',
      durationMs: elapsed(started),
    });
  }

  const mutation = await runMutationGate({
    targetRepoPath: state.input.repoPath,
    changedFiles: state.changedFiles,
    timeoutMs: timeoutFor(state.input, 'mutation-gate', 600_000),
    ...(state.input.mutationCommandRunner ? { commandRunner: state.input.mutationCommandRunner } : {}),
  });
  const status = mutation.status === 'PASS'
    ? 'pass'
    : mutation.status === 'SKIP'
      ? 'skipped'
      : mutation.status === 'WARNING'
        ? 'advisory-warn'
        : 'fail';
  return layerResult({
    layer: 'mutation-gate',
    status,
    score: mutation.mutationScore,
    evidenceSummary: mutation.reason,
    durationMs: elapsed(started),
    findings: mutation.findings,
  });
}

async function runCheatLayer(state: BatteryRunnerState, started: number): Promise<LayerResult> {
  const result = await runCheatDetector({
    repoPath: state.input.repoPath,
    goalText: state.input.goalText,
    diffText: state.diffText,
    runSemgrep: state.input.runSemgrep ?? false,
    ...(state.input.allowedTestFiles !== undefined ? { allowedTestFiles: state.input.allowedTestFiles } : {}),
  });
  return layerResult({
    layer: 'cheat-detector',
    status: result.findings.length === 0 ? 'pass' : 'advisory-warn',
    score: result.score,
    evidenceSummary: `cheat detector ${result.semgrepStatus}; ${result.findings.length} finding(s)`,
    durationMs: elapsed(started),
    findings: result.findings,
  });
}

async function runPropertyLayer(state: BatteryRunnerState, started: number): Promise<LayerResult> {
  const result = await runPropertyGate({
    targetRepoPath: state.input.repoPath,
    changedFiles: state.changedFiles,
    timeoutMsPerFunction: timeoutFor(state.input, 'property-gate', 60_000),
    ...(state.input.propertyCommandRunner ? { commandRunner: state.input.propertyCommandRunner } : {}),
  });
  const status = result.status === 'PASS'
    ? 'pass'
    : result.status === 'SKIP'
      ? 'skipped'
      : 'advisory-warn';
  return layerResult({
    layer: 'property-gate',
    status,
    score: result.score,
    evidenceSummary: `${result.targets.length} target(s); ${result.findings.length} finding(s)`,
    durationMs: elapsed(started),
    findings: result.findings,
  });
}

async function runAttestationLayer(state: BatteryRunnerState, started: number): Promise<LayerResult> {
  const result = await verifyAttestation(state.input.repoPath, state.input.patchCommit);
  const passed = result.found && result.verified;
  return layerResult({
    layer: 'attestation',
    status: passed ? 'pass' : 'advisory-warn',
    score: passed ? 1 : 0,
    evidenceSummary: result.reason,
    durationMs: elapsed(started),
  });
}

/**
 * Run one battery layer and convert unexpected exceptions into layer results.
 *
 * @param layer - Layer name being executed.
 * @param state - Prepared battery runner state.
 * @returns A structured layer result.
 */
export async function runBatteryLayer(
  layer: BatteryLayerName,
  state: BatteryRunnerState,
): Promise<LayerResult> {
  const started = Date.now();
  const runners: Record<BatteryLayerName, LayerRunner> = {
    'differential-gate': runDifferentialLayer,
    'mutation-gate': runMutationLayer,
    'cheat-detector': runCheatLayer,
    'property-gate': runPropertyLayer,
    attestation: runAttestationLayer,
  };

  try {
    return await runners[layer](state, started);
  } catch (error: unknown) {
    return crashResult(layer, started, error);
  }
}
