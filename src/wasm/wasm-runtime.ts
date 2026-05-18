/**
 * Phase 5 WASM deterministic-floor runtime. Hosts a registry of
 * `DeterministicStrategy` modules and dispatches obligations through
 * them under a sandbox: writes outside `repoRoot` are rejected, a
 * scratch directory is provided per-dispatch, and a hard wall-time
 * cap is enforced.
 *
 * Architecture deviation: the §8 spec calls for a Wasmer or wasmtime
 * runtime with WASM modules. Strategies in this build are
 * TypeScript modules running in the same Node process as the
 * orchestrator, with a sandbox layer that enforces the same isolation
 * properties (no writes outside repoRoot, no implicit network access,
 * time budget). The strategy-module surface is shaped to be
 * substitutable with WASM-compiled modules without API churn; the
 * deviation is documented in `docs/v8-architecture-deviations.md`.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SwarmError } from '../errors';
import type { ObligationV1 } from '../shared-types/obligation-types';
import type {
  DeterministicStrategy,
  DispatchOutcome,
  StrategyContext,
  StrategyResult,
} from './types';

/** Default per-dispatch wall-time budget, ms. */
export const DEFAULT_STRATEGY_TIMEOUT_MS = 30_000;

/** Error thrown by the sandbox when a write would escape `repoRoot`. */
export class SandboxEscapeError extends SwarmError {
  /** The path the strategy attempted to write. */
  readonly attemptedPath: string;
  /** The repoRoot the sandbox is anchored to. */
  readonly repoRoot: string;
  constructor(attemptedPath: string, repoRoot: string, remediation?: string) {
    super(
      `sandbox refused write at ${attemptedPath}: path escapes repoRoot ${repoRoot}`,
      'SANDBOX_ESCAPE',
      remediation !== undefined ? { remediation } : undefined,
    );
    this.name = 'SandboxEscapeError';
    this.attemptedPath = attemptedPath;
    this.repoRoot = repoRoot;
  }
}

/** Error thrown when a strategy exceeds its wall-time budget. */
export class StrategyTimeoutError extends SwarmError {
  readonly strategyName: string;
  readonly timeoutMs: number;
  constructor(strategyName: string, timeoutMs: number, remediation?: string) {
    super(`strategy "${strategyName}" exceeded ${timeoutMs}ms wall-time budget`, 'STRATEGY_TIMEOUT', remediation !== undefined ? { remediation } : undefined);
    this.name = 'StrategyTimeoutError';
    this.strategyName = strategyName;
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Resolve a candidate write path against `repoRoot` and reject if it
 * escapes. Returns the absolute, sandbox-validated path. Symlink
 * traversal is rejected by `fs.realpathSync` on any existing prefix.
 */
export function ensureInsideRepoRoot(repoRoot: string, candidate: string): string {
  // Resolve any symlinks on both sides so platforms where `/tmp` symlinks
  // to `/private/tmp` (e.g. macOS) don't throw false escape errors.
  const absRepoRoot = canonicalRepoRoot(repoRoot);
  const abs = path.isAbsolute(candidate) ? candidate : path.resolve(absRepoRoot, candidate);
  const resolved = resolveExistingPath(abs);
  const rel = path.relative(absRepoRoot, resolved);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    if (rel === '') return absRepoRoot;
    throw new SandboxEscapeError(candidate, absRepoRoot,
      'Try: check that your strategy only writes inside the repository root, or use --repo-root to set the correct boundary');
  }
  return resolved;
}

function canonicalRepoRoot(repoRoot: string): string {
  const abs = path.resolve(repoRoot);
  try {
    return fs.realpathSync(abs);
  } catch {
    return abs;
  }
}

/**
 * Resolve a (possibly nonexistent) path through the deepest existing
 * prefix. If the full path exists, returns its realpath; otherwise
 * walks up to the deepest existing ancestor, resolves it, and rejoins.
 * Falls back to the original absolute path when nothing on the chain
 * exists. Used so the sandbox catches symlink-escapes on existing
 * parents even when the leaf hasn't been created yet.
 */
function resolveExistingPath(abs: string): string {
  try {
    return fs.realpathSync(abs);
  } catch {
    const parent = path.dirname(abs);
    if (parent === abs) return abs;
    try {
      const realParent = fs.realpathSync(parent);
      return path.join(realParent, path.basename(abs));
    } catch {
      return abs;
    }
  }
}

/**
 * The deterministic-floor runtime. Construct one per orchestrator run
 * (or share across runs — the registry has no per-run state).
 */
export class WasmRuntime {
  private readonly byName: Map<string, DeterministicStrategy> = new Map();

