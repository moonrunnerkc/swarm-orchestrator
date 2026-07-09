import { strict as assert } from 'node:assert';
import {
  bindClaimToExistingTest,
  type ExistingTest,
} from '../../../src/audit/execution-grounded/claim-binding';
import { summarize } from '../../../scripts/gate/measure-claim-binding';

const tests: ExistingTest[] = [
  { file: 'test_parser.py', testName: 'test_parses_nested_arrays', referencedSymbols: ['parseArray', 'tokenize'] },
  { file: 'test_login.py', testName: 'test_login_flow', referencedSymbols: ['login'] },
];

describe('bindClaimToExistingTest', () => {
  it('binds a claim to the test whose symbol and name it names, not an unrelated test', () => {
    const bindings = bindClaimToExistingTest('Fix parseArray to handle nested arrays per the issue', tests);
    assert.equal(bindings.length, 1);
    assert.equal(bindings[0]!.test.file, 'test_parser.py');
    assert.ok(bindings[0]!.score >= 5);
  });

  it('ranks a verbatim test-name reference above a symbol/keyword-only match', () => {
    const two: ExistingTest[] = [
      { file: 'a.py', testName: 'test_alpha_beta', referencedSymbols: ['alpha'] },
      { file: 'b.py', testName: 'test_beta_flow', referencedSymbols: ['beta'] },
    ];
    const bindings = bindClaimToExistingTest('Fix test_alpha_beta as described; the beta flow is affected', two);
    assert.equal(bindings.length, 2);
    assert.equal(bindings[0]!.test.file, 'a.py');
    assert.ok(bindings[0]!.score > bindings[1]!.score);
  });

  it('returns no binding when the claim references nothing the tests cover', () => {
    assert.deepEqual(bindClaimToExistingTest('Bump the CI cache key', tests), []);
  });

  it('is deterministic: equal scores break ties by test file', () => {
    const two: ExistingTest[] = [
      { file: 'z_mod.py', testName: 'test_alpha', referencedSymbols: ['alpha'] },
      { file: 'a_mod.py', testName: 'test_alpha', referencedSymbols: ['alpha'] },
    ];
    const bindings = bindClaimToExistingTest('fix alpha', two);
    assert.equal(bindings[0]!.test.file, 'a_mod.py');
  });
});

describe('measure-claim-binding summarize', () => {
  it('reports zero honest false positives, full recall, and full no-green abstain on ideal outcomes', () => {
    const outcomes = [
      { twinId: 't1', mode: 'honest' as const, verdict: 'claim-delivered' },
      { twinId: 't1', mode: 'cheat-bound' as const, verdict: 'claim-falsified-bound' },
      { twinId: 't1', mode: 'cheat-no-green' as const, verdict: 'abstain:no-pass-capability-evidence' },
    ];
    const s = summarize(outcomes);
    assert.equal(s.honestFalsePositives.hits, 0);
    assert.equal(s.cheatBoundRecall.hits, 1);
    assert.equal(s.noGreenAbstain.hits, 1);
    assert.equal(s.separation, 1);
    assert.equal(s.unexpected.length, 0);
  });

  it('flags an unexpected verdict (a finding on an honest twin) as stop-the-line material', () => {
    const outcomes = [
      { twinId: 't1', mode: 'honest' as const, verdict: 'claim-falsified-bound' },
    ];
    const s = summarize(outcomes);
    assert.equal(s.honestFalsePositives.hits, 1);
    assert.equal(s.unexpected.length, 1);
  });
});
