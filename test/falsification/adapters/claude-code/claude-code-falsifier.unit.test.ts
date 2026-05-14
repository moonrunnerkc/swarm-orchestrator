import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CliFalsifier } from '../../../../src/falsification/adapters/cli-falsifier';
import { claudeCodeProfile } from '../../../../src/falsification/adapters/profiles/claude-code';
import type { FalsificationInput } from '../../../../src/falsification/adapters/types';

function makeWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-claudecode-falsifier-unit-'));
}

function makeEnvelope(result: string, totalCostUsd = 0.05, isError = false): string {
  return JSON.stringify({
    type: 'result',
    subtype: isError ? 'error_max_budget_usd' : 'success',
    is_error: isError,
    result,
    total_cost_usd: totalCostUsd,
    usage: { input_tokens: 100, output_tokens: 50 },
    stop_reason: 'end_turn',
    num_turns: 1,
  });
}

function fenceCandidates(candidates: unknown[]): string {
  return ['```json', JSON.stringify({ candidates }), '```'].join('\n');
}

function setupNoUpwardImportsScope(workspaceRoot: string): void {
  const scope = path.join(workspaceRoot, 'lib');
  fs.mkdirSync(scope, { recursive: true });
  fs.writeFileSync(path.join(scope, 'a.ts'), 'export const a = 1;\n', 'utf8');
  fs.writeFileSync(path.join(workspaceRoot, 'sibling.ts'), 'export const s = 2;\n', 'utf8');
}

function noUpwardImportsInput(workspaceRoot: string): FalsificationInput {
  return {
    patchSha: '0'.repeat(40),
    obligation: {
      type: 'import-graph-must-satisfy',
      constraint: 'no-upward-imports',
      scope: 'lib',
    },
    contextRefs: [],
    timeBudgetMs: 5_000,
    workspaceRoot,
  };
}

