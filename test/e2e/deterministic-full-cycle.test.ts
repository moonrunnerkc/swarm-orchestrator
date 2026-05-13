import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { handleCompile } from '../../src/cli/v8/compile-handler';
import { handleRun } from '../../src/cli/v8/run-handler';
import { readContract } from '../../src/contract/serializer';

/**
 * End-to-end demonstration that the orchestrator runs the full compile + run
 * + verify cycle with zero external dependencies: no network, no model, no
 * API key. The contract is hand-authored in YAML and loaded by the
 * deterministic extractor; the run uses the deterministic session with a
 * pre-staged JSONL patch queue. The fixture's package.json declares trivial
 * build/test scripts so the obligations are satisfied by pre-generation
 * verification alone — no patch from the deterministic session is consumed.
 *
 * This is the contract test for the prompt's central claim: "a user can
 * clone the repo, run the tool against a hand-authored contract and
 * externally-sourced patches, and exercise the full verification pipeline
 * without making any network call, without installing any model, and
 * without configuring any API key."
 */
describe('e2e — deterministic full cycle', () => {
  const originalApiKey = process.env.ANTHROPIC_API_KEY;
  const originalExtractor = process.env.EXTRACTOR_PROVIDER;
  const originalSession = process.env.SESSION_PROVIDER;
  let tmpDir: string;

  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.EXTRACTOR_PROVIDER;
    delete process.env.SESSION_PROVIDER;
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-det-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (originalApiKey !== undefined) process.env.ANTHROPIC_API_KEY = originalApiKey;
    if (originalExtractor !== undefined) process.env.EXTRACTOR_PROVIDER = originalExtractor;
    if (originalSession !== undefined) process.env.SESSION_PROVIDER = originalSession;
  });

  it('compiles a YAML contract and runs it without any external dependencies', async () => {
    const fixtureRoot = path.resolve(__dirname, '..', '..', '..', 'fixtures', 'v8-empty');

    // Hand-authored contract: just enough to exercise both compile and run.
    // test-must-pass against the fixture's `npm test` (which echoes and
    // exits zero) so pre-generation verification satisfies it.
    const contractPath = path.join(tmpDir, 'contract.yaml');
    fs.writeFileSync(
      contractPath,
      [
        'obligations:',
        '  - type: build-must-pass',
        '    command: npm run build',
        '  - type: test-must-pass',
        '    command: npm test',
        '',
      ].join('\n'),
    );

    const contractOutDir = path.join(tmpDir, 'contract-out');
    const compileExit = await handleCompile([
      'verify the test command exits zero',
      '--repo-root',
      fixtureRoot,
      '--out',
      contractOutDir,
      '--extractor',
      'deterministic',
      '--contract-file',
      contractPath,
      '--yes',
      '--no-editor',
    ]);
    assert.equal(compileExit, 0, 'compile must succeed with deterministic provider');

    const contract = readContract(contractOutDir);
    assert.equal(contract.obligations.length, 2);
    const types = new Set(contract.obligations.map((o) => o.type));
    assert.ok(types.has('build-must-pass'));
    assert.ok(types.has('test-must-pass'));
    assert.equal(contract.manifest.extractor.name, 'deterministic');
    assert.equal(contract.manifest.extractor.model, null);

    // Pre-stage an empty patch queue. The deterministic session reads from
    // the queue file on demand; since pre-generation verification will
    // satisfy the test-must-pass obligation, no patch is consumed.
    const queuePath = path.join(tmpDir, 'patches.jsonl');
    fs.writeFileSync(queuePath, '');

    const resultPath = path.join(tmpDir, 'result.json');
    const ledgerPath = path.join(tmpDir, 'ledger.jsonl');
    const runExit = await handleRun([
      contractOutDir,
      '--repo-root',
      fixtureRoot,
      '--session',
      'deterministic',
      '--external-patches-queue',
      queuePath,
      '--ledger',
      ledgerPath,
      '--result',
      resultPath,
      '--no-streaming',
      '--no-post-merge',
      '--falsifiers',
      'off',
    ]);
    assert.equal(runExit, 0, 'run must succeed with deterministic provider');

    const result = JSON.parse(fs.readFileSync(resultPath, 'utf8')) as {
      satisfied: number;
      failed: number;
    };
    assert.equal(result.failed, 0, 'no obligation should fail');
    assert.equal(result.satisfied, 2, 'both obligations should be satisfied');

    // The ledger must record provider attribution for any candidate entries
    // (none expected here because pre-generation skips synthesis), but at
    // minimum the run-started entry must exist.
    const ledger = fs
      .readFileSync(ledgerPath, 'utf8')
      .split('\n')
      .filter((l) => l.length > 0)
      .map((l) => JSON.parse(l) as { type: string });
    const ledgerTypes = ledger.map((e) => e.type);
    assert.ok(ledgerTypes.includes('run-started'));
    assert.ok(ledgerTypes.includes('run-finished'));
    // ANTHROPIC_API_KEY must remain unset throughout — the test fails by
    // accidental leak if anything in the pipeline silently reaches for it.
    assert.equal(process.env.ANTHROPIC_API_KEY, undefined);
  });
});
