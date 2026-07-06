import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  runMergeGateForPr,
  type PrProvisioner,
  type ProvisionedWorkspace,
} from '../../../src/cli/v8/merge-gate-runner';

const PASS_TEST =
  "const { test } = require('node:test');\n" +
  "const assert = require('node:assert');\n" +
  "test('ok', () => { assert.equal(1, 1); });\n";

// A provisioner that materializes a local green Node workspace instead of
// cloning from GitHub, and records whether cleanup ran.
function localGreenProvisioner(cleanupCalls: { count: number }): PrProvisioner {
  return () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-gate-pr-'));
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: 'fixture', scripts: { test: 'node --test' } }),
    );
    fs.writeFileSync(path.join(dir, 'package-lock.json'), '{}');
    fs.writeFileSync(path.join(dir, 'app.test.js'), PASS_TEST);
    const workspace: ProvisionedWorkspace = {
      workspacePath: dir,
      cleanup: () => {
        cleanupCalls.count += 1;
        fs.rmSync(dir, { recursive: true, force: true });
      },
    };
    return workspace;
  };
}

const PR = { number: 7, repository: 'acme/widget', headSha: 'deadbeef', baseSha: 'cafebabe' };
const TIMEOUT_MS = 60_000;

describe('cli/v8/merge-gate-runner runMergeGateForPr', function () {
  this.timeout(TIMEOUT_MS);

  it('provisions a green tree and auto-merges, then cleans up', () => {
    const cleanupCalls = { count: 0 };
    const outcome = runMergeGateForPr({
      prMetadata: PR,
      negativeGateClean: true,
      negativeGateDetail: '',
      commandTimeoutMs: TIMEOUT_MS,
      provision: localGreenProvisioner(cleanupCalls),
    });
    assert.equal(outcome.decision.verdict, 'auto-merge');
    assert.equal(cleanupCalls.count, 1);
  });

  it('fails closed to HUMAN when provisioning throws', () => {
    const outcome = runMergeGateForPr({
      prMetadata: PR,
      negativeGateClean: true,
      negativeGateDetail: '',
      provision: () => {
        throw new Error('fetch failed: 404');
      },
    });
    assert.equal(outcome.decision.verdict, 'human');
    assert.ok(
      outcome.decision.reasons.some(
        (r) => r.code === 'positive-control-unavailable' && /could not provision/.test(r.detail),
      ),
    );
  });

  it('carries a blocked negative gate through to HUMAN', () => {
    const cleanupCalls = { count: 0 };
    const outcome = runMergeGateForPr({
      prMetadata: PR,
      negativeGateClean: false,
      negativeGateDetail: 'test-tamper-proven',
      commandTimeoutMs: TIMEOUT_MS,
      provision: localGreenProvisioner(cleanupCalls),
    });
    assert.equal(outcome.decision.verdict, 'human');
    assert.ok(outcome.decision.reasons.some((r) => r.code === 'negative-gate-blocked'));
    // The tree is still provisioned and cleaned up.
    assert.equal(cleanupCalls.count, 1);
  });
});
