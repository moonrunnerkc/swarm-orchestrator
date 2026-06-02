import { strict as assert } from 'assert';
import {
  extractChangedLineRanges,
  lineInRanges,
} from '../../../src/audit/cheat-detector/diff-walker';

const DIFF = `diff --git a/src/calc.ts b/src/calc.ts
index 1111111..2222222 100644
--- a/src/calc.ts
+++ b/src/calc.ts
@@ -1,6 +1,9 @@
 export function add(a: number, b: number): number {
-  return a + b;
+  if (a < 0) return b;
+  return a + b + 0;
 }
+
+export const VERSION = '2';
 export function sub(a: number, b: number): number {
   return a - b;
 }
diff --git a/src/calc.test.ts b/src/calc.test.ts
index 3333333..4444444 100644
--- a/src/calc.test.ts
+++ b/src/calc.test.ts
@@ -1,2 +1,3 @@
 import { add } from './calc';
+test('add', () => {});
 // tail
`;

describe('cheat-detector / changed line ranges', () => {
  it('extracts post-image added-line ranges per file', () => {
    const ranges = extractChangedLineRanges(DIFF);
    // calc.ts: lines 2-3 (the two replaced lines) and 5-6 (the blank + VERSION).
    assert.deepEqual(ranges['src/calc.ts'], [
      { start: 2, end: 3 },
      { start: 5, end: 6 },
    ]);
    // calc.test.ts: the single added line at post-image line 2.
    assert.deepEqual(ranges['src/calc.test.ts'], [{ start: 2, end: 2 }]);
  });

  it('honors the file filter', () => {
    const ranges = extractChangedLineRanges(DIFF, (p) => !p.endsWith('.test.ts'));
    assert.ok('src/calc.ts' in ranges);
    assert.ok(!('src/calc.test.ts' in ranges));
  });

  it('lineInRanges checks membership inclusively', () => {
    const ranges = [
      { start: 2, end: 3 },
      { start: 5, end: 6 },
    ];
    assert.equal(lineInRanges(2, ranges), true);
    assert.equal(lineInRanges(3, ranges), true);
    assert.equal(lineInRanges(4, ranges), false);
    assert.equal(lineInRanges(6, ranges), true);
    assert.equal(lineInRanges(7, ranges), false);
    assert.equal(lineInRanges(2, undefined), false);
  });
});
