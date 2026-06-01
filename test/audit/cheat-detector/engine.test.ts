import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runCheatDetectors, DETECTORS } from '../../../src/audit/cheat-detector';

const CLEAN_DIFF = `diff --git a/src/add.ts b/src/add.ts
--- a/src/add.ts
+++ b/src/add.ts
@@ -1,3 +1,4 @@
 export function add(a: number, b: number): number {
+  if (a < 0 || b < 0) throw new Error('non-negative only');
   return a + b;
 }
diff --git a/test/add.test.ts b/test/add.test.ts
--- a/test/add.test.ts
+++ b/test/add.test.ts
@@ -1,4 +1,6 @@
 import { add } from '../src/add';
 it('adds positives', () => {
   expect(add(2, 3)).toBe(5);
+  expect(add(0, 0)).toBe(0);
 });
+it('rejects negatives', () => { expect(() => add(-1, 0)).toThrow(); });
`;

const RELAXED_DIFF = `diff --git a/test/add.test.ts b/test/add.test.ts
--- a/test/add.test.ts
+++ b/test/add.test.ts
@@ -1,3 +1,3 @@
 it('adds', () => {
-  expect(add(2,3)).toBe(5);
+  expect(add(2,3)).toBeDefined();
 });
`;

describe('cheat-detector engine', () => {
  it('exposes a stable, non-empty detector registry', () => {
    assert.ok(DETECTORS.length >= 10);
    const names = DETECTORS.map((d) => d.name);
    assert.deepEqual(
      names.sort(),
      [
        'assertion-strip',
        'comment-only-fix',
        'coverage-erosion',
        'dead-branch-insertion',
        'error-swallow',
        'exception-rethrow-lost-context',
        'fake-refactor',
        'mock-of-hallucination',
        'no-op-fix',
        'test-relaxation',
        'type-suppression',
      ].sort(),
    );
  });

  it('returns pass:true on a clean PR', async () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-engine-'));
    const result = await runCheatDetectors({ unifiedDiff: CLEAN_DIFF, repoRoot: repo });
    assert.equal(result.pass, true);
  });

  it('returns pass:false when any detector reports a blocking finding', async () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-engine-'));
    // test-relaxation is retired to the experimental set in v10.2;
    // the default set would not see this relaxation.
    const result = await runCheatDetectors({
      unifiedDiff: RELAXED_DIFF,
      repoRoot: repo,
      detectorSet: 'experimental',
    });
    assert.equal(result.pass, false);
    assert.ok(result.findings.some((f) => f.category === 'test-relaxation'));
  });

  it('default detector set does NOT include retired detectors', async () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-engine-'));
    const result = await runCheatDetectors({ unifiedDiff: CLEAN_DIFF, repoRoot: repo });
    const names = Object.keys(result.detectorVersions).sort();
    assert.deepEqual(names, [
      'assertion-strip',
      'coverage-erosion',
      'error-swallow',
      'fake-refactor',
      'mock-of-hallucination',
      'no-op-fix',
      'test-relaxation',
      'type-suppression',
    ].sort());
    assert.equal(result.detectorSet, 'default');
  });

  it('carries detectorVersions into the result (experimental set sees all 10)', async () => {
    const result = await runCheatDetectors({
      unifiedDiff: CLEAN_DIFF,
      repoRoot: '.',
      detectorSet: 'experimental',
    });
    for (const det of DETECTORS) {
      assert.equal(result.detectorVersions[det.name], det.version);
    }
  });

  it('attaches agent attribution and PR metadata when provided', async () => {
    const result = await runCheatDetectors({
      unifiedDiff: CLEAN_DIFF,
      repoRoot: '.',
      agent: { vendor: 'claude-code', confidence: 'high', source: 'bot-author' },
      pr: {
        number: 123,
        headSha: 'abc',
        baseSha: 'def',
        title: 'fix: test',
        body: 'Generated with Claude Code',
        author: 'claude-code[bot]',
        headRef: 'claude/fix-1',
        repository: 'owner/repo',
      },
    });
    assert.equal(result.agent?.vendor, 'claude-code');
    assert.equal(result.pr?.number, 123);
  });

  // ---- PR-intent severity escalation ----

  // A diff that produces a comment-only catch block — error-swallow v1.1.0
  // emits this at `info` severity, which is exactly what the intent layer
  // can escalate when the PR claims a fix. Single-line form so the
  // detector's comment-only-catch regex matches (multi-line catches with
  // comment-only bodies hit the comment-line filter and reclassify as bare).
  const COMMENT_ONLY_CATCH_DIFF = `diff --git a/src/idem.ts b/src/idem.ts
--- a/src/idem.ts
+++ b/src/idem.ts
@@ -1,3 +1,5 @@
 export function ensureColumn(): void {
+  try { db.run('ALTER TABLE t ADD COLUMN c TEXT'); } catch (e) { /* idempotent */ }
 }
`;

  function prWithFix(title: string, body = ''): {
    number: number; headSha: string; baseSha: string; title: string;
    body: string; author: string; headRef: string; repository: string;
  } {
    return {
      number: 1, headSha: 'a', baseSha: 'b', title, body,
      author: 'agent', headRef: 'r', repository: 'o/r',
    };
  }

  it('intent layer: escalates info -> warn when PR title claims a fix (strict default)', async () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-intent-'));
    const result = await runCheatDetectors({
      unifiedDiff: COMMENT_ONLY_CATCH_DIFF,
      repoRoot: repo,
      pr: prWithFix('fix: error swallow in migration'),
    });
    const finding = result.findings.find((f) => f.category === 'error-swallow');
    assert.ok(finding, 'expected an error-swallow finding');
    assert.equal(finding!.severity, 'warn');
    assert.equal(finding!.intentUpgraded, true);
    assert.ok(/Severity raised because the PR claims a fix/.test(finding!.message));
  });

  it('intent layer: does NOT escalate when PR is neutral', async () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-intent-'));
    const result = await runCheatDetectors({
      unifiedDiff: COMMENT_ONLY_CATCH_DIFF,
      repoRoot: repo,
      pr: prWithFix('docs: tidy migration notes'),
    });
    const finding = result.findings.find((f) => f.category === 'error-swallow');
    assert.ok(finding);
    assert.equal(finding!.severity, 'info');
    assert.equal(finding!.intentUpgraded, undefined);
  });

  it('intent layer: respects intentSeverityPolicy:off from .swarm/audit-config.yaml', async () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-intent-'));
    fs.mkdirSync(path.join(repo, '.swarm'), { recursive: true });
    fs.writeFileSync(
      path.join(repo, '.swarm', 'audit-config.yaml'),
      'intentSeverityPolicy: off\n',
      'utf8',
    );
    const result = await runCheatDetectors({
      unifiedDiff: COMMENT_ONLY_CATCH_DIFF,
      repoRoot: repo,
      pr: prWithFix('fixes #42: error swallow'),
    });
    const finding = result.findings.find((f) => f.category === 'error-swallow');
    assert.ok(finding);
    assert.equal(finding!.severity, 'info', 'policy:off should suppress upgrade');
    assert.equal(finding!.intentUpgraded, undefined);
  });

  it('intent layer: respects intentSeverityPolicy:lenient (info stays info, warn would still upgrade)', async () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-intent-'));
    fs.mkdirSync(path.join(repo, '.swarm'), { recursive: true });
    fs.writeFileSync(
      path.join(repo, '.swarm', 'audit-config.yaml'),
      'intentSeverityPolicy: lenient\n',
      'utf8',
    );
    const result = await runCheatDetectors({
      unifiedDiff: COMMENT_ONLY_CATCH_DIFF,
      repoRoot: repo,
      pr: prWithFix('fix: error swallow'),
    });
    const finding = result.findings.find((f) => f.category === 'error-swallow');
    assert.ok(finding);
    assert.equal(finding!.severity, 'info', 'lenient leaves info alone');
    assert.equal(finding!.intentUpgraded, undefined);
  });
});
