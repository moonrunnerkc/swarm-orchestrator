import { strict as assert } from 'assert';
import { isTestFile } from '../../../src/audit/cheat-detector/diff-walker';

describe('audit/cheat-detector/diff-walker isTestFile', () => {
  it('recognizes dotted test/spec conventions', () => {
    assert.equal(isTestFile('src/hello.test.ts'), true);
    assert.equal(isTestFile('src/hello.spec.js'), true);
    assert.equal(isTestFile('pkg/__tests__/foo.tsx'), true);
    assert.equal(isTestFile('test/unit/foo.js'), true);
    assert.equal(isTestFile('spec/foo_spec.rb'), true);
    assert.equal(isTestFile('foo_test.go'), true);
    assert.equal(isTestFile('test_foo.py'), true);
  });

  it('recognizes a single-file test.js / tests.js entry point', () => {
    // The standard single-file mocha convention used by many small npm
    // packages (is-number, kind-of, is-glob, ...): the whole suite lives in
    // a root-level file literally named test.js.
    assert.equal(isTestFile('test.js'), true);
    assert.equal(isTestFile('tests.js'), true);
    assert.equal(isTestFile('test.ts'), true);
    assert.equal(isTestFile('test.jsx'), true);
    assert.equal(isTestFile('packages/core/test.js'), true);
  });

  it('does not flag source files whose name merely contains "test"', () => {
    assert.equal(isTestFile('src/index.js'), false);
    assert.equal(isTestFile('latest.js'), false);
    assert.equal(isTestFile('attest.ts'), false);
    assert.equal(isTestFile('contest.jsx'), false);
    assert.equal(isTestFile('README.md'), false);
  });
});
