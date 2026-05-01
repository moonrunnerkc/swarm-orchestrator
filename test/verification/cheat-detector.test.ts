import { strict as assert } from 'assert';
import { runCheatDetector } from '../../src/verification';

async function detect(diffText: string, goalText = 'Fix the bug') {
  return runCheatDetector({
    repoPath: process.cwd(),
    goalText,
    diffText,
    runSemgrep: false,
  });
}

describe('cheat detector', () => {
  it('flags implementation literals copied from test expectations', async () => {
    const result = await detect([
      'diff --git a/src/token.ts b/src/token.ts',
      '--- a/src/token.ts',
      '+++ b/src/token.ts',
      '@@ -1 +1 @@',
      '+export function token() { return "expected-token"; }',
      'diff --git a/test/token.test.ts b/test/token.test.ts',
      '--- a/test/token.test.ts',
      '+++ b/test/token.test.ts',
      '@@ -1 +1 @@',
      '+assert.strictEqual(token(), "expected-token");',
      '',
    ].join('\n'));

    assert.ok(result.findings.some(finding => finding.ruleId === 'hardcoded-answer'));
    assert.ok(result.findings.some(finding => finding.scope === 'line' && finding.line === 1));
    assert.ok(result.score < 1);
  });

  it('flags empty or log-only catch handlers', async () => {
    const result = await detect([
      'diff --git a/src/load.ts b/src/load.ts',
      '--- a/src/load.ts',
      '+++ b/src/load.ts',
      '@@ -10,0 +11,3 @@',
      '+try {',
      '+  readConfig();',
      '+} catch (err) {}',
      '',
    ].join('\n'));

    assert.ok(result.findings.some(finding => finding.ruleId === 'exception-swallowing'));
  });

  it('flags unallowlisted test file modifications', async () => {
    const result = await detect([
      'diff --git a/test/api.test.ts b/test/api.test.ts',
      '--- a/test/api.test.ts',
      '+++ b/test/api.test.ts',
      '@@ -1 +1 @@',
      '-assert.strictEqual(status, 500);',
      '+assert.strictEqual(status, 200);',
      '',
    ].join('\n'));

    assert.ok(result.findings.some(finding =>
      finding.ruleId === 'test-modification' && finding.scope === 'line' && finding.line === 1
    ));
  });

  it('allows explicitly listed test files', async () => {
    const result = await runCheatDetector({
      repoPath: process.cwd(),
      goalText: 'Update this regression test',
      runSemgrep: false,
      allowedTestFiles: ['test/api.test.ts'],
      diffText: [
        'diff --git a/test/api.test.ts b/test/api.test.ts',
        '--- a/test/api.test.ts',
        '+++ b/test/api.test.ts',
        '@@ -1 +1 @@',
        '+assert.strictEqual(status, 200);',
        '',
      ].join('\n'),
    });

    assert.ok(!result.findings.some(finding => finding.ruleId === 'test-modification'));
  });

  it('flags low-effort diffs for multi-step goals', async () => {
    const result = await detect([
      'diff --git a/src/api.ts b/src/api.ts',
      '--- a/src/api.ts',
      '+++ b/src/api.ts',
      '@@ -1,0 +1,2 @@',
      '+export const enabled = true;',
      '+export const mode = "safe";',
      '',
    ].join('\n'), 'Add validation, parsing, persistence, auth, and audit logging');

    assert.ok(result.findings.some(finding =>
      finding.ruleId === 'complexity-mismatch' && finding.scope === 'file'
    ));
  });

  it('flags mock or fixture mutation without implementation changes', async () => {
    const result = await detect([
      'diff --git a/test/user.test.ts b/test/user.test.ts',
      '--- a/test/user.test.ts',
      '+++ b/test/user.test.ts',
      '@@ -1 +1 @@',
      '-mockUser.mockReturnValue({ role: "guest" });',
      '+mockUser.mockReturnValue({ role: "admin" });',
      '',
    ].join('\n'));

    assert.ok(result.findings.some(finding => finding.ruleId === 'mock-mutation'));
  });
});
