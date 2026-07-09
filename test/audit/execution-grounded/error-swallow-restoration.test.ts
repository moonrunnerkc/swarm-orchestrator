import { strict as assert } from 'node:assert';
import {
  neutralizeErrorSwallow,
  classifyErrorSwallow,
} from '../../../src/audit/execution-grounded/error-swallow-restoration';

describe('neutralizeErrorSwallow', () => {
  it('rewrites an empty JS catch with a binding to rethrow it', () => {
    const out = neutralizeErrorSwallow('try { f(); } catch (e) {} return 1;');
    assert.ok(out);
    assert.equal(out.id, 'catch-binding');
    assert.match(out.source, /catch \(e\) \{ throw e; \}/);
  });

  it('rewrites a bindingless JS catch by introducing a binding', () => {
    const out = neutralizeErrorSwallow('try { f(); } catch {} return 1;');
    assert.ok(out);
    assert.equal(out.id, 'catch-bindingless');
    assert.match(out.source, /catch \(swallowedErr\) \{ throw swallowedErr; \}/);
  });

  it('rewrites a two-line except: pass to raise, preserving indentation', () => {
    const src = 'def f():\n    try:\n        g()\n    except Exception:\n        pass\n    return 1\n';
    const out = neutralizeErrorSwallow(src);
    assert.ok(out);
    assert.equal(out.id, 'except-pass');
    assert.match(out.source, / {4}except Exception:\n {8}raise\n/);
    assert.doesNotMatch(out.source, /pass/);
  });

  it('rewrites except ... as e: pass to raise', () => {
    const src = 'def f():\n    try:\n        g()\n    except ValueError as e:\n        pass\n';
    const out = neutralizeErrorSwallow(src);
    assert.ok(out);
    assert.match(out.source, /except ValueError as e:\n {8}raise/);
  });

  it('does not touch a catch with a real body (a logger call)', () => {
    assert.equal(neutralizeErrorSwallow('try { f(); } catch (e) { console.log(e); }'), null);
  });

  it('does not touch an except with a real body', () => {
    assert.equal(
      neutralizeErrorSwallow('def f():\n    try:\n        g()\n    except Exception:\n        log(e)\n'),
      null,
    );
  });

  it('rewrites only the first swallow, leaving a second defensive catch intact', () => {
    const src = 'try { a(); } catch (e) {}\ntry { b(); } catch (x) {}';
    const out = neutralizeErrorSwallow(src);
    assert.ok(out);
    assert.match(out.source, /catch \(e\) \{ throw e; \}/);
    assert.match(out.source, /catch \(x\) \{\}/);
  });
});

describe('classifyErrorSwallow', () => {
  const base = { run1FailingTests: ['t'], run2FailingTests: ['t'] };

  it('proves when the neutralized suite fails twice with the same identity', () => {
    const out = classifyErrorSwallow({
      suitePassesAsSubmitted: true,
      neutralizedRun1Failed: true,
      neutralizedRun2Failed: true,
      ...base,
    });
    assert.equal(out.verdict, 'proven');
    assert.deepEqual(out.failingTests, ['t']);
  });

  it('refutes when the neutralized suite still passes', () => {
    const out = classifyErrorSwallow({
      suitePassesAsSubmitted: true,
      neutralizedRun1Failed: false,
      neutralizedRun2Failed: false,
      run1FailingTests: [],
      run2FailingTests: [],
    });
    assert.equal(out.verdict, 'refuted');
  });

  it('does not prove when the suite already fails as submitted', () => {
    const out = classifyErrorSwallow({
      suitePassesAsSubmitted: false,
      neutralizedRun1Failed: true,
      neutralizedRun2Failed: true,
      ...base,
    });
    assert.equal(out.verdict, 'not-proven:suite-already-failing');
  });

  it('does not prove on a flaky split or divergent identity', () => {
    assert.equal(
      classifyErrorSwallow({
        suitePassesAsSubmitted: true,
        neutralizedRun1Failed: true,
        neutralizedRun2Failed: false,
        ...base,
      }).verdict,
      'not-proven:flaky',
    );
    assert.equal(
      classifyErrorSwallow({
        suitePassesAsSubmitted: true,
        neutralizedRun1Failed: true,
        neutralizedRun2Failed: true,
        run1FailingTests: ['a'],
        run2FailingTests: ['b'],
      }).verdict,
      'not-proven:flaky',
    );
  });
});
