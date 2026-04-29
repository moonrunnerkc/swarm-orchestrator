import { discoverTestCommand } from '../../src/test-command-discovery';
import {
  computeCompositeScore,
  loadCompositeScoreConfig,
  runCheatDetector,
  runDifferentialGate,
  runMutationGate,
  runPropertyGate,
  runVerificationCommand,
  verifyAttestation,
} from '../../src/verification';
import {
  cleanupWorktrees,
  collectLayerErrors,
  compositeLayerScore,
  caughtLayerError,
  createWorktrees,
  envError,
  fail,
  git,
  gitLines,
  isEnvironmentalCommandFailure,
  isEnvironmentalText,
  makeError,
  pass,
  readTestSpec,
  setupFailureResult,
  skipped,
  timeoutAwareRunner,
  timeoutFor,
  warn,
  type TestSpec,
  type Worktrees,
} from './harness-support';
import type { CorpusEntry } from './schema';

export interface BatteryResult {
  entryId: string;
  layers: {
    intent: LayerResult;
    regression: LayerResult;
    cheat: LayerResult;
    property: LayerResult;
    attestation: LayerResult;
  };
  compositeScore: number;
  broke: boolean;
  flagged: boolean;
  timing: { totalMs: number; perLayerMs: Record<string, number> };
  errors: BatteryError[];
}

export interface LayerResult {
  status: 'pass' | 'fail' | 'advisory-warn' | 'skipped' | 'env-error';
  score: number;
  evidence: unknown;
  errorReason?: string;
}

export interface BatteryError {
  phase: string;
  reason: string;
  recoverable: boolean;
}

export interface BatteryHarnessOptions {
  testSpecDir?: string;
  worktreeRoot?: string;
  runSemgrep?: boolean;
  layerTimeoutMs?: Partial<Record<LayerName, number>>;
}

export type LayerName = 'intent' | 'regression' | 'cheat' | 'property' | 'attestation';

/** Runs all falsification battery layers for one hand-labeled corpus entry. */
export async function runBattery(
  entry: CorpusEntry,
  options: BatteryHarnessOptions = {},
): Promise<BatteryResult> {
  const started = Date.now();
  const perLayerMs: Record<string, number> = {};
  const errors: BatteryError[] = [];
  let worktrees: Worktrees | undefined;

  try {
    worktrees = createWorktrees(entry, options);
    const activeWorktrees = worktrees;
    const changedFiles = gitLines(entry.repoPath, ['diff', '--name-only', `${entry.baseCommit}..${entry.patchCommit}`]);
    const diffText = git(entry.repoPath, ['diff', '--unified=0', `${entry.baseCommit}..${entry.patchCommit}`]);
    const testSpec = readTestSpec(entry, options.testSpecDir);
    const layers = {
      intent: await measure('intent', perLayerMs, () => runIntentLayer(entry, testSpec, options)),
      regression: await measure('regression', perLayerMs, () => runRegressionLayer(entry, activeWorktrees.patch, changedFiles, testSpec, options)),
      cheat: await measure('cheat', perLayerMs, () => runCheatLayer(entry, activeWorktrees.patch, diffText, testSpec, options)),
      property: await measure('property', perLayerMs, () => runPropertyLayer(entry, activeWorktrees.patch, changedFiles, options)),
      attestation: await measure('attestation', perLayerMs, () => runAttestationLayer(entry)),
    };
    const composite = computeCompositeScore({
      cheatDetectorScore: compositeLayerScore(layers.cheat),
      propertyGateScore: compositeLayerScore(layers.property),
      attestationScore: compositeLayerScore(layers.attestation),
      config: loadCompositeScoreConfig(activeWorktrees.patch),
    });
    collectLayerErrors(entry.id, layers, errors);

    return {
      entryId: entry.id,
      layers,
      compositeScore: composite.score,
      broke: layers.intent.status === 'fail' || layers.regression.status === 'fail',
      flagged: composite.humanReviewRequired,
      timing: { totalMs: Date.now() - started, perLayerMs },
      errors,
    };
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    errors.push(makeError(entry.id, 'setup', reason, true));
    return setupFailureResult(entry.id, Date.now() - started, perLayerMs, errors);
  } finally {
    if (worktrees !== undefined) {
      cleanupWorktrees(entry.repoPath, worktrees);
    }
  }
}

