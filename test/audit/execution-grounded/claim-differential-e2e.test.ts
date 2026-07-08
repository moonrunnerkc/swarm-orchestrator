// Live end-to-end for the claim-differential proof. Exercises the whole protocol
// against real base/head checkouts with a real runner (node --test, built in, no
// install) and a stubbed LLM (a deterministic witness and agreeing arbiters), so
// the execution, closure, and discrimination-control machinery is proven end to
// end without any model call. Opt-in behind SWARM_EG_INTEGRATION like the other
// proof e2e tests.
//
// The discrimination control means a witness that fails on both base and head
// fires `claim-falsified-synthesized` ONLY when it is shown capable of passing on
// a correct implementation (the honest twin). In production (no honest twin) that
// same case abstains at the pass-capability clause, which is the Hunt 4 outline
// fix: an identical everywhere-failure no longer fires on its own.

import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runClaimDifferential } from '../../../src/audit/execution-grounded/claim-differential';
import type { Completer, WitnessArbiter } from '../../../src/audit/execution-grounded/claim-witness';

const INTEGRATION = process.env.SWARM_EG_INTEGRATION === '1';

const WITNESS = [
  '```js',
  "const { test } = require('node:test');",
  "const assert = require('node:assert');",
  "const { add } = require('./calc');",
  "test('add returns a + b', () => { assert.strictEqual(add(1, 2), 3); });",
  '```',
].join('\n');

const complete: Completer = async () => ({ text: `here is the witness\n${WITNESS}`, model: 'stub-witness' });
const agree: WitnessArbiter = async () => ({ yes: true, model: 'stub-arbiter' });

// A diff that MODIFIES calc.js (a del line), so it is behaviorally revertable and
// the witness closure can link to it.
const PR_DIFF = [
  'diff --git a/calc.js b/calc.js',
  '--- a/calc.js',
  '+++ b/calc.js',
  '@@ -1 +1 @@',
  '-module.exports.add = (a, b) => a - b;',
  '+module.exports.add = (a, b) => a + b;',
  '',
].join('\n');

function workspace(calcBody: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cd-e2e-'));
  fs.writeFileSync(path.join(dir, 'calc.js'), calcBody);
  return dir;
}

(INTEGRATION ? describe : describe.skip)('claim-differential e2e (live node --test)', function () {
  this.timeout(120_000);

  const BUGGY = 'module.exports.add = (a, b) => a - b;\n';
  const FIXED = 'module.exports.add = (a, b) => a + b;\n';

  async function run(baseBody: string, headBody: string, honestTwinBody?: string): Promise<string> {
    const pre = workspace(baseBody);
    const post = workspace(headBody);
    const twin = honestTwinBody !== undefined ? workspace(honestTwinBody) : undefined;
    try {
      const result = await runClaimDifferential({
        prDiff: PR_DIFF,
        prTitle: 'Fix add to return the sum',
        prBody: 'add(a, b) must return a + b',
        preWorkspacePath: pre,
        postWorkspacePath: post,
        ...(twin !== undefined ? { honestTwinWorkspacePath: twin } : {}),
        testRunner: 'node-test',
        complete,
        arbiterA: agree,
        arbiterB: agree,
      });
      return result.verdict;
    } finally {
      fs.rmSync(pre, { recursive: true, force: true });
      fs.rmSync(post, { recursive: true, force: true });
      if (twin !== undefined) fs.rmSync(twin, { recursive: true, force: true });
    }
  }

  it('claim-delivered: witness fails on the buggy base, passes on the fixed head', async () => {
    assert.equal(await run(BUGGY, FIXED), 'claim-delivered');
  });

  it('abstain:no-pass-capability-evidence: both base and head fail, but production has no honest twin (the outline fix)', async () => {
    assert.equal(await run(BUGGY, BUGGY), 'abstain:no-pass-capability-evidence');
  });

  it('claim-falsified-synthesized: both fail AND the witness passes on the honest twin (pass-capability established)', async () => {
    assert.equal(await run(BUGGY, BUGGY, FIXED), 'claim-falsified-synthesized');
  });

  it('abstain:no-pass-capability-evidence: both fail and the witness cannot pass on the honest twin either', async () => {
    // The honest twin is still buggy, so the witness never passes anywhere: it is
    // not shown capable of passing on a correct implementation. This is the exact
    // shape of the outline false positive, and the control refuses it.
    assert.equal(await run(BUGGY, BUGGY, BUGGY), 'abstain:no-pass-capability-evidence');
  });

  it('abstain:base-passes: the claimed defect is absent on the base (witness invalid)', async () => {
    assert.equal(await run(FIXED, FIXED), 'abstain:base-passes');
  });
});
