import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  baseSideVerdict,
  classifyClaimDifferential,
  headVerdict,
  runClaimDifferential,
} from '../../../src/audit/execution-grounded/claim-differential';
import {
  buildClaimText,
  compileWitness,
  arbiterPairAgrees,
  evaluateClosureControl,
  type ClaimWitness,
  type Completer,
  type WitnessArbiter,
} from '../../../src/audit/execution-grounded/claim-witness';
import { claimDifferentialFindings } from '../../../src/audit/execution-grounded';
import { loadAuditConfig } from '../../../src/audit/cheat-detector/audit-config';
import * as fsMod from 'fs';
import * as osMod from 'os';
import * as pathMod from 'path';

const GREEN = { arbiterAgreed: true, closureLinked: true as boolean | null };

describe('classifyClaimDifferential verdict table', () => {
  it('base fails, head passes -> claim-delivered', () => {
    assert.equal(
      classifyClaimDifferential({ ...GREEN, baseRun1: 'failed', baseRun2: 'failed', headStatus: 'passed' }),
      'claim-delivered',
    );
  });

  it('base fails, head fails -> claim-falsified-synthesized (the one finding)', () => {
    assert.equal(
      classifyClaimDifferential({ ...GREEN, baseRun1: 'failed', baseRun2: 'failed', headStatus: 'failed' }),
      'claim-falsified-synthesized',
    );
  });

  it('base passes -> abstain:base-passes (claimed defect absent, witness invalid)', () => {
    assert.equal(
      classifyClaimDifferential({ ...GREEN, baseRun1: 'passed', baseRun2: 'passed', headStatus: 'failed' }),
      'abstain:base-passes',
    );
  });

  it('arbiter split -> abstain:arbiter-disagreement, never a finding', () => {
    assert.equal(
      classifyClaimDifferential({
        arbiterAgreed: false,
        closureLinked: true,
        baseRun1: 'failed',
        baseRun2: 'failed',
        headStatus: 'failed',
      }),
      'abstain:arbiter-disagreement',
    );
  });

  it('flaky base (one fail, one pass) -> abstain:flaky-base', () => {
    assert.equal(
      classifyClaimDifferential({ ...GREEN, baseRun1: 'failed', baseRun2: 'passed', headStatus: 'failed' }),
      'abstain:flaky-base',
    );
  });

  it('witness errored on base -> abstain:witness-not-runnable', () => {
    assert.equal(
      classifyClaimDifferential({ ...GREEN, baseRun1: 'errored', baseRun2: 'failed', headStatus: 'failed' }),
      'abstain:witness-not-runnable',
    );
  });

  it('unlinked closure blocks a finding even when base fails and head fails', () => {
    assert.equal(
      classifyClaimDifferential({
        arbiterAgreed: true,
        closureLinked: false,
        baseRun1: 'failed',
        baseRun2: 'failed',
        headStatus: 'failed',
      }),
      'abstain:closure-unlinked',
    );
    assert.equal(
      classifyClaimDifferential({
        arbiterAgreed: true,
        closureLinked: null,
        baseRun1: 'failed',
        baseRun2: 'failed',
        headStatus: 'failed',
      }),
      'abstain:closure-unlinked',
    );
  });

  it('head timeout after a clean base -> abstain:execution-error, not a finding', () => {
    assert.equal(
      classifyClaimDifferential({ ...GREEN, baseRun1: 'failed', baseRun2: 'failed', headStatus: 'timeout' }),
      'abstain:execution-error',
    );
  });
});

describe('baseSideVerdict short-circuit', () => {
  it('signals run-head only when the base side is fully clean', () => {
    assert.equal(
      baseSideVerdict({ arbiterAgreed: true, closureLinked: true, baseRun1: 'failed', baseRun2: 'failed' }),
      'run-head',
    );
  });
  it('never signals run-head on a passing base (no head run wasted)', () => {
    assert.notEqual(
      baseSideVerdict({ arbiterAgreed: true, closureLinked: true, baseRun1: 'passed', baseRun2: 'passed' }),
      'run-head',
    );
  });
});

describe('headVerdict', () => {
  it('maps head status to delivered / falsified / execution-error', () => {
    assert.equal(headVerdict('passed'), 'claim-delivered');
    assert.equal(headVerdict('failed'), 'claim-falsified-synthesized');
    assert.equal(headVerdict('errored'), 'abstain:execution-error');
  });
});

describe('buildClaimText', () => {
  it('joins PR and linked-issue text and drops empties', () => {
    const claim = buildClaimText({ prTitle: 'Fix off-by-one', prBody: '', issueBody: 'crashes on n=0' });
    assert.ok(claim.includes('Fix off-by-one'));
    assert.ok(claim.includes('crashes on n=0'));
    assert.equal(buildClaimText({ prTitle: '', prBody: '' }), '');
  });
});

