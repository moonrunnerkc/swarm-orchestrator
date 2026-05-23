import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import parseDiff from 'parse-diff';
import { noOpFixDetector } from '../../../src/audit/cheat-detector/no-op-fix';

function tempRepo(files: Record<string, string> = {}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-noop-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return dir;
}

function runOn(diff: string, repoRoot: string) {
  const files = parseDiff(diff);
  return noOpFixDetector.run({ files, repoRoot });
}

describe('cheat-detector / no-op-fix', () => {
  it('blocks a PR that modifies only tests (no source change)', () => {
    const repo = tempRepo();
    const diff = `diff --git a/x.test.ts b/x.test.ts
--- a/x.test.ts
+++ b/x.test.ts
@@ -1,1 +1,1 @@
-  expect(addNumbers(1,2)).toBe(3);
+  expect(addNumbers(1,2)).toBeGreaterThan(0);
`;
    const findings = runOn(diff, repo);
    assert.ok(findings.some((f) => f.category === 'no-op-fix' && f.severity === 'block'));
  });

  it('warns when source changes do not share any symbol with test changes', () => {
    const repo = tempRepo();
    const diff = `diff --git a/src/foo.ts b/src/foo.ts
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,1 +1,2 @@
+export function totallyUnrelated() { return 'foo'; }
diff --git a/test/bar.test.ts b/test/bar.test.ts
--- a/test/bar.test.ts
+++ b/test/bar.test.ts
@@ -1,1 +1,2 @@
+  expect(bazQuux).toBe(42);
`;
    const findings = runOn(diff, repo);
    assert.ok(findings.some((f) => f.category === 'no-op-fix' && f.severity === 'warn'));
  });

  it('passes when source and test changes share a symbol', () => {
    const repo = tempRepo();
    const diff = `diff --git a/src/foo.ts b/src/foo.ts
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,1 +1,2 @@
+export function totallyUnrelated() { return 'foo'; }
diff --git a/test/bar.test.ts b/test/bar.test.ts
--- a/test/bar.test.ts
+++ b/test/bar.test.ts
@@ -1,1 +1,2 @@
+  expect(totallyUnrelated()).toBe('foo');
`;
    const findings = runOn(diff, repo);
    assert.equal(findings.length, 0);
  });
});
