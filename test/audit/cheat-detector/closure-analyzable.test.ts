import { strict as assert } from 'assert';
import { isClosureAnalyzable } from '../../../src/audit/cheat-detector/test-import-closure';

// The import closure follows TS/JS/Python imports only. A Go (or other
// non-analyzable) test file must be recognized as such so the Protocol-1
// relevance refuter abstains instead of refuting a real proof it cannot analyze.

describe('test-import-closure / isClosureAnalyzable', () => {
  it('accepts TypeScript and JavaScript test files', () => {
    for (const p of ['a.test.ts', 'a.spec.tsx', 'b.test.js', 'c.test.mjs', 'd.cts']) {
      assert.equal(isClosureAnalyzable(p), true, p);
    }
  });

  it('accepts Python test files', () => {
    assert.equal(isClosureAnalyzable('test_calc.py'), true);
  });

  it('rejects Go and other non-analyzable languages', () => {
    for (const p of ['calc_test.go', 'lib_test.rs', 'foo_test.rb', 'Bar.java']) {
      assert.equal(isClosureAnalyzable(p), false, p);
    }
  });

  it('rejects extensionless files (the TS-fallback would misparse them)', () => {
    assert.equal(isClosureAnalyzable('Makefile'), false);
  });
});
