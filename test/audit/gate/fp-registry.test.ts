import { strict as assert } from 'assert';
import {
  loadRegistry,
  loadEntryDiff,
  evaluateEntry,
  liveFalsePositives,
  type FpRegistryEntry,
} from '../../../scripts/gate/fp-registry';

describe('fp-registry', () => {
  it('carries the jeduden/mdsmith#232 coverage-relocation false positive as entry one', () => {
    const entries = loadRegistry();
    const jeduden = entries.find((e) => e.id === 'jeduden-mdsmith-232');
    assert.ok(jeduden, 'expected the jeduden entry in the committed registry');
    assert.equal(jeduden.firedTrigger, 'test-tamper-proven');
    assert.equal(jeduden.disposition, 'neutralized-by-refuter');
    assert.equal(jeduden.refuter, 'coverage-relocated');
  });

  it('every neutralized entry still has its refuter fire on the committed diff (the CI ratchet)', () => {
    for (const entry of loadRegistry()) {
      if (entry.disposition !== 'neutralized-by-refuter') continue;
      const evaluation = evaluateEntry(entry, loadEntryDiff(entry));
      assert.equal(
        evaluation.neutralized,
        true,
        `${entry.id} regressed: ${evaluation.detail}`,
      );
    }
  });

  it('flags a deliberate firing: an entry whose diff the refuter does NOT catch evaluates as regressed', () => {
    // A synthetic registry entry whose committed diff is a pure tamper (no
    // replacement coverage), so the coverage-relocation refuter cannot fire. The
    // guard must report it as not-neutralized, which is what makes CI go red.
    const firingEntry: FpRegistryEntry = {
      id: 'synthetic-firing',
      pr: 'acme/synthetic#1',
      headSha: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
      baseSha: 'cafebabecafebabecafebabecafebabecafebabe',
      firedTrigger: 'test-tamper-proven',
      category: 'assertion-strip',
      findingFiles: ['calc_test.go'],
      diagnosis: 'synthetic: no relocation, refuter cannot neutralize',
      disposition: 'neutralized-by-refuter',
      refuter: 'coverage-relocated',
      diffFile: '(inline)',
    };
    const pureTamperDiff = `diff --git a/calc.go b/calc.go
--- a/calc.go
+++ b/calc.go
@@ -1,3 +1,3 @@
 package calc
-func Add(a, b int) int { return a + b }
+func Add(a, b int) int { return a - b }
diff --git a/calc_test.go b/calc_test.go
--- a/calc_test.go
+++ b/calc_test.go
@@ -1,4 +1,4 @@
 package calc
 import "testing"
-func TestAdd(t *testing.T) { if Add(2, 3) != 5 { t.Fatal("x") } }
+func TestAdd(t *testing.T) { if Add(2, 3) != Add(2, 3) { t.Fatal("x") } }
`;
    const evaluation = evaluateEntry(firingEntry, pureTamperDiff);
    assert.equal(evaluation.neutralized, false);
    assert.match(evaluation.detail, /did NOT fire/);
  });

  it('exposes only live-fp entries as block-eligibility denominator input', () => {
    // The committed registry's only entry is neutralized, so it contributes no
    // live false positives; the demotion denominator stays empty.
    assert.deepEqual(liveFalsePositives(loadRegistry()), []);

    const live: FpRegistryEntry[] = [
      {
        id: 'x',
        pr: 'acme/x#1',
        headSha: 'a',
        baseSha: 'b',
        firedTrigger: 'test-tamper-proven',
        category: 'assertion-strip',
        findingFiles: [],
        diagnosis: 'not yet fixed',
        disposition: 'live-fp',
        diffFile: 'x.diff',
      },
    ];
    assert.deepEqual(liveFalsePositives(live), [
      { trigger: 'test-tamper-proven', pr: 'acme/x#1' },
    ]);
  });
});
