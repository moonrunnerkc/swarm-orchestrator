import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  runExecutionGrounded,
  type ExecutionGroundedInput,
} from '../../../src/audit/execution-grounded';
import type { ExecutionGroundedConfig } from '../../../src/audit/cheat-detector/audit-config';

// End-to-end coverage of the orchestrator's offline-reachable control flow:
// config gating, the no-mutable-lines short-circuit, and the docker-safety
// guarantee. The mutation/coverage success path needs a provisioned checkout
// (network + a test toolchain) and is exercised by `execution-grounded:full`,
// which is infra-gated; these tests pin the branches that decide whether the
// PR's code is ever allowed to run at all.

function baseConfig(over: Partial<ExecutionGroundedConfig> = {}): ExecutionGroundedConfig {
  return {
    enabled: true,
    mutation: true,
    issueRepro: false,
    coverage: true,
    maxWallClockPerPrMs: 60_000,
    runner: 'host',
    corroborateStructural: false,
    ...over,
  };
}

function baseInput(over: Partial<ExecutionGroundedInput> = {}): ExecutionGroundedInput {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-eg-e2e-'));
  return {
    prDiff: '',
    repo: 'o/r',
    prNumber: 1,
    prHeadSha: 'a'.repeat(40),
    config: baseConfig(),
    baseDir,
    ...over,
  };
}

const SRC_DIFF = [
  'diff --git a/src/calc.ts b/src/calc.ts',
  '--- a/src/calc.ts',
  '+++ b/src/calc.ts',
  '@@ -1,3 +1,4 @@',
  ' export function add(a: number, b: number): number {',
  '-  return a + b;',
  '+  if (a < 0) return 0;',
  '+  return a + b;',
  ' }',
  '',
].join('\n');

const DOC_DIFF = [
  'diff --git a/README.md b/README.md',
  '--- a/README.md',
  '+++ b/README.md',
  '@@ -1 +1,2 @@',
  ' # title',
  '+a new line',
  '',
].join('\n');

describe('execution-grounded / runExecutionGrounded (orchestrator)', () => {
  it('returns an empty skipped outcome when the layer is disabled', async () => {
    const outcome = await runExecutionGrounded(
      baseInput({ prDiff: SRC_DIFF, config: baseConfig({ enabled: false }) }),
    );
    assert.deepEqual(outcome.findings, []);
    assert.ok(outcome.skipped.includes('executionGrounded disabled'));
  });

  it('skips before provisioning when the diff has no mutable source lines', async () => {
    const outcome = await runExecutionGrounded(baseInput({ prDiff: DOC_DIFF }));
    assert.deepEqual(outcome.findings, []);
    assert.ok(outcome.skipped.includes('no mutable source lines in diff'));
    assert.deepEqual(outcome.mutationRuns, []);
  });

  it('skips the whole layer when docker isolation is requested but the image is absent', async () => {
    const saved = process.env.SWARM_EG_DOCKER_IMAGE;
    process.env.SWARM_EG_DOCKER_IMAGE = 'swarm-eg-test-absent:does-not-exist';
    try {
      const outcome = await runExecutionGrounded(
        baseInput({ prDiff: SRC_DIFF, config: baseConfig({ runner: 'docker' }) }),
      );
      // The safety guarantee: an operator who asked for container isolation
      // never has the PR's code run on the host as a fallback. No checks ran.
      assert.deepEqual(outcome.findings, []);
      assert.deepEqual(outcome.mutationRuns, []);
      assert.deepEqual(outcome.coverageRuns, []);
      assert.equal(outcome.skipped.length, 1);
      assert.match(outcome.skipped[0]!, /docker|image/i);
    } finally {
      if (saved === undefined) delete process.env.SWARM_EG_DOCKER_IMAGE;
      else process.env.SWARM_EG_DOCKER_IMAGE = saved;
    }
  });
});
