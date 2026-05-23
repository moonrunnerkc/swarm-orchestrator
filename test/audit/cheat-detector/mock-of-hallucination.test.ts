import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import parseDiff from 'parse-diff';
import { mockOfHallucinationDetector } from '../../../src/audit/cheat-detector/mock-of-hallucination';

function tempRepo(manifestKind: 'js' | 'py' | 'go' | 'none', deps: string[] = []): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-mock-of-h-'));
  if (manifestKind === 'js') {
    const pkg = {
      name: 'fixture',
      dependencies: Object.fromEntries(deps.map((d) => [d, '*'])),
    };
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg, null, 2));
  } else if (manifestKind === 'py') {
    fs.writeFileSync(path.join(dir, 'requirements.txt'), deps.join('\n'));
  } else if (manifestKind === 'go') {
    const lines = ['module example.com/m', 'go 1.21', ''];
    for (const d of deps) lines.push(`require ${d} v1.0.0`);
    fs.writeFileSync(path.join(dir, 'go.mod'), lines.join('\n'));
  }
  return dir;
}

function runOn(unifiedDiff: string, repoRoot: string) {
  const files = parseDiff(unifiedDiff);
  return mockOfHallucinationDetector.run({ files, repoRoot });
}

describe('cheat-detector / mock-of-hallucination', () => {
  it('blocks jest.mock against a module missing from package.json', () => {
    const repo = tempRepo('js', ['lodash']);
    const diff = `diff --git a/foo.test.js b/foo.test.js
--- a/foo.test.js
+++ b/foo.test.js
@@ -1,1 +1,2 @@
+jest.mock('hallucinated-billing-sdk');
 const x = 1;
`;
    const findings = runOn(diff, repo);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.category, 'mock-of-hallucination');
    assert.equal(findings[0]?.severity, 'block');
  });

  it('does not flag a mocked module that exists in package.json', () => {
    const repo = tempRepo('js', ['lodash']);
    const diff = `diff --git a/foo.test.js b/foo.test.js
--- a/foo.test.js
+++ b/foo.test.js
@@ -1,1 +1,2 @@
+jest.mock('lodash');
 const x = 1;
`;
    const findings = runOn(diff, repo);
    assert.equal(findings.length, 0);
  });

  it('flags @patch on a Python module missing from requirements.txt', () => {
    const repo = tempRepo('py', ['requests']);
    const diff = `diff --git a/test_x.py b/test_x.py
--- a/test_x.py
+++ b/test_x.py
@@ -1,1 +1,2 @@
+@patch('imaginary.module.thing')
 def test_x(): pass
`;
    const findings = runOn(diff, repo);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.category, 'mock-of-hallucination');
  });

  it('ignores local-relative mock targets', () => {
    const repo = tempRepo('js', []);
    const diff = `diff --git a/foo.test.js b/foo.test.js
--- a/foo.test.js
+++ b/foo.test.js
@@ -1,1 +1,2 @@
+jest.mock('./local-thing');
 const x = 1;
`;
    const findings = runOn(diff, repo);
    assert.equal(findings.length, 0);
  });

  it('correctly resolves scoped @org/package roots', () => {
    const repo = tempRepo('js', ['@octokit/rest']);
    const diff = `diff --git a/foo.test.js b/foo.test.js
--- a/foo.test.js
+++ b/foo.test.js
@@ -1,1 +1,2 @@
+jest.mock('@octokit/rest');
 const x = 1;
`;
    const findings = runOn(diff, repo);
    assert.equal(findings.length, 0);
  });
});