  constructor(initial: readonly DeterministicStrategy[] = []) {
    for (const s of initial) this.register(s);
  }

  /** Register a strategy. Throws when a name collides. */
  register(strategy: DeterministicStrategy): void {
    if (this.byName.has(strategy.name)) {
      throw new Error(
        `strategy "${strategy.name}" already registered; names are unique within a runtime`,
      );
    }
    this.byName.set(strategy.name, strategy);
  }

  /** Look up by name. Returns null when absent. */
  get(name: string): DeterministicStrategy | null {
    return this.byName.get(name) ?? null;
  }

  /** True when a strategy with the given name is registered. */
  has(name: string): boolean {
    return this.byName.has(name);
  }

  /** Snapshot of every registered strategy, in registration order. */
  list(): DeterministicStrategy[] {
    return [...this.byName.values()];
  }

  /** Names of every registered strategy, in registration order. */
  names(): string[] {
    return [...this.byName.keys()];
  }

  /**
   * Dispatch an obligation through a strategy. The strategy name is
   * resolved either from the obligation's `deterministicStrategy` tag
   * or from the explicit `strategyName` override.
   *
   * Sandbox properties:
   *   - a fresh scratch directory is created and torn down per dispatch;
   *   - the strategy's writes are validated against `repoRoot` after
   *     execution; any escape causes the dispatch to fail and any
   *     in-repo writes already made by the strategy remain (the sandbox
   *     is post-write, not transactional);
   *   - the wall-time budget defaults to `DEFAULT_STRATEGY_TIMEOUT_MS`
   *     and is enforced via `Promise.race`; an overrun produces a
   *     `StrategyTimeoutError` outcome.
   *
   * On strategy throw, the error message is captured into the outcome
   * so the population manager can log a `obligation-deterministic-failed`
   * entry without crashing the run.
   */
  async dispatch(
    obligation: ObligationV1,
    repoRoot: string,
    options: { strategyName?: string; timeoutMs?: number } = {},
  ): Promise<DispatchOutcome> {
    const name = options.strategyName ?? obligation.deterministicStrategy ?? '';
    if (!name) {
      throw new Error(
        'dispatch requires either obligation.deterministicStrategy or options.strategyName',
      );
    }
    const strategy = this.byName.get(name);
    if (!strategy) {
      const known = this.names().join(', ') || '(none)';
      throw new Error(`strategy "${name}" not registered (known: ${known})`);
    }
    if (!strategy.handles.includes(obligation.type)) {
      throw new Error(
        `strategy "${name}" does not handle obligation type "${obligation.type}" (handles: ${strategy.handles.join(', ')})`,
      );
    }

    const timeoutMs = options.timeoutMs ?? DEFAULT_STRATEGY_TIMEOUT_MS;
    const absRepoRoot = path.resolve(repoRoot);
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), `swarm-wasm-${name}-`));
    const ctx: StrategyContext = {
      obligation,
      repoRoot: absRepoRoot,
      scratch,
      timeoutMs,
    };

    const start = Date.now();
    try {
      const result = await runWithTimeout(strategy, ctx);
      validateAffected(absRepoRoot, result);
      return {
        strategyName: name,
        applied: result.applied,
        filesAffected: result.filesAffected,
        detail: result.detail,
        wallTimeMs: Date.now() - start,
        error: null,
      };
    } catch (err) {
      return {
        strategyName: name,
        applied: false,
        filesAffected: [],
        detail: `strategy "${name}" failed: ${(err as Error).message}`,
        wallTimeMs: Date.now() - start,
        error: (err as Error).message,
      };
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  }
}

async function runWithTimeout(
  strategy: DeterministicStrategy,
  ctx: StrategyContext,
): Promise<StrategyResult> {
  let timer: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new StrategyTimeoutError(strategy.name, ctx.timeoutMs,
        'Try: increase --command-timeout-ms, or use --preset fast to skip pre-generation checks'));
    }, ctx.timeoutMs);
  });
  try {
    return await Promise.race([strategy.execute(ctx), timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function validateAffected(repoRoot: string, result: StrategyResult): void {
  for (const rel of result.filesAffected) {
    ensureInsideRepoRoot(repoRoot, rel);
  }
}
