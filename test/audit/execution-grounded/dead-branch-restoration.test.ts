import { strict as assert } from 'assert';
import {
  addedLineNumbers,
  resolveDeadBranch,
  instrumentSource,
  readSentinel,
  classifyDeadBranchRestoration,
  buildDeadBranchReproduceCommand,
  runDeadBranchRestoration,
  BRANCH_MARKER,
  CONTROL_MARKER,
  type ResolvedDeadBranch,
} from '../../../src/audit/execution-grounded/dead-branch-restoration';

const HEAD_FILE = [
  'function compute(x) {', // line 1
  '  if (false) {', //         line 2
  '    return -1;', //         line 3
  '  }', //                    line 4
  '  return x.a + x.b;', //    line 5
  '}', //                      line 6
  'module.exports = { compute };',
  '',
].join('\n');

const DIFF = [
  'diff --git a/src/totals.js b/src/totals.js',
  'index 1111111..2222222 100644',
  '--- a/src/totals.js',
  '+++ b/src/totals.js',
  '@@ -1,3 +1,6 @@',
  ' function compute(x) {',
  '+  if (false) {',
  '+    return -1;',
  '+  }',
  '   return x.a + x.b;',
  ' }',
  '',
].join('\n');

describe('audit/execution-grounded/dead-branch-restoration (pure core)', () => {
  describe('addedLineNumbers', () => {
    it('returns the new-file line numbers the diff adds', () => {
      const added = addedLineNumbers(DIFF, 'src/totals.js');
      assert.ok(added.has(2), 'the inserted `if` line is added');
      assert.ok(added.has(3));
      assert.ok(added.has(4));
      assert.ok(!added.has(1), 'the unchanged context line is not added');
    });
    it('returns empty for a file the diff does not touch', () => {
      assert.equal(addedLineNumbers(DIFF, 'src/other.js').size, 0);
    });
  });

  describe('resolveDeadBranch', () => {
    it('resolves a single inserted if-branch with a block body at the finding line', () => {
      const r = resolveDeadBranch(HEAD_FILE, 'src/totals.js', 2, addedLineNumbers(DIFF, 'src/totals.js'));
      assert.ok(r !== null);
      assert.equal(r!.condition, 'false');
      assert.equal(r!.ifLine, 2);
      // The branch probe offset is just inside the then-block brace.
      assert.equal(HEAD_FILE[r!.branchProbeOffset - 1], '{');
      // The control probe offset is at the `if` keyword.
      assert.equal(HEAD_FILE.slice(r!.controlProbeOffset, r!.controlProbeOffset + 2), 'if');
    });
    it('returns null when the finding line is not an added line (pre-existing branch)', () => {
      assert.equal(resolveDeadBranch(HEAD_FILE, 'src/totals.js', 2, new Set()), null);
    });
    it('returns null when the finding line has no if-statement', () => {
      const added = addedLineNumbers(DIFF, 'src/totals.js');
      assert.equal(resolveDeadBranch(HEAD_FILE, 'src/totals.js', 5, added), null);
    });
    it('returns null for an if whose then-clause is not a block (fail closed)', () => {
      const file = 'function f(x) {\n  if (false) return -1;\n  return x;\n}\n';
      assert.equal(resolveDeadBranch(file, 'src/f.js', 2, new Set([2])), null);
    });
  });

  describe('instrumentSource', () => {
    const resolved: ResolvedDeadBranch = resolveDeadBranch(
      HEAD_FILE,
      'src/totals.js',
      2,
      addedLineNumbers(DIFF, 'src/totals.js'),
    )!;
    const out = instrumentSource(HEAD_FILE, resolved, '/tmp/sent');

    it('injects exactly one branch probe and one control probe', () => {
      const branchProbes = out.split(`${JSON.stringify(BRANCH_MARKER)});`).length - 1;
      const controlProbes = out.split(`${JSON.stringify(CONTROL_MARKER)});`).length - 1;
      assert.equal(branchProbes, 1);
      assert.equal(controlProbes, 1);
    });
    it('bakes the sentinel path into the probes', () => {
      assert.ok(out.includes('/tmp/sent'));
    });
    it('keeps the control probe before the branch probe in source order', () => {
      assert.ok(out.indexOf(CONTROL_MARKER) < out.indexOf(BRANCH_MARKER));
    });
    it('leaves the rest of the file intact (the original body survives)', () => {
      assert.ok(out.includes('return x.a + x.b;'));
      assert.ok(out.includes('module.exports = { compute };'));
    });
  });

  describe('readSentinel', () => {
    it('reads control and branch markers independently', () => {
      assert.deepEqual(readSentinel(''), { controlFired: false, branchFired: false });
      assert.deepEqual(readSentinel('P'), { controlFired: true, branchFired: false });
      assert.deepEqual(readSentinel('PB'), { controlFired: true, branchFired: true });
      assert.deepEqual(readSentinel('B'), { controlFired: false, branchFired: true });
    });
  });

  describe('classifyDeadBranchRestoration (fail-closed)', () => {
    const ctl = { controlFired: true, branchFired: false };
    it('suite already failing is not proven', () => {
      assert.equal(
        classifyDeadBranchRestoration({ suitePassesAsSubmitted: false, run1: ctl, run2: ctl }).verdict,
        'not-proven:suite-already-failing',
      );
    });
    it('a branch that fired in either run refutes', () => {
      assert.equal(
        classifyDeadBranchRestoration({
          suitePassesAsSubmitted: true,
          run1: { controlFired: true, branchFired: true },
          run2: ctl,
        }).verdict,
        'refuted',
      );
    });
    it('a control that never fired is not proven (the if was never evaluated)', () => {
      assert.equal(
        classifyDeadBranchRestoration({
          suitePassesAsSubmitted: true,
          run1: { controlFired: false, branchFired: false },
          run2: ctl,
        }).verdict,
        'not-proven:control-not-reached',
      );
    });
    it('control fired both runs and branch never fired is proven', () => {
      assert.equal(
        classifyDeadBranchRestoration({ suitePassesAsSubmitted: true, run1: ctl, run2: ctl }).verdict,
        'proven',
      );
    });
  });

  describe('buildDeadBranchReproduceCommand', () => {
    const ok = {
      prRef: 'acme/totals#1',
      prHeadSha: 'a'.repeat(40),
      testFiles: ['test/totals.test.js'],
      testRunner: 'mocha' as const,
      branchFile: 'src/totals.js',
      branchLine: 2,
      branchCondition: 'false',
    };
    it('builds a coverage command that names the branch line', () => {
      const cmd = buildDeadBranchReproduceCommand(ok);
      assert.ok(cmd.includes('git fetch origin pull/1/head'));
      assert.ok(cmd.includes('npx c8 mocha test/totals.test.js'));
      assert.ok(cmd.includes('src/totals.js:2'));
    });
    it('throws on an unsafe head sha', () => {
      assert.throws(() => buildDeadBranchReproduceCommand({ ...ok, prHeadSha: 'not a sha; rm -rf /' }));
    });
    it('throws on an unsafe test path', () => {
      assert.throws(() => buildDeadBranchReproduceCommand({ ...ok, testFiles: ['../../../etc/passwd'] }));
    });
    it('throws for a runner with no locked coverage invocation', () => {
      assert.throws(() => buildDeadBranchReproduceCommand({ ...ok, testRunner: 'ava' as const }));
    });
  });

  describe('runDeadBranchRestoration (orchestrator early exits, no sandbox)', () => {
    const baseInput = {
      finding: { category: 'dead-branch-insertion' as const, file: 'src/totals.js', line: 2 },
      prDiff: DIFF,
      prRef: 'acme/totals#1',
      prHeadSha: 'a'.repeat(40),
      postWorkspacePath: '/nonexistent-swarm-ws',
      repoRoot: '/nonexistent-swarm-ws',
      testRunner: 'mocha' as const,
      packageManager: 'npm' as const,
      timeoutMs: 1000,
    };
    it('fails closed on a non-source finding file', () => {
      const r = runDeadBranchRestoration({
        ...baseInput,
        finding: { category: 'dead-branch-insertion', file: 'README.md', line: 2 },
      });
      assert.equal(r.verdict, 'not-proven:non-source-file');
      assert.equal(r.controls.branchResolved, null);
    });
    it('fails closed when the workspace file cannot be read', () => {
      const r = runDeadBranchRestoration(baseInput);
      assert.equal(r.verdict, 'not-proven:no-dead-branch');
    });
    it('never throws and always returns a record', () => {
      const r = runDeadBranchRestoration({ ...baseInput, prDiff: 'not a diff' });
      assert.ok(typeof r.verdict === 'string');
      assert.equal(r.category, 'dead-branch-insertion');
    });
  });
});