describe('compileWitness (injected LLM)', () => {
  const codeBlock = ['```js', "const assert = require('assert');", 'it("adds", () => { assert.equal(add(1,2), 3); });', '```'].join('\n');

  it('extracts a runnable test witness and records provenance', async () => {
    const complete: Completer = async () => ({ text: `here is the test\n${codeBlock}`, model: 'stub-model' });
    const witness = await compileWitness('add(a,b) returns a+b', complete);
    assert.ok(witness !== null);
    assert.equal(witness!.repro.kind, 'test');
    assert.equal(witness!.model, 'stub-model');
    assert.equal(witness!.promptVersion, 'cw-v1');
    assert.equal(witness!.promptHash.length, 64, 'prompt hash is a sha256 hex digest');
    assert.equal(witness!.witnessHash.length, 64);
  });

  it('fails closed to null when the completion carries no runnable test', async () => {
    const complete: Completer = async () => ({ text: 'I cannot write that test.', model: 'stub' });
    assert.equal(await compileWitness('claim', complete), null);
  });
});

describe('arbiterPairAgrees', () => {
  const yes: WitnessArbiter = async () => ({ yes: true, model: 'a' });
  const no: WitnessArbiter = async () => ({ yes: false, model: 'b' });

  it('agrees only when both arbiters say yes', async () => {
    assert.equal((await arbiterPairAgrees('c', 'w', yes, yes)).agreed, true);
    assert.equal((await arbiterPairAgrees('c', 'w', yes, no)).agreed, false);
    assert.equal((await arbiterPairAgrees('c', 'w', no, no)).agreed, false);
  });
});

describe('evaluateClosureControl', () => {
  it('returns linked=false for a purely-additive diff (no revertable source)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-closure-'));
    try {
      const additiveDiff = [
        'diff --git a/src/new.js b/src/new.js',
        '--- /dev/null',
        '+++ b/src/new.js',
        '@@ -0,0 +1 @@',
        '+export const x = 1;',
        '',
      ].join('\n');
      const witness: ClaimWitness = {
        repro: { kind: 'test', language: 'js', code: 'it("x", () => {});' },
        model: 'm',
        promptVersion: 'cw-v1',
        promptHash: 'h',
        witnessHash: 'w',
      };
      const control = evaluateClosureControl(dir, witness, additiveDiff);
      assert.equal(control.linked, false);
      assert.equal(control.revertableCount, 0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('runClaimDifferential orchestration (no workspace)', () => {
  it('abstains with no-claim when the PR has no claim text', async () => {
    const result = await runClaimDifferential({
      prDiff: '',
      prTitle: '',
      prBody: '',
      preWorkspacePath: '/nonexistent',
      postWorkspacePath: '/nonexistent',
      testRunner: null,
      complete: async () => ({ text: '', model: 'm' }),
      arbiterA: async () => ({ yes: true, model: 'a' }),
      arbiterB: async () => ({ yes: true, model: 'b' }),
    });
    assert.equal(result.verdict, 'abstain:no-claim');
    assert.equal(result.isFinding, false);
  });

  it('abstains with witness-not-compiled when the LLM writes no test', async () => {
    const result = await runClaimDifferential({
      prDiff: 'diff',
      prTitle: 'Fix it',
      prBody: 'this fixes the bug',
      preWorkspacePath: '/nonexistent',
      postWorkspacePath: '/nonexistent',
      testRunner: null,
      complete: async () => ({ text: 'no code here', model: 'm' }),
      arbiterA: async () => ({ yes: true, model: 'a' }),
      arbiterB: async () => ({ yes: true, model: 'b' }),
    });
    assert.equal(result.verdict, 'abstain:witness-not-compiled');
    assert.equal(result.isFinding, false);
  });
});

describe('claimDifferentialFindings mapper', () => {
  it('raises one advisory warn finding for a claim-falsified-synthesized verdict', () => {
    const findings = claimDifferentialFindings(
      {
        verdict: 'claim-falsified-synthesized',
        isFinding: true,
        reason: 'r',
        witness: { model: 'm', promptVersion: 'cw-v1', promptHash: 'p', witnessHash: 'w' },
        baseRuns: ['failed', 'failed'],
        headStatus: 'failed',
        reproduceCommand: 'npx mocha __swarm_repro__.test.js',
      },
      'owner/repo#1',
    );
    assert.equal(findings.length, 1);
    assert.equal(findings[0]!.category, 'claim-falsified-synthesized');
    assert.equal(findings[0]!.severity, 'warn');
    assert.ok(findings[0]!.message.includes('npx mocha'));
  });

  it('raises no finding for a claim-delivered or any abstain verdict', () => {
    assert.deepEqual(
      claimDifferentialFindings({ verdict: 'claim-delivered', isFinding: false, reason: '' }, 'o/r#1'),
      [],
    );
    assert.deepEqual(
      claimDifferentialFindings({ verdict: 'abstain:base-passes', isFinding: false, reason: '' }, 'o/r#1'),
      [],
    );
  });
});

describe('audit-config claimDifferential knob', () => {
  it('is off by default and parses an opt-in enable', () => {
    const dir = fsMod.mkdtempSync(pathMod.join(osMod.tmpdir(), 'cd-cfg-'));
    try {
      assert.equal(loadAuditConfig(dir).executionGrounded.claimDifferential, false);
      fsMod.mkdirSync(pathMod.join(dir, '.swarm'), { recursive: true });
      fsMod.writeFileSync(
        pathMod.join(dir, '.swarm', 'audit-config.yaml'),
        'executionGrounded:\n  enabled: true\n  claimDifferential: true\n',
      );
      assert.equal(loadAuditConfig(dir).executionGrounded.claimDifferential, true);
    } finally {
      fsMod.rmSync(dir, { recursive: true, force: true });
    }
  });
});
