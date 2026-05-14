import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  CliFalsifier as CodexFalsifier,
  defaultAdapterRegistry,
  type FalsificationInput,
  type FalsificationResult,
  type FalsifierAdapter,
} from '../../../src/falsification/adapters';
import { CODEX_CANDIDATE_COUNT, codexProfile } from '../../../src/falsification/adapters/profiles/codex';

/**
 * Phase 0 deliverable, satisfied by Phase 1: a real integration test
 * that asserts an adapter implementation conforms to the
 * `FalsifierAdapter` contract. The test exercises a `CodexFalsifier`
 * with a fake invocation that returns a syntactically valid Codex
 * response — this verifies the adapter's *parsing/dispatch/result*
 * contract end-to-end without spawning the real binary. The actual CLI
 * is exercised in
 * `test/falsification/adapters/codex/codex-falsifier.integration.test.ts`
 * (env-gated).
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
      predicate: '! grep -r "FORBIDDEN_TOKEN_CONFORMANCE" . 2>/dev/null',
      target: 'no FORBIDDEN_TOKEN_CONFORMANCE in workspace',
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
        [
          'time-budget-exhausted',
          'no-counter-example-discovered',
          'strategy-not-applicable',
          'baseline-predicate-failed',
        ].includes(result.reason),
        `unknown no-falsification-found reason: ${result.reason}`,
      );
      assert.equal(typeof result.attempts, 'number');
      return;
    default: {
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

function fakeCodexResponse(): string {
  const candidates = Array.from({ length: CODEX_CANDIDATE_COUNT }, (_, i) => ({
    name: `c-${i}`,
    rationale: 'introduces the forbidden token in a fresh file',
    files: [{ relPath: `c-${i}/leak.txt`, bytes: 'FORBIDDEN_TOKEN_CONFORMANCE' }],
  }));
  return [
    'narration line that the parser must ignore',
    '```json',
    JSON.stringify({ candidates }),
    '```',
    'tokens used: input=120 output=80 total=200',
  ].join('\n');
}

describe('FalsifierAdapter contract conformance', () => {
  it('exposes the codex adapter through defaultAdapterRegistry()', () => {
    const registry = defaultAdapterRegistry();
    const codex = registry.get('codex');
    assert.ok(codex !== undefined, 'expected a "codex" adapter registered');
    assert.ok(codex!.handles.includes('property-must-hold'));
  });

  it('CodexFalsifier conforms to the contract under a real invocation override', async () => {
    const adapter = new CodexFalsifier(codexProfile, {
      invocationOverride: async () => ({
        stdout: fakeCodexResponse(),
        stderr: '',
        exitCode: 0,
        wallClockMs: 50,
      }),
    });
    await runConformance(adapter);
  });

  it('produces a counter-example-input result for the smoke obligation', async () => {
    const adapter = new CodexFalsifier(codexProfile, {
      invocationOverride: async () => ({
        stdout: fakeCodexResponse(),
        stderr: '',
        exitCode: 0,
        wallClockMs: 50,
      }),
    });
    const workspace = makeWorkspace();
    try {
      const outcome = await adapter.falsify(smokeInput(workspace));
      assert.equal(outcome.result.kind, 'counter-example-input');
      if (outcome.result.kind === 'counter-example-input') {
        assert.ok(outcome.result.inputs.length > 0);
      }
      assert.ok(outcome.cost.counterExamplesFound > 0);
      assert.ok(outcome.cost.dollarsSpent > 0, 'token usage should produce non-zero dollars');
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('returns no-falsification-found when none of the candidates actually falsify', async () => {
    const safeCandidatesJson = JSON.stringify({
      candidates: Array.from({ length: CODEX_CANDIDATE_COUNT }, (_, i) => ({
        name: `safe-${i}`,
        rationale: 'does not contain the token, so the predicate stays satisfied',
        files: [{ relPath: `safe-${i}/note.txt`, bytes: 'nothing-forbidden-here' }],
      })),
    });
    const adapter = new CodexFalsifier(codexProfile, {
      invocationOverride: async () => ({
        stdout: ['```json', safeCandidatesJson, '```'].join('\n'),
        stderr: '',
        exitCode: 0,
        wallClockMs: 30,
      }),
    });
    const workspace = makeWorkspace();
    try {
      const outcome = await adapter.falsify(smokeInput(workspace));
      assert.equal(outcome.result.kind, 'no-falsification-found');
      assert.equal(outcome.cost.counterExamplesFound, 0);
      assert.equal(outcome.cost.falsePositives, CODEX_CANDIDATE_COUNT);
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });
});
