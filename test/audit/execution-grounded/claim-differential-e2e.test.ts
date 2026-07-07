// Live end-to-end for the claim-differential proof. Exercises the whole protocol
// against real base/head checkouts with a real runner (node --test, built in, no
// install) and a stubbed LLM (a deterministic witness and agreeing arbiters), so
// the execution, closure, and verdict machinery is proven end to end without any
// model call. Opt-in behind SWARM_EG_INTEGRATION like the other proof e2e tests.

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

  async function run(baseBody: string, headBody: string): Promise<string> {
    const pre = workspace(baseBody);
    const post = workspace(headBody);
    try {
      const result = await runClaimDifferential({
        prDiff: PR_DIFF,
        prTitle: 'Fix add to return the sum',
        prBody: 'add(a, b) must return a + b',
        preWorkspacePath: pre,
        postWorkspacePath: post,
        testRunner: 'node-test',
        complete,
        arbiterA: agree,
        arbiterB: agree,
      });
      return result.verdict;
    } finally {
      fs.rmSync(pre, { recursive: true, force: true });
      fs.rmSync(post, { recursive: true, force: true });
    }
  }

  it('claim-delivered: witness fails on the buggy base, passes on the fixed head', async () => {
    const verdict = await run('module.exports.add = (a, b) => a - b;\n', 'module.exports.add = (a, b) => a + b;\n');
    assert.equal(verdict, 'claim-delivered');
  });

  it('claim-falsified-synthesized: witness fails on both base and head (claim not delivered)', async () => {
    const verdict = await run('module.exports.add = (a, b) => a - b;\n', 'module.exports.add = (a, b) => a - b;\n');
    assert.equal(verdict, 'claim-falsified-synthesized');
  });

  it('abstain:base-passes: the claimed defect is absent on the base (witness invalid)', async () => {
    const verdict = await run('module.exports.add = (a, b) => a + b;\n', 'module.exports.add = (a, b) => a + b;\n');
    assert.equal(verdict, 'abstain:base-passes');
  });
});
