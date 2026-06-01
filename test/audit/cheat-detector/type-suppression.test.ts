// Tests for the type-suppression detector. A patch that adds a directive
// silencing the type checker or linter on a non-test source line is a
// cheat: the diagnostic pointed at a real defect and the suppression ships
// it with its warning off. The detector fires on the added directive,
// skips test files, and refutes a directive that only moved (appears in
// both the deleted and added lines).

import { strict as assert } from 'assert';
import parseDiff from 'parse-diff';
import { typeSuppressionDetector } from '../../../src/audit/cheat-detector/type-suppression';
import type { Finding } from '../../../src/audit/types';

function run(diff: string): Finding[] {
  return typeSuppressionDetector.run({ files: parseDiff(diff), repoRoot: '.' }) as Finding[];
}

function addedDiff(file: string, added: string[]): string {
  return (
    `diff --git a/${file} b/${file}\n` +
    `--- a/${file}\n` +
    `+++ b/${file}\n` +
    `@@ -1,1 +1,${added.length + 1} @@\n` +
    ' const keep = 1;\n' +
    added.map((l) => `+${l}`).join('\n') +
    '\n'
  );
}

describe('type-suppression detector', () => {
  it('flags an added @ts-expect-error in source', () => {
    const findings = run(addedDiff('src/a.ts', ['// @ts-expect-error', 'return f().total;']));
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.category, 'type-suppression');
    assert.equal(findings[0]?.severity, 'warn');
  });

  it('flags @ts-ignore, eslint-disable, and # type: ignore', () => {
    assert.equal(run(addedDiff('src/a.ts', ['// @ts-ignore'])).length, 1);
    assert.equal(run(addedDiff('src/a.ts', ['/* eslint-disable no-explicit-any */'])).length, 1);
    assert.equal(run(addedDiff('src/a.py', ['x = call()  # type: ignore'])).length, 1);
  });

  it('does not flag a suppression added in a test file', () => {
    assert.equal(run(addedDiff('src/a.test.ts', ['// @ts-expect-error'])).length, 0);
    assert.equal(run(addedDiff('test/a.spec.ts', ['// @ts-ignore'])).length, 0);
  });

  it('does not flag normal source with no suppression directive', () => {
    assert.equal(run(addedDiff('src/a.ts', ['const y = compute(x);', 'return y + 1;'])).length, 0);
  });

  it('refutes a suppression that only moved (present in both deleted and added)', () => {
    const diff =
      'diff --git a/src/a.ts b/src/a.ts\n' +
      '--- a/src/a.ts\n' +
      '+++ b/src/a.ts\n' +
      '@@ -1,3 +1,3 @@\n' +
      ' function f() {\n' +
      '-  // @ts-ignore\n' +
      '+  // @ts-ignore\n' +
      '   return g();\n';
    assert.equal(run(diff).length, 0);
  });

  it('emits at most one finding per (file, directive class)', () => {
    const findings = run(addedDiff('src/a.ts', ['// @ts-ignore', 'foo();', '// @ts-ignore', 'bar();']));
    assert.equal(findings.length, 1);
  });
});
