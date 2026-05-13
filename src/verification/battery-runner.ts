import { execFileSync } from 'child_process';
import { computeCompositeScore, loadCompositeScoreConfig } from './composite-score';
import { runBatteryLayer } from './battery-layer-runners';
import type {
  BatteryLayerName,
  BatteryResult,
  BatteryRunnerInput,
  BatteryRunnerState,
  LayerResult,
} from './battery-types';

export type {
  BatteryCommandRunner,
  BatteryLayerName,
  BatteryLayerStatus,
  BatteryResult,
  BatteryRunnerInput,
  DifferentialOverlayFile,
  LayerResult,
} from './battery-types';

const LAYERS: BatteryLayerName[] = [
  'differential-gate',
  'mutation-gate',
  'cheat-detector',
  'property-gate',
  'attestation',
];

function git(repoPath: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd: repoPath,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
    },
  }).trim();
}

function gitLines(repoPath: string, args: string[]): string[] {
  const output = git(repoPath, args);
  return output ? output.split('\n').filter(line => line.trim() !== '') : [];
}

function elapsed(started: number): number {
  return Date.now() - started;
}

function setupFailure(started: number, reason: string): BatteryResult {
  return {
    findings: [],
    compositeScore: 0,
    layerResults: [],
    wallClock: elapsed(started),
    failedHardLayers: ['battery-setup'],
    advisoryWarningLayers: [],
    environmentErrorLayers: [],
    failedLayers: ['battery-setup'],
    hardGatePassed: false,
    humanReviewRequired: true,
    setupError: reason,
  };
}

function prepareState(input: BatteryRunnerInput, started: number): BatteryRunnerState | BatteryResult {
  if (!input.baseCommit.trim()) {
    return setupFailure(
      started,
      'battery setup failed: baseline commit is missing; ensure the target repository has an initial commit before running swarm',
    );
  }
  if (!input.patchCommit.trim()) {
    return setupFailure(
      started,
      'battery setup failed: patch commit is missing; ensure the orchestrator is running inside the target git repository',
    );
  }

  try {
    git(input.repoPath, ['rev-parse', '--verify', input.baseCommit]);
    git(input.repoPath, ['rev-parse', '--verify', input.patchCommit]);
    return {
      input,
      changedFiles: input.changedFiles
        ?? gitLines(input.repoPath, ['diff', '--name-only', `${input.baseCommit}..${input.patchCommit}`]),
      diffText: input.diffText ?? git(input.repoPath, ['diff', '--unified=0', `${input.baseCommit}..${input.patchCommit}`]),
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return setupFailure(
      started,
      `battery setup failed while preparing base..patch diff; verify git refs and repository state: ${message}`,
    );
  }
}

function isBatteryResult(value: BatteryRunnerState | BatteryResult): value is BatteryResult {
  return 'layerResults' in value;
}

/**
 * Run the configured v7 falsification battery against one end-of-run patch.
 *
 * @param input - Repository, base/patch refs, goal text, optional test commands, and layer options.
 * @returns Aggregated findings, per-layer results, composite score, wall-clock time, and failed layers.
 */
export async function runBatteryVerification(input: BatteryRunnerInput): Promise<BatteryResult> {
  const started = Date.now();
  const prepared = prepareState(input, started);
  if (isBatteryResult(prepared)) return prepared;

  const layerResults: LayerResult[] = [];
  for (const layer of LAYERS) {
    layerResults.push(await runBatteryLayer(layer, prepared));
  }

  const findings = layerResults.flatMap(result => result.findings);

  const HARD_GATE_LAYERS = new Set<string>(['differential-gate', 'mutation-gate']);
  const ADVISORY_LAYERS = new Set<string>(['cheat-detector', 'property-gate', 'attestation']);
  const ALLOWLISTED_SKIP_REASONS = new Set<string>(['no-supported-targets']);

  function isHardGatePass(result: (typeof layerResults)[number]): boolean {
    if (result.status === 'pass') return true;
    if (result.status === 'skipped' && result.skipReason !== undefined && ALLOWLISTED_SKIP_REASONS.has(result.skipReason)) return true;
    return false;
  }

  const failedHardLayers = layerResults
    .filter(result => HARD_GATE_LAYERS.has(result.layer) && !isHardGatePass(result))
    .map(result => result.layer);

  const advisoryWarningLayers = layerResults
    .filter(result => ADVISORY_LAYERS.has(result.layer) && (result.status === 'fail' || result.status === 'advisory-warn'))
    .map(result => result.layer);

  const environmentErrorLayers = layerResults
    .filter(result => result.status === 'env-error')
    .map(result => result.layer);

  // Deprecated: union of failedHardLayers and environmentErrorLayers for backward compat.
  const failedLayers = [...new Set([...failedHardLayers, ...environmentErrorLayers])];

  const hardGatePassed = failedHardLayers.length === 0;
  const score = computeCompositeScore({
    cheatDetectorScore: layerResults.find(result => result.layer === 'cheat-detector')?.score ?? 1,
    propertyGateScore: layerResults.find(result => result.layer === 'property-gate')?.score ?? 1,
    attestationScore: layerResults.find(result => result.layer === 'attestation')?.score ?? 1,
    advisoryLayerStatuses: Object.fromEntries(layerResults.map(result => [result.layer, result.status])),
    ...(input.advisoryGateResults !== undefined ? { advisoryGateResults: input.advisoryGateResults } : {}),
    config: loadCompositeScoreConfig(input.repoPath),
  });

  return {
    findings,
    compositeScore: hardGatePassed ? score.score : 0,
    layerResults,
    wallClock: elapsed(started),
    failedHardLayers,
    advisoryWarningLayers,
    environmentErrorLayers,
    failedLayers,
    hardGatePassed,
    humanReviewRequired: !hardGatePassed || environmentErrorLayers.length > 0 || score.humanReviewRequired,
  };
}