async function runIntentLayer(
  entry: CorpusEntry,
  testSpec: TestSpec | undefined,
  options: BatteryHarnessOptions,
): Promise<LayerResult> {
  if (testSpec?.testCommand === undefined) {
    return skipped('synthesis-required-not-provided');
  }
  const result = await runDifferentialGate({
    repoPath: entry.repoPath,
    baseCommit: entry.baseCommit,
    agentBranch: entry.patchCommit,
    testCommand: testSpec.testCommand,
    timeoutMs: timeoutFor(options, 'intent'),
  });
  if (result.base?.timedOut || result.patch?.timedOut) return skipped('timeout-exceeded');
  if (result.status === 'PASS') return pass(1, result);
  if (result.status === 'INVALID_TEST') return skipped('invalid-test-command');
  if (result.patch && isEnvironmentalCommandFailure(result.patch)) {
    return envError(entry.id, 'intent', 'test command failed due to missing runner, dependency, or setup', result);
  }
  if (isEnvironmentalText(result.reason)) return envError(entry.id, 'intent', result.reason, result);
  return fail(0, result);
}

async function runRegressionLayer(
  entry: CorpusEntry,
  patchWorktree: string,
  changedFiles: string[],
  testSpec: TestSpec | undefined,
  options: BatteryHarnessOptions,
): Promise<LayerResult> {
  const command = testSpec?.regressionCommand ?? discoverTestCommand(patchWorktree).command;
  const regression = await runVerificationCommand(command, patchWorktree, timeoutFor(options, 'regression'));
  if (regression.timedOut) return skipped('timeout-exceeded');
  if (regression.exitCode !== 0) {
    if (isEnvironmentalCommandFailure(regression)) {
      return envError(entry.id, 'regression', 'regression command failed due to missing runner, dependency, or setup', { regression });
    }
    return fail(0, { regression });
  }

  try {
    const mutation = await runMutationGate({
      targetRepoPath: patchWorktree,
      changedFiles,
      timeoutMs: timeoutFor(options, 'regression'),
      commandRunner: timeoutAwareRunner('regression', options),
    });
    if (mutation.status === 'SKIP') return skipped(mutation.reason, { regression, mutation });
    if (mutation.status === 'PASS') return pass(mutation.mutationScore, { regression, mutation });
    if (mutation.status === 'WARNING') return warn(mutation.mutationScore, { regression, mutation });
    if (mutation.results.some(result => result.exitCode !== 0 && isEnvironmentalText(`${result.stdout}\n${result.stderr}`))) {
      return envError(entry.id, 'regression', 'mutation tool failed due to missing runner, dependency, or setup', { regression, mutation });
    }
    return fail(mutation.mutationScore, { regression, mutation });
  } catch (error: unknown) {
    return caughtLayerError(entry.id, 'regression', error);
  }
}

async function runCheatLayer(
  entry: CorpusEntry,
  patchWorktree: string,
  diffText: string,
  testSpec: TestSpec | undefined,
  options: BatteryHarnessOptions,
): Promise<LayerResult> {
  try {
    const input = {
      repoPath: patchWorktree,
      goalText: entry.goalText,
      diffText,
      runSemgrep: options.runSemgrep ?? false,
      ...(testSpec?.allowedTestFiles !== undefined ? { allowedTestFiles: testSpec.allowedTestFiles } : {}),
    };
    const result = await runCheatDetector(input);
    return result.findings.length === 0 ? pass(result.score, result) : warn(result.score, result);
  } catch (error: unknown) {
    return caughtLayerError(entry.id, 'cheat', error);
  }
}

async function runPropertyLayer(
  entry: CorpusEntry,
  patchWorktree: string,
  changedFiles: string[],
  options: BatteryHarnessOptions,
): Promise<LayerResult> {
  try {
    const result = await runPropertyGate({
      targetRepoPath: patchWorktree,
      changedFiles,
      timeoutMsPerFunction: timeoutFor(options, 'property'),
      commandRunner: timeoutAwareRunner('property', options),
    });
    if (result.status === 'SKIP') return skipped('no-property-targets', result);
    return result.status === 'PASS' ? pass(result.score, result) : warn(result.score, result);
  } catch (error: unknown) {
    return caughtLayerError(entry.id, 'property', error);
  }
}

async function runAttestationLayer(entry: CorpusEntry): Promise<LayerResult> {
  try {
    const result = await verifyAttestation(entry.repoPath, entry.patchCommit);
    if (result.found && result.verified) return pass(1, result);
    return warn(0, result);
  } catch (error: unknown) {
    return caughtLayerError(entry.id, 'attestation', error);
  }
}

async function measure<T>(
  name: LayerName,
  perLayerMs: Record<string, number>,
  fn: () => Promise<T>,
): Promise<T> {
  const started = Date.now();
  try {
    return await fn();
  } finally {
    perLayerMs[name] = Date.now() - started;
  }
}
