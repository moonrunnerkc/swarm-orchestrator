// The positive merge-safety gate runner. Given an already-provisioned Node
// workspace, it builds the default merge-safety obligation set (test always,
// build when a build script is declared), appends any consumer-declared
// obligations, runs each through the shared verifyObligation, and produces the
// MergeControl[] the merge-decision composer consumes.
//
// Reuse, not reimplementation: obligations are ObligationV1 (shared-types), the
// check is verifyObligation (src/verification/run-verifier.ts). The falsifier
// control is injected as a probe so the runner is deterministic and offline in
// tests; the CLI wiring supplies the real probe, which must distinguish "a
// falsifier ran and found no counter-example" (pass) from "no adapter
// configured / the CLI is missing" (unavailable, a null control), because the
// falsifier dispatcher returns the same value for both.

import * as fs from 'fs';
import * as path from 'path';
import type { ObligationV1 } from '../../shared-types/obligation-types';
import { verifyObligation, type VerifyOptions } from '../../verification/run-verifier';
import type { PackageManager, TestRunner } from '../execution-grounded/sandbox';
import type { ControlKind, MergeControl } from './merge-decision';

/**
 * Injected falsifier control. Returns a control when a falsifier is configured
 * (pass = ran, no counter-example; fail = counter-example; unavailable = could
 * not run), or null when no adapter is configured at all (the adversarial
 * control legitimately does not participate). Null is disclosed by the caller,
 * never silently treated as a pass.
 */
export type FalsifierProbe = (obligations: readonly ObligationV1[]) => MergeControl | null;

export interface PositiveGateOptions {
  /** Provisioned workspace root the obligations run against. */
  readonly workspacePath: string;
  readonly packageManager: PackageManager;
  /** The detected runner, used to invoke the suite when no `test` script exists. */
  readonly testRunner: TestRunner;
  /** Consumer obligations from .swarm/merge-obligations.yaml, appended to the default set. */
  readonly extraObligations?: readonly ObligationV1[];
  /** Per-command wall-clock cap. Falls through to verifyObligation's default (5 min). */
  readonly commandTimeoutMs?: number;
  /** Optional falsifier control probe. Omit for no adversarial control (disclosed absence). */
  readonly falsifierProbe?: FalsifierProbe;
}

export interface PositiveGateResult {
  /** The controls that ran: one per obligation, plus the falsifier when configured. */
  readonly controls: readonly MergeControl[];
  /** The full obligation set that ran (default plus consumer-declared). */
  readonly obligations: readonly ObligationV1[];
}

function readScripts(workspacePath: string): Record<string, string> {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(workspacePath, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };
    return pkg.scripts ?? {};
  } catch {
    return {};
  }
}

/** Whole-suite invocation for a runner when the project declares no `test` script. */
function runnerSuiteCommand(runner: TestRunner): string {
  switch (runner) {
    case 'jest':
      return 'npx jest';
    case 'vitest':
      return 'npx vitest run';
    case 'mocha':
      return 'npx mocha';
    case 'ava':
      return 'npx ava';
    case 'node-test':
      return 'node --test';
    case 'pytest':
      // `python3 -m pytest` resolves whenever pytest is importable, more
      // robustly than a bare `pytest` entry-point on PATH.
      return 'python3 -m pytest';
    case 'go-test':
      return 'go test ./...';
  }
}

/**
 * Build the default merge-safety obligation set for a provisioned workspace.
 * test-must-pass always runs (a merge gate must exercise the suite); it prefers
 * the project's own `test` script and falls back to invoking the detected
 * runner directly. build-must-pass runs only when a `build` script is declared:
 * a project with no build step has nothing to build, which is a vacuous pass,
 * not a control worth asserting.
 *
 * @param workspacePath the provisioned workspace root.
 * @param packageManager the detected package manager (drives the run invocation).
 * @param testRunner the detected runner (used when no `test` script exists).
 * @returns the default obligations in run order (build first when present, then test).
 */
export function buildDefaultMergeObligations(
  workspacePath: string,
  packageManager: PackageManager,
  testRunner: TestRunner,
): ObligationV1[] {
  const scripts = readScripts(workspacePath);
  const obligations: ObligationV1[] = [];
  if (typeof scripts.build === 'string' && scripts.build.trim().length > 0) {
    obligations.push({ type: 'build-must-pass', command: `${packageManager} run build` });
  }
  const testCommand =
    typeof scripts.test === 'string' && scripts.test.trim().length > 0
      ? `${packageManager} run test`
      : runnerSuiteCommand(testRunner);
  obligations.push({ type: 'test-must-pass', command: testCommand });
  return obligations;
}

function controlKind(obligation: ObligationV1): ControlKind {
  if (obligation.type === 'build-must-pass') return 'build';
  if (obligation.type === 'test-must-pass') return 'test';
  return 'obligation';
}

function controlId(obligation: ObligationV1, index: number): string {
  if (obligation.type === 'build-must-pass' || obligation.type === 'test-must-pass') {
    return obligation.type;
  }
  return `${obligation.type}[${index}]`;
}

/**
 * Run the positive merge-safety gate against a provisioned workspace.
 *
 * @param options the workspace, package manager, runner, and optional extras.
 * @returns the controls (one per obligation, plus the falsifier when configured)
 *   and the full obligation set that ran.
 */
export function runPositiveGate(options: PositiveGateOptions): PositiveGateResult {
  const defaults = buildDefaultMergeObligations(
    options.workspacePath,
    options.packageManager,
    options.testRunner,
  );
  const obligations: ObligationV1[] = [...defaults, ...(options.extraObligations ?? [])];

  const verifyOptions: VerifyOptions = { repoRoot: options.workspacePath };
  if (options.commandTimeoutMs !== undefined) {
    verifyOptions.commandTimeoutMs = options.commandTimeoutMs;
  }

  const controls: MergeControl[] = [];
  for (let i = 0; i < obligations.length; i += 1) {
    const obligation = obligations[i]!;
    const result = verifyObligation(obligation, verifyOptions);
    controls.push({
      id: controlId(obligation, i),
      kind: controlKind(obligation),
      status: result.satisfied ? 'pass' : 'fail',
      detail: result.detail,
    });
  }

  if (options.falsifierProbe !== undefined) {
    const falsifierControl = options.falsifierProbe(obligations);
    if (falsifierControl !== null) {
      controls.push(falsifierControl);
    }
  }

  return { controls, obligations };
}
