import { strict as assert } from 'assert';
import parseDiff from 'parse-diff';
import { EVADERS, applyStack } from '../../../../src/audit/oracle/evade/evaders';

const DIFF =
  'diff --git a/src/x.test.ts b/src/x.test.ts\n--- a/src/x.test.ts\n+++ b/src/x.test.ts\n' +
  "@@ -1,4 +1,4 @@\n it('checks value_abcdef', () => {\n-  expect(compute_abcdef()).toBe(42);\n" +
  '+  expect(compute_abcdef()).toBeGreaterThan(0);\n });\n';

describe('oracle / evaders', () => {
  it('keeps the mutated diff parseable at every depth', () => {
    for (let depth = 0; depth <= EVADERS.length; depth += 1) {
      const mutated = applyStack(DIFF, depth);
      assert.ok(parseDiff(mutated).length >= 1, `depth ${depth} produced an unparseable diff`);
    }
  });

  it('is deterministic', () => {
    assert.equal(applyStack(DIFF, EVADERS.length), applyStack(DIFF, EVADERS.length));
  });

  it('rename and reorder preserve added/deleted line counts in the defect hunk', () => {
    const before = parseDiff(DIFF)[0]?.chunks[0];
    const after = parseDiff(applyStack(DIFF, 3))[0]?.chunks[0];
    const adds = (c: typeof before): number =>
      (c?.changes ?? []).filter((ch) => ch.type === 'add').length;
    const dels = (c: typeof before): number =>
      (c?.changes ?? []).filter((ch) => ch.type === 'del').length;
    assert.equal(adds(before), adds(after));
    assert.equal(dels(before), dels(after));
  });
});
