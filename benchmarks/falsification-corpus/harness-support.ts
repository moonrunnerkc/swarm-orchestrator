import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runVerificationCommand, type VerificationCommandResult } from '../../src/verification';
import type {
  BatteryError,
  BatteryHarnessOptions,
  BatteryResult,
  LayerName,
  LayerResult,
} from './harness';
import type { CorpusEntry } from './schema';

export interface TestSpec {
  testCommand?: string;
  regressionCommand?: string;
  allowedTestFiles?: string[];
}

export interface Worktrees {
  root: string;
  createdRoot: boolean;
  base: string;
  patch: string;
}

export class HarnessTimeoutError extends Error {
  constructor(readonly phase: string) {
    super('timeout-exceeded');
  }
}

export class HarnessEnvironmentError extends Error {
  constructor(readonly phase: string, reason: string) {
    super(reason);
  }
}

/** Creates detached base and patch worktrees for one battery run. */
export function createWorktrees(entry: CorpusEntry, options: BatteryHarnessOptions): Worktrees {
  const root = options.worktreeRoot
    ? path.resolve(options.worktreeRoot)
    : fs.mkdtempSync(path.join(os.tmpdir(), `falsification-battery-${entry.id}-`));
  const worktrees = {
    root,
    createdRoot: options.worktreeRoot === undefined,
    base: path.join(root, 'base'),
    patch: path.join(root, 'patch'),
  };
  fs.mkdirSync(root, { recursive: true });
  git(entry.repoPath, ['worktree', 'add', '--detach', worktrees.base, entry.baseCommit]);
  git(entry.repoPath, ['worktree', 'add', '--detach', worktrees.patch, entry.patchCommit]);
  return worktrees;
}

/** Removes harness worktrees and prunes stale git metadata. */
export function cleanupWorktrees(repoPath: string, worktrees: Worktrees): void {
  for (const worktreePath of [worktrees.base, worktrees.patch]) {
    if (!fs.existsSync(worktreePath)) continue;
    try {
      git(repoPath, ['worktree', 'remove', '--force', worktreePath]);
    } catch {
      fs.rmSync(worktreePath, { recursive: true, force: true });
    }
  }
  try {
    git(repoPath, ['worktree', 'prune']);
  } catch {
    // Worktree cleanup is already best effort at this point.
  }
  if (worktrees.createdRoot) fs.rmSync(worktrees.root, { recursive: true, force: true });
}

/** Runs git in a target repository and returns stdout. */
export function git(repoPath: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd: repoPath,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  }).trim();
}

/** Runs git and splits non-empty stdout lines. */
export function gitLines(repoPath: string, args: string[]): string[] {
  const output = git(repoPath, args);
  return output.length === 0 ? [] : output.split('\n').filter(line => line.trim().length > 0);
}

/** Reads an optional per-entry test sidecar. */
export function readTestSpec(entry: CorpusEntry, testSpecDir: string | undefined): TestSpec | undefined {
  if (testSpecDir === undefined) return undefined;
  const specPath = path.join(path.resolve(testSpecDir), `${entry.id}.test-spec.json`);
  if (!fs.existsSync(specPath)) return undefined;
  const parsed: unknown = JSON.parse(fs.readFileSync(specPath, 'utf8'));
  if (!isRecord(parsed)) throw new Error(`${entry.id} [test-spec]: sidecar is not a JSON object. Replace ${specPath}.`);
  return {
    ...(typeof parsed.testCommand === 'string' ? { testCommand: parsed.testCommand } : {}),
    ...(typeof parsed.regressionCommand === 'string' ? { regressionCommand: parsed.regressionCommand } : {}),
    ...(Array.isArray(parsed.allowedTestFiles) && parsed.allowedTestFiles.every(item => typeof item === 'string')
      ? { allowedTestFiles: parsed.allowedTestFiles }
      : {}),
  };
}

