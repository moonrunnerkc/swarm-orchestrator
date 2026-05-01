import { execFileSync } from 'child_process';
import { computeCompositeScore, loadCompositeScoreConfig } from './composite-score';
import { runBatteryLayer } from './battery-layer-runners';
import type {
  BatteryLayerName,
  BatteryResult,
  BatteryRunnerInput,
  BatteryRunnerState,
} from './battery-types';

export type {
  BatteryCommandRunner,
  BatteryLayerName,
  BatteryLayerStatus,
  BatteryResult,
  BatteryRunnerInput,
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

  const layerResults = [];
  for (const layer of LAYERS) {
    layerResults.push(await runBatteryLayer(layer, prepared));
  }

  const findings = layerResults.flatMap(result => result.findings);
  const failedLayers = layerResults
    .filter(result => result.status === 'env-error')
    .map(result => result.layer);
  const hardGatePassed = layerResults
    .filter(result => result.layer === 'differential-gate' || result.layer === 'mutation-gate')
    .every(result => result.status !== 'fail' && result.status !== 'env-error');
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
    failedLayers,
    hardGatePassed,
    humanReviewRequired: !hardGatePassed || failedLayers.length > 0 || score.humanReviewRequired,
  };
}
