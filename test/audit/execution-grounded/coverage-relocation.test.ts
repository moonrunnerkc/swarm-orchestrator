import { strict as assert } from 'node:assert';
import {
  coverageRelocated,
  isCoverageDataFile,
} from '../../../src/audit/execution-grounded/test-restoration';

// A jeduden/mdsmith#232-shaped diff: a production file changes, its guarding
// assertion is weakened in a co-located test, and the PR adds replacement
// coverage (a new test file plus a golden fixture) in the same package dir.
const RELOCATION_DIFF = `diff --git a/internal/githooks/hook.go b/internal/githooks/hook.go
--- a/internal/githooks/hook.go
+++ b/internal/githooks/hook.go
@@ -1,3 +1,3 @@
 package githooks
-func BuildHook() string { return "fix .; then" }
+func BuildHook() string { return "fixup .; then" }
diff --git a/internal/githooks/hook_test.go b/internal/githooks/hook_test.go
--- a/internal/githooks/hook_test.go
+++ b/internal/githooks/hook_test.go
@@ -1,5 +1,5 @@
 package githooks
 import "testing"
 func TestHook(t *testing.T) {
-	if !contains(BuildHook(), "fix .; then") { t.Fatal("x") }
+	if BuildHook() == "" { t.Fatal("x") }
 }
diff --git a/internal/githooks/hook_golden_test.go b/internal/githooks/hook_golden_test.go
new file mode 100644
--- /dev/null
+++ b/internal/githooks/hook_golden_test.go
@@ -0,0 +1,3 @@
+package githooks
+import "testing"
+func TestGolden(t *testing.T) {}
diff --git a/internal/githooks/testdata/hook.golden b/internal/githooks/testdata/hook.golden
new file mode 100644
--- /dev/null
+++ b/internal/githooks/testdata/hook.golden
@@ -0,0 +1 @@
+fixup .; then
`;

// A pure tamper: a production regression concealed behind a weakened test, with
// no replacement coverage added anywhere.
const PLANTED_TAMPER_DIFF = `diff --git a/calc.go b/calc.go
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

// An added test that lives in a directory the PR did NOT change production
// source in: not a relocation over the guarded code.
const UNRELATED_ADDED_TEST_DIFF = `diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,2 +1,2 @@
-export const add = (a: number, b: number) => a + b;
+export const add = (a: number, b: number) => a - b;
diff --git a/src/a.test.ts b/src/a.test.ts
--- a/src/a.test.ts
+++ b/src/a.test.ts
@@ -1,3 +1,3 @@
 import { add } from './a';
-test('add', () => expect(add(2, 3)).toBe(5));
+test('add', () => expect(add(2, 3)).toBe(add(2, 3)));
diff --git a/unrelated/b.test.ts b/unrelated/b.test.ts
new file mode 100644
--- /dev/null
+++ b/unrelated/b.test.ts
@@ -0,0 +1,2 @@
+import { other } from '../other';
+test('other', () => expect(other()).toBe(1));
`;

// A weakened test plus an added golden fixture, but NO production file changed:
// there is no changed code for the coverage to have relocated over.
const GOLDEN_NO_PROD_CHANGE_DIFF = `diff --git a/pkg/thing_test.go b/pkg/thing_test.go
--- a/pkg/thing_test.go
+++ b/pkg/thing_test.go
@@ -1,4 +1,4 @@
 package pkg
 import "testing"
-func TestThing(t *testing.T) { if render() != "a" { t.Fatal("x") } }
+func TestThing(t *testing.T) { if render() == "" { t.Fatal("x") } }
diff --git a/pkg/testdata/thing.golden b/pkg/testdata/thing.golden
new file mode 100644
--- /dev/null
+++ b/pkg/testdata/thing.golden
@@ -0,0 +1 @@
+a
`;

describe('isCoverageDataFile', () => {
  it('recognizes testdata, snapshot, and golden/approved fixtures', () => {
    assert.equal(isCoverageDataFile('internal/githooks/testdata/x.golden.sh'), true);
    assert.equal(isCoverageDataFile('a/__snapshots__/x.snap'), true);
    assert.equal(isCoverageDataFile('a/b.golden'), true);
    assert.equal(isCoverageDataFile('a/b.approved.txt'), true);
  });

  it('does not treat ordinary source or test files as coverage data', () => {
    assert.equal(isCoverageDataFile('src/pay.ts'), false);
    assert.equal(isCoverageDataFile('cmd/mdsmith/e2e_test.go'), false);
    assert.equal(isCoverageDataFile('testdata.go'), false);
  });
});

describe('coverageRelocated', () => {
  it('fires on a jeduden-shaped diff: replacement coverage added in the changed package', () => {
    const reason = coverageRelocated(RELOCATION_DIFF, 'internal/githooks/hook_test.go');
    assert.ok(reason !== null, 'expected a relocation reason');
    assert.match(reason, /hook_golden_test\.go/);
    assert.match(reason, /testdata\/hook\.golden/);
    assert.match(reason, /human review required/);
  });

  it('does not fire on a pure tamper with no replacement coverage', () => {
    assert.equal(coverageRelocated(PLANTED_TAMPER_DIFF, 'calc_test.go'), null);
  });

  it('does not fire on an added test outside any changed production directory', () => {
    assert.equal(coverageRelocated(UNRELATED_ADDED_TEST_DIFF, 'src/a.test.ts'), null);
  });

  it('does not fire when a golden is added but no production source changed', () => {
    assert.equal(coverageRelocated(GOLDEN_NO_PROD_CHANGE_DIFF, 'pkg/thing_test.go'), null);
  });
});
