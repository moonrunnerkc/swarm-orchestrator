import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  defaultAdapterRegistry,
  type FalsificationInput,
  type FalsificationResult,
  type FalsifierAdapter,
} from '../../../src/falsification/adapters';

/**
 * Phase 0 deliverable: a real failing integration test that asserts an
 * adapter implementation conforms to the `FalsifierAdapter` contract.
 *
 * Phase 0 leaves `defaultAdapterRegistry()` empty, so the
 * "registry exposes a registered codex adapter" case fails with a clear
 * message that drives Phase 1. Once Phase 1 registers `CodexFalsifier`,
 * the adapter-by-name lookup succeeds and the conformance assertions
 * exercise the real implementation. The conformance assertions
 * themselves are the durable part — they keep enforcing the contract on
 * every adapter that gets registered, not just Codex.
 */

function isKebabCase(name: string): boolean {
  return /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(name);
}

function makeWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-adapter-conformance-'));
}

function smokeInput(workspaceRoot: string): FalsificationInput {
  return {
    patchSha: '0000000000000000000000000000000000000000',
    obligation: {
      type: 'property-must-hold',
      predicate: 'true',
      target: 'always-holds smoke test',
    },
    contextRefs: [],
    timeBudgetMs: 5_000,
    workspaceRoot,
  };
}

function assertResultShapeIsValid(result: FalsificationResult): void {
  switch (result.kind) {
    case 'counter-example-input':
      assert.equal(typeof result.obligationType, 'string');
      assert.ok(Array.isArray(result.inputs));
      for (const input of result.inputs) {
        assert.equal(typeof input.reproducer, 'string');
        assert.equal(typeof input.reproducerOutput, 'string');
        assert.equal(typeof input.reproducerExitCode, 'number');
        assert.ok(Array.isArray(input.files));
        for (const file of input.files) {
          assert.equal(typeof file.relPath, 'string');
          assert.equal(typeof file.bytes, 'string');
        }
      }
      return;
    case 'regression-fixture':
      assert.equal(typeof result.fixturePath, 'string');
      assert.equal(typeof result.notes, 'string');
      return;
    case 'property-violation-trace':
      assert.ok(Array.isArray(result.steps));
      assert.equal(typeof result.reproducer, 'string');
      return;
    case 'no-falsification-found':
      assert.ok(
        ['time-budget-exhausted', 'no-counter-example-discovered', 'strategy-not-applicable']
          .includes(result.reason),
        `unknown no-falsification-found reason: ${result.reason}`,
      );
      assert.equal(typeof result.attempts, 'number');
      return;
    default: {
      // exhaustiveness check — adding a new variant must update this test
      const exhaustive: never = result;
      throw new Error(`unhandled FalsificationResult variant: ${JSON.stringify(exhaustive)}`);
    }
  }
}

async function runConformance(adapter: FalsifierAdapter): Promise<void> {
  assert.ok(
    isKebabCase(adapter.name),
    `adapter name "${adapter.name}" must be kebab-case`,
  );
  assert.ok(
    Array.isArray(adapter.handles) && adapter.handles.length > 0,
    `adapter "${adapter.name}" must declare at least one handled obligation type`,
  );

  const workspace = makeWorkspace();
  try {
    const outcome = await adapter.falsify(smokeInput(workspace));
    assert.equal(outcome.cost.adapterName, adapter.name);
    assert.equal(typeof outcome.cost.wallClockMs, 'number');
    assert.ok(outcome.cost.wallClockMs >= 0);
    assert.ok(outcome.cost.dollarsSpent >= 0);
    assert.ok(outcome.cost.counterExamplesFound >= 0);
    assert.ok(outcome.cost.falsePositives >= 0);
    assertResultShapeIsValid(outcome.result);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}

describe('FalsifierAdapter contract conformance', () => {
  it('exposes the codex adapter through defaultAdapterRegistry()', () => {
    const registry = defaultAdapterRegistry();
    const codex = registry.get('codex');
    assert.ok(
      codex !== undefined,
      'expected a "codex" adapter registered in defaultAdapterRegistry(); ' +
        'Phase 1 of docs/adapter-integration.md must add it. This failure ' +
        'is the Phase 0 → Phase 1 driver.',
    );
  });

  it('every registered adapter satisfies the FalsifierAdapter contract', async function () {
    this.timeout(30_000);
    const registry = defaultAdapterRegistry();
    const adapters = registry.all();
    if (adapters.length === 0) {
      // Phase 0 path: prior assertion already failed with a Phase-1-driving
      // message. Mark this case pending instead of duplicating the failure.
      this.skip();
      return;
    }
    for (const adapter of adapters) {
      await runConformance(adapter);
    }
  });
});
