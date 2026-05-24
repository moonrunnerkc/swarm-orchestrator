import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import parseDiff from 'parse-diff';
import { noOpFixDetector } from '../../../src/audit/cheat-detector/no-op-fix';
import type { Finding } from '../../../src/audit/types';

function tempRepo(files: Record<string, string> = {}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-noop-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return dir;
}

async function runOn(diff: string, repoRoot: string): Promise<Finding[]> {
  const files = parseDiff(diff);
  return await Promise.resolve(noOpFixDetector.run({ files, repoRoot }));
}

describe('cheat-detector / no-op-fix', () => {
  it('blocks a PR that modifies only tests (no source change)', async () => {
    const repo = tempRepo();
    const diff = `diff --git a/x.test.ts b/x.test.ts
--- a/x.test.ts
+++ b/x.test.ts
@@ -1,1 +1,1 @@
-  expect(addNumbers(1,2)).toBe(3);
+  expect(addNumbers(1,2)).toBeGreaterThan(0);
`;
    const findings = await runOn(diff, repo);
    assert.ok(findings.some((f) => f.category === 'no-op-fix' && f.severity === 'block'));
  });

  it('warns when source changes do not share any symbol with test changes', async () => {
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
    const findings = await runOn(diff, repo);
    assert.ok(findings.some((f) => f.category === 'no-op-fix' && f.severity === 'warn'));
  });

  it('passes when source and test changes share a symbol', async () => {
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
    const findings = await runOn(diff, repo);
    assert.equal(findings.length, 0);
  });

  it('fires on common-basename source files that are not reached by any test', async () => {
    // 'utils.ts' is a common name that the v10 basename heuristic would
    // false-positive-suppress: any test mentioning the word 'utils' in
    // prose would text-includes-match. The new import-graph check
    // correctly says: no test actually imports it.
    const repo = tempRepo({
      'src/utils.ts': 'export function helperOne() { return 1; }\n',
      // A test that mentions "utils" in prose only — never imports the file.
      'test/unrelated.test.ts':
        'import { describe } from "node:test";\n' +
        '// notes about utils and helpers in this suite\n' +
        'describe("unrelated utils-adjacent", () => {});\n',
    });
    const diff = `diff --git a/src/utils.ts b/src/utils.ts
--- a/src/utils.ts
+++ b/src/utils.ts
@@ -1,1 +1,2 @@
+export function brandNewHelper() { return 99; }
 export function helperOne() { return 1; }
`;
    const findings = await runOn(diff, repo);
    const warned = findings.filter(
      (f) => f.category === 'no-op-fix' && f.severity === 'warn',
    );
    assert.ok(
      warned.length > 0,
      `expected a no-op-fix warn finding when no test imports the touched source; got ${JSON.stringify(findings)}`,
    );
  });

  it('does not fire when the import graph reaches the touched source file', async () => {
    const repo = tempRepo({
      'src/utils.ts': 'export function helperOne() { return 1; }\n',
      'test/utils.test.ts':
        "import { helperOne } from '../src/utils';\n" +
        "describe('utils', () => { it('works', () => { helperOne(); }); });\n",
    });
    const diff = `diff --git a/src/utils.ts b/src/utils.ts
--- a/src/utils.ts
+++ b/src/utils.ts
@@ -1,1 +1,2 @@
+export function brandNewHelper() { return 99; }
 export function helperOne() { return 1; }
`;
    const findings = await runOn(diff, repo);
    const warned = findings.filter(
      (f) => f.category === 'no-op-fix' && f.severity === 'warn',
    );
    assert.equal(
      warned.length,
      0,
      `expected no warning when an existing test imports the touched source; got ${JSON.stringify(findings)}`,
    );
  });
});