/** Builds a command runner that converts timeouts and setup failures into harness errors. */
export function timeoutAwareRunner(phase: LayerName, options: BatteryHarnessOptions) {
  return async (command: string, cwd: string, timeoutMs: number): Promise<VerificationCommandResult> => {
    const result = await runVerificationCommand(command, cwd, Math.min(timeoutMs, timeoutFor(options, phase)));
    if (result.timedOut) throw new HarnessTimeoutError(phase);
    if (result.exitCode !== 0 && isEnvironmentalCommandFailure(result)) {
      throw new HarnessEnvironmentError(phase, 'command failed due to missing runner, dependency, or setup');
    }
    return result;
  };
}

/** Returns the configured per-layer timeout with a 10-minute default. */
export function timeoutFor(options: BatteryHarnessOptions, phase: LayerName): number {
  return options.layerTimeoutMs?.[phase] ?? 600_000;
}

/** Maps a passing layer into the harness result shape. */
export function pass(score: number, evidence: unknown): LayerResult {
  return { status: 'pass', score, evidence };
}

/** Maps a failing hard gate into the harness result shape. */
export function fail(score: number, evidence: unknown): LayerResult {
  return { status: 'fail', score, evidence };
}

/** Maps an advisory finding into the harness result shape. */
export function warn(score: number, evidence: unknown): LayerResult {
  return { status: 'advisory-warn', score, evidence };
}

/** Maps a deliberately skipped layer into the harness result shape. */
export function skipped(reason: string, evidence: unknown = {}): LayerResult {
  return { status: 'skipped', score: 1, evidence, errorReason: reason };
}

/** Maps an environmental layer failure into the harness result shape. */
export function envError(
  entryId: string,
  phase: LayerName,
  reason: string,
  evidence: unknown = {},
): LayerResult {
  return {
    status: 'env-error',
    score: 1,
    evidence,
    errorReason: `${entryId} [${phase}]: ${reason}. Fix the environment or remove this entry from the corpus.`,
  };
}

/** Converts thrown layer errors into skipped or environmental layer results. */
export function caughtLayerError(entryId: string, phase: LayerName, error: unknown): LayerResult {
  if (error instanceof HarnessTimeoutError) return skipped('timeout-exceeded');
  const reason = error instanceof Error ? error.message : String(error);
  return envError(entryId, phase, reason, {});
}

/** Returns the score contribution used by composite calibration. */
export function compositeLayerScore(layer: LayerResult): number {
  return layer.status === 'env-error' || layer.status === 'skipped' ? 1 : layer.score;
}

/** Appends environmental layer failures to the battery error list. */
export function collectLayerErrors(
  entryId: string,
  layers: BatteryResult['layers'],
  errors: BatteryError[],
): void {
  for (const [phase, layer] of Object.entries(layers)) {
    if (layer.status === 'env-error') {
      errors.push(makeError(entryId, phase, layer.errorReason ?? 'environmental failure', true));
    }
  }
}

/** Builds the setup-failure battery result used when worktree creation fails. */
export function setupFailureResult(
  entryId: string,
  totalMs: number,
  perLayerMs: Record<string, number>,
  errors: BatteryError[],
): BatteryResult {
  const layer = envError(entryId, 'intent', 'battery setup failed before layer execution');
  return {
    entryId,
    layers: {
      intent: layer,
      regression: { ...layer },
      cheat: { ...layer },
      property: { ...layer },
      attestation: { ...layer },
    },
    compositeScore: 1,
    broke: false,
    flagged: false,
    timing: { totalMs, perLayerMs },
    errors,
  };
}

/** Creates a structured battery error with entry and remediation context. */
export function makeError(
  entryId: string,
  phase: string,
  reason: string,
  recoverable: boolean,
): BatteryError {
  return {
    phase,
    reason: `${entryId} [${phase}]: ${reason}. Fix the environment or corpus metadata before publishing.`,
    recoverable,
  };
}

/** Detects common missing-tool and missing-dependency command failures. */
export function isEnvironmentalCommandFailure(result: VerificationCommandResult): boolean {
  return isEnvironmentalText(`${result.stdout}\n${result.stderr}`);
}

/** Detects common missing-tool and missing-dependency text. */
export function isEnvironmentalText(text: string): boolean {
  return /(?:command not found|not recognized|ENOENT|MODULE_NOT_FOUND|Cannot find module|missing script|No such file or directory|could not determine executable|No tests found|pytest: not found|hypothesis|fast-check)/i.test(text);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