describe('ClaudeCodeFalsifier unit paths', () => {
  it('returns strategy-not-applicable for unsupported obligation types', async () => {
    // Phase 4 redo extension (audit-and-corrections, 2026-05-09):
    // ClaudeCode now handles property-must-hold in addition to its
    // original two types. Test uses test-must-pass to exercise the
    // strategy-not-applicable branch.
    const adapter = new CliFalsifier(claudeCodeProfile, {
      authMethodOverride: () => 'chatgpt',
      invocationOverride: async () => ({ stdout: '', stderr: '', exitCode: 0, wallClockMs: 0 }),
    });
    const ws = makeWorkspace();
    try {
      const outcome = await adapter.falsify({
        patchSha: '0'.repeat(40),
        obligation: {
          type: 'test-must-pass',
          command: 'true',
        },
        contextRefs: [],
        timeBudgetMs: 1_000,
        workspaceRoot: ws,
      });
      assert.equal(outcome.result.kind, 'no-falsification-found');
      if (outcome.result.kind === 'no-falsification-found') {
        assert.equal(outcome.result.reason, 'strategy-not-applicable');
      }
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  it('returns baseline-predicate-failed when the obligation is already violated', async () => {
    let claudeCalled = false;
    const adapter = new CliFalsifier(claudeCodeProfile, {
      authMethodOverride: () => 'chatgpt',
      invocationOverride: async () => {
        claudeCalled = true;
        return { stdout: '', stderr: '', exitCode: 0, wallClockMs: 0 };
      },
    });
    const ws = makeWorkspace();
    try {
      const scope = path.join(ws, 'lib');
      fs.mkdirSync(scope, { recursive: true });
      fs.writeFileSync(path.join(scope, 'leak.ts'), 'import { x } from "../sibling";\n', 'utf8');
      fs.writeFileSync(path.join(ws, 'sibling.ts'), 'export const x = 1;\n', 'utf8');
      const outcome = await adapter.falsify(noUpwardImportsInput(ws));
      assert.equal(claudeCalled, false, 'claude must not be invoked when baseline fails');
      assert.equal(outcome.result.kind, 'no-falsification-found');
      if (outcome.result.kind === 'no-falsification-found') {
        assert.equal(outcome.result.reason, 'baseline-predicate-failed');
      }
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  it('preserves stderr on Error.cause when claude exits non-zero', async () => {
    const stderr2kb = 'X'.repeat(2048);
    const adapter = new CliFalsifier(claudeCodeProfile, {
      authMethodOverride: () => 'chatgpt',
      invocationOverride: async () => ({
        stdout: '',
        stderr: stderr2kb,
        exitCode: 5,
        wallClockMs: 10,
      }),
    });
    const ws = makeWorkspace();
    try {
      setupNoUpwardImportsScope(ws);
      await adapter.falsify(noUpwardImportsInput(ws));
      assert.fail('expected falsify() to throw');
    } catch (err) {
      assert.ok(err instanceof Error);
      assert.match(err.message, /claude exec failed with exit code 5/);
      const cause = (err as Error & { cause?: unknown }).cause as
        | { exitCode: number; stderr: string }
        | undefined;
      assert.ok(cause);
      assert.equal(cause!.exitCode, 5);
      assert.equal(cause!.stderr.length, 2048);
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  it('confirms a falsifying candidate via the AST verifier and reports counter-examples', async () => {
    const candidates = [
      {
        name: 'add-upward',
        rationale: 'introduces an upward import',
        files: [{ relPath: 'lib/cheat.ts', bytes: 'import { sibling } from "../sibling";\n' }],
      },
      {
        name: 'no-op',
        rationale: 'does not actually violate (false positive)',
        files: [{ relPath: 'lib/innocent.ts', bytes: 'export const x = 2;\n' }],
      },
      {
        name: 'add-upward-2',
        rationale: 'second valid violation',
        files: [{ relPath: 'lib/cheat2.ts', bytes: 'import "../sibling";\n' }],
      },
    ];
    const stdout = makeEnvelope(fenceCandidates(candidates), 0.07, false);
    const adapter = new CliFalsifier(claudeCodeProfile, {
      authMethodOverride: () => 'chatgpt',
      invocationOverride: async () => ({ stdout, stderr: '', exitCode: 0, wallClockMs: 50 }),
    });
    const ws = makeWorkspace();
    try {
      setupNoUpwardImportsScope(ws);
      const outcome = await adapter.falsify(noUpwardImportsInput(ws));
      assert.equal(outcome.result.kind, 'counter-example-input');
      if (outcome.result.kind === 'counter-example-input') {
        assert.equal(outcome.result.inputs.length, 2);
      }
      assert.equal(outcome.cost.counterExamplesFound, 2);
      assert.equal(outcome.cost.falsePositives, 1);
      assert.equal(outcome.cost.dollarsBilled, 0); // chatgpt auth
      assert.ok(Math.abs(outcome.cost.dollarsTokenEstimate - 0.07) < 1e-9);
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  it('falsifies a function-must-have-signature obligation by overwriting the file', async () => {
    const candidates = [
      {
        name: 'wrong-return-type',
        rationale: 'changes return type',
        files: [{ relPath: 'src/widget.ts', bytes: 'export function compute(x: number): string { return String(x); }\n' }],
      },
      {
        name: 'rename',
        rationale: 'removes the function entirely',
        files: [{ relPath: 'src/widget.ts', bytes: 'export function renamed(x: number): number { return x; }\n' }],
      },
      {
        name: 'wrong-params',
        rationale: 'changes parameter list',
        files: [{ relPath: 'src/widget.ts', bytes: 'export function compute(): number { return 0; }\n' }],
      },
    ];
    const stdout = makeEnvelope(fenceCandidates(candidates), 0.09, false);
    const adapter = new CliFalsifier(claudeCodeProfile, {
      authMethodOverride: () => 'chatgpt',
      invocationOverride: async () => ({ stdout, stderr: '', exitCode: 0, wallClockMs: 30 }),
    });
    const ws = makeWorkspace();
    try {
      const srcDir = path.join(ws, 'src');
      fs.mkdirSync(srcDir, { recursive: true });
      const original = 'export function compute(x: number): number {\n  return x;\n}\n';
      fs.writeFileSync(path.join(srcDir, 'widget.ts'), original, 'utf8');
      const outcome = await adapter.falsify({
        patchSha: '0'.repeat(40),
        obligation: {
          type: 'function-must-have-signature',
          file: 'src/widget.ts',
          name: 'compute',
          signature: '(x: number): number',
        },
        contextRefs: [],
        timeBudgetMs: 5_000,
        workspaceRoot: ws,
      });
      assert.equal(outcome.result.kind, 'counter-example-input');
      if (outcome.result.kind === 'counter-example-input') {
        assert.equal(outcome.result.inputs.length, 3);
      }
      const restored = fs.readFileSync(path.join(srcDir, 'widget.ts'), 'utf8');
      assert.equal(restored, original);
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });
});
