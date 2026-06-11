import { strict as assert } from 'assert';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const COMPUTE = path.join(ROOT, 'dist', 'scripts', 'gate', 'compute-block-eligibility.js');
const CHECK = path.join(ROOT, 'dist', 'scripts', 'gate', 'check-block-policy.js');

// A calibration where one trigger clears the bar (40/40 confirmed reverts) and
// one does not (2/2: perfect but too rare to clear the Wilson floor).
const calibration = {
  generatedAt: '2026-01-01T00:00:00.000Z',
  rows: [
    {
      trigger: 'claim-falsified',
      firingCount: 2,
      truePositive: 2,
      falsePositive: 0,
      precision: 1,
      wilsonLowerBound: 0.34,
      truePositivePrs: ['acme/w#1', 'acme/w#2'],
    },
    {
      trigger: 'corroborated-under-constraint',
      firingCount: 0,
      truePositive: 0,
      falsePositive: 0,
      precision: 0,
      wilsonLowerBound: 0,
      truePositivePrs: [],
    },
    {
      trigger: 'obligation-failure',
      firingCount: 40,
      truePositive: 40,
      falsePositive: 0,
      precision: 1,
      wilsonLowerBound: 0.912,
      truePositivePrs: Array.from({ length: 40 }, (_unused, i) => `acme/w#${i + 10}`),
    },
    {
      // self-cert trigger (low N, would not clear circumstantial bar)
      trigger: 'test-tamper-proven',
      firingCount: 1,
      truePositive: 1,
      falsePositive: 0,
      precision: 1,
      wilsonLowerBound: 0.2,
      truePositivePrs: ['acme/w#99'],
    },
  ],
};

function runCheck(policyFile: string): { code: number; out: string } {
  try {
    const out = execFileSync('node', [CHECK, '--policy', policyFile], { encoding: 'utf8' });
    return { code: 0, out };
  } catch (err) {
    const e = err as { status?: number; stderr?: string; stdout?: string };
    return { code: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

describe('check-block-policy (CLI)', function () {
  this.timeout(20_000);
  let dir: string;
  let calFile: string;
  let policyFile: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'block-policy-'));
    calFile = path.join(dir, 'calibration.json');
    policyFile = path.join(dir, 'block-eligibility.json');
    fs.writeFileSync(calFile, JSON.stringify(calibration));
    execFileSync('node', [COMPUTE, '--calibration', calFile, '--out', policyFile], { encoding: 'utf8' });
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('marks the trigger that clears the bar plus self-certifying triggers (tier) as block-eligible', () => {
    const policy = JSON.parse(fs.readFileSync(policyFile, 'utf8'));
    // obligation clears Wilson; claim and test-tamper are self-cert (eligible by tier even low Wilson)
    assert.deepEqual(policy.blockEligibleTriggers.sort(), ['claim-falsified', 'obligation-failure', 'test-tamper-proven'].sort());
    assert.equal(policy.blockEligibleCount, 3);
  });

  it('passes on the honestly-computed file', () => {
    assert.equal(runCheck(policyFile).code, 0);
  });

  it('self-certifying tier triggers are eligible (and check passes) even when below Wilson bar', () => {
    const policy = JSON.parse(fs.readFileSync(policyFile, 'utf8'));
    const selfRow = policy.rows.find((r: any) => r.trigger === 'test-tamper-proven');
    assert.ok(selfRow);
    assert.equal(selfRow.tier, 'self-certifying');
    assert.equal(selfRow.blockEligible, true);
    // check accepts it (no Wilson enforcement for self tier)
    assert.equal(runCheck(policyFile).code, 0);
  });

  it('fails when a trigger is hand-flipped to eligible without clearing the bar', () => {
    const policy = JSON.parse(fs.readFileSync(policyFile, 'utf8'));
    // Use a circumstantial trigger (corroborated) for the Wilson bar violation test;
    // self-cert ones are allowed to be eligible by tier even with low Wilson.
    const circ = policy.rows.find((r: { trigger: string }) => r.trigger === 'corroborated-under-constraint');
    circ.blockEligible = true;
    policy.blockEligibleTriggers = ['corroborated-under-constraint', 'obligation-failure'];
    policy.blockEligibleCount = 2;
    fs.writeFileSync(policyFile, JSON.stringify(policy, null, 2));
    const result = runCheck(policyFile);
    assert.equal(result.code, 1);
    assert.match(result.out, /does not clear the bar/);
  });

  it('fails when the threshold is tuned down below the floor', () => {
    const policy = JSON.parse(fs.readFileSync(policyFile, 'utf8'));
    policy.wilsonLowerThreshold = 0.5;
    fs.writeFileSync(policyFile, JSON.stringify(policy, null, 2));
    const result = runCheck(policyFile);
    assert.equal(result.code, 1);
    assert.match(result.out, /below the fixed floor/);
  });
});
