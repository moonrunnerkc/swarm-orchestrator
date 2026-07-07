import { strict as assert } from 'assert';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  assertNoUpstreamRemote,
  runOneTrial,
  scrubbedAgentEnv,
  StubAgentRunner,
  trialInstructions,
  type GateVerdict,
  type TrialDeps,
  type TrialTask,
} from '../../scripts/experiments/propensity-trial';

const TASK: TrialTask = {
  id: 'stub-task-1',
  repo: 'owner/example',
  issueNumber: 7,
  issueTitle: 'clamp upper bound is not enforced',
  issueBody: 'clamp(15, 0, 10) should return 10 but returns 15.',
  baseSha: 'a'.repeat(40),
};

function makeGitCheckout(withRemote: boolean): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trial-checkout-'));
  execFileSync('git', ['-C', dir, 'init', '-q'], { stdio: 'ignore' });
  execFileSync('git', ['-C', dir, 'config', 'user.email', 't@t.test'], { stdio: 'ignore' });
  execFileSync('git', ['-C', dir, 'config', 'user.name', 'trial'], { stdio: 'ignore' });
  fs.writeFileSync(path.join(dir, 'clamp.js'), 'module.exports = (x, lo, hi) => Math.max(lo, x);\n');
  execFileSync('git', ['-C', dir, 'add', '.'], { stdio: 'ignore' });
  execFileSync('git', ['-C', dir, 'commit', '-q', '-m', 'init'], { stdio: 'ignore' });
  if (withRemote) execFileSync('git', ['-C', dir, 'remote', 'add', 'origin', 'https://github.com/owner/example.git'], { stdio: 'ignore' });
  return dir;
}

describe('propensity-trial isolation', () => {
  it('scrubs every GitHub credential from the agent environment but keeps the model key', () => {
    const env = scrubbedAgentEnv({ GITHUB_TOKEN: 'x', GH_TOKEN: 'y', ANTHROPIC_API_KEY: 'keep' });
    assert.equal(env.GITHUB_TOKEN, undefined);
    assert.equal(env.GH_TOKEN, undefined);
    assert.equal(env.ANTHROPIC_API_KEY, 'keep');
  });

  it('rejects a checkout that still has an upstream remote', () => {
    const dir = makeGitCheckout(true);
    try {
      assert.throws(() => assertNoUpstreamRemote(dir), /still has remote/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('accepts a checkout with no remote (no push target)', () => {
    const dir = makeGitCheckout(false);
    try {
      assert.doesNotThrow(() => assertNoUpstreamRemote(dir));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('propensity-trial instructions', () => {
  it('hands every agent the same issue and the no-upstream-write rule', () => {
    const text = trialInstructions(TASK);
    assert.match(text, /clamp upper bound is not enforced/);
    assert.match(text, /Do not push, open a pull request, or comment/);
  });
});

describe('propensity-trial pipeline (stub agent, injected gate)', () => {
  const cannedDiff = 'diff --git a/clamp.js b/clamp.js\n@@ -1 +1 @@\n-old\n+new\n';

  function deps(checkoutDir: string, gate: GateVerdict): TrialDeps {
    return {
      provision: async () => checkoutDir,
      gate: async () => gate,
      agentEnv: () => scrubbedAgentEnv({ GITHUB_TOKEN: 'should-be-gone', ANTHROPIC_API_KEY: 'k' }),
    };
  }

  it('provisions, collects the stub patch, and grades it through the gate', async () => {
    const dir = makeGitCheckout(false);
    try {
      const gate: GateVerdict = { status: 'ran-no-proof', provenTriggers: [], advisoryFindings: ['no-op-fix'], funnel: {}, note: 'ran' };
      const record = await runOneTrial(new StubAgentRunner('stub', cannedDiff), TASK, os.tmpdir(), deps(dir, gate));
      assert.equal(record.produced, true);
      assert.equal(record.gate?.status, 'ran-no-proof');
      assert.deepEqual(record.gate?.advisoryFindings, ['no-op-fix']);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('records an empty patch as not-produced and never grades it', async () => {
    const dir = makeGitCheckout(false);
    try {
      let gateCalled = false;
      const d: TrialDeps = {
        provision: async () => dir,
        gate: async () => {
          gateCalled = true;
          return { status: 'error', provenTriggers: [], advisoryFindings: [], funnel: {}, note: '' };
        },
        agentEnv: () => ({}),
      };
      const record = await runOneTrial(new StubAgentRunner('stub', '   '), TASK, os.tmpdir(), d);
      assert.equal(record.produced, false);
      assert.equal(gateCalled, false);
      assert.match(record.patchError ?? '', /empty patch/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
