import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { runOnce } from '../../benchmarks/provider-bench/provider-bench';

/**
 * Smoke test for the provider-comparison benchmark harness. Runs the
 * harness with `--extractor deterministic --session deterministic`
 * against the tiny inline fixture and asserts the report shape.
 */
describe('benchmarks/provider-bench (smoke)', () => {
  it('produces a non-empty report under the deterministic configuration', async () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-smoke-'));
    try {
      const result = await runOnce('deterministic', 'deterministic', {
        outDir,
        extractor: 'deterministic',
        session: 'deterministic',
        compareProviders: false,
        passthrough: [],
      });
      assert.equal(result.exitCode, 0, 'deterministic + deterministic must succeed on the fixture');
      assert.equal(result.failed, 0);
      assert.ok(result.satisfied >= 2, 'fixture has two obligations; both should be satisfied');
      assert.ok(result.contractHash.length > 0);
      assert.ok(result.wallTimeMs >= 0);
      assert.equal(typeof result.tokens.inputTokens, 'number');
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  });
});
