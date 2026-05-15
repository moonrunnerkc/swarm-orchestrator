import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { JsonlLedger } from '../../src/ledger/jsonl-ledger';
import { attemptApplyAndVerify } from '../../src/population/manager';
import type { ObligationV1 } from '../../src/contract/types';

function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function emptyRenderContext(): { commandFailureTail?: string; testFramework?: never } {
  return {};
}

const FILE_MUST_EXIST: ObligationV1 = { type: 'file-must-exist', path: 'OUT.txt' };
const TEST_MUST_PASS: ObligationV1 = { type: 'test-must-pass', command: 'true' };
const TEST_MUST_FAIL: ObligationV1 = { type: 'test-must-pass', command: 'false' };

describe('population/manager — attemptApplyAndVerify', () => {
  it('applies a file-must-exist obligation and reports success', async () => {
    const repo = tmpDir('aaaV-');
    const ledger = new JsonlLedger(path.join(repo, 'ledger.jsonl'), 'r1');
    const result = await attemptApplyAndVerify({
      obligation: FILE_MUST_EXIST,
      obligationIndex: 0,
      responseText: '```\nhello world\n```',
      repoRoot: repo,
      ledger,
      runId: 'r1',
      fileMustExistPaths: new Set<string>(['OUT.txt']),
      commandTimeoutMs: undefined,
      renderContext: emptyRenderContext(),
      trigger: 'per-obligation-failed-apply',
    });

    assert.equal(result.satisfied, true);
    assert.equal(result.applied, true);
    assert.equal(result.applyOk, true);
    assert.ok(/wrote OUT\.txt/.test(result.applyDetail));
    assert.ok(fs.existsSync(path.join(repo, 'OUT.txt')));
  });

  it('reports applyOk=true for a legitimate no-op against a passing test command', async () => {
    const repo = tmpDir('aaaV-');
    const ledger = new JsonlLedger(path.join(repo, 'ledger.jsonl'), 'r2');
    const result = await attemptApplyAndVerify({
      obligation: TEST_MUST_PASS,
      obligationIndex: 0,
      responseText: 'no-op',
      repoRoot: repo,
      ledger,
      runId: 'r2',
      fileMustExistPaths: new Set<string>(),
      commandTimeoutMs: undefined,
      renderContext: emptyRenderContext(),
      trigger: 'per-obligation-failed-apply',
    });

    assert.equal(result.satisfied, true);
    assert.equal(result.applied, false);
    assert.equal(result.applyOk, true);
    assert.equal(result.applyDetail, 'no-op declared');
  });

  it('reports applyOk=false and unsatisfied for prose against a failing command', async () => {
    const repo = tmpDir('aaaV-');
    const ledger = new JsonlLedger(path.join(repo, 'ledger.jsonl'), 'r3');
    const result = await attemptApplyAndVerify({
      obligation: TEST_MUST_FAIL,
      obligationIndex: 0,
      responseText: 'I cannot help with this request.',
      repoRoot: repo,
      ledger,
      runId: 'r3',
      fileMustExistPaths: new Set<string>(),
      commandTimeoutMs: undefined,
      renderContext: emptyRenderContext(),
      trigger: 'per-obligation-failed-apply',
    });

    assert.equal(result.satisfied, false);
    assert.equal(result.applied, false);
    assert.equal(result.applyOk, false);
    assert.ok(result.applyDetail.startsWith('persona response is neither'));
  });

  it('reports applyOk=false on a unified diff whose context does not match the workspace', async () => {
    const repo = tmpDir('aaaV-');
    const ledger = new JsonlLedger(path.join(repo, 'ledger.jsonl'), 'r4');
    fs.writeFileSync(path.join(repo, 'src.txt'), 'actual line\n');
    // Diff header + hunk header are valid, but the context line "expected
    // line" doesn't exist in src.txt — strict applier rejects it.
    const diff = [
      '--- a/src.txt',
      '+++ b/src.txt',
      '@@ -1 +1 @@',
      '-expected line',
      '+replacement line',
      '',
    ].join('\n');
    const result = await attemptApplyAndVerify({
      obligation: TEST_MUST_FAIL,
      obligationIndex: 0,
      responseText: diff,
      repoRoot: repo,
      ledger,
      runId: 'r4',
      fileMustExistPaths: new Set<string>(),
      commandTimeoutMs: undefined,
      renderContext: emptyRenderContext(),
      trigger: 'per-obligation-failed-apply',
    });

    assert.equal(result.satisfied, false);
    assert.equal(result.applyOk, false);
    assert.ok(
      /unified diff (did not apply|parse\/apply error)/.test(result.applyDetail),
      `expected diff failure detail, got: ${result.applyDetail}`,
    );
  });

  it('rolls back a failed-apply attempt and emits a rolled-back ledger entry', async () => {
    const repo = tmpDir('aaaV-');
    fs.writeFileSync(path.join(repo, 'src.txt'), 'original-content\n');
    const ledger = new JsonlLedger(path.join(repo, 'ledger.jsonl'), 'r5');
    // A diff that applies cleanly but the test obligation will still fail
    // (`false`), so the rollback path runs.
    const diff = [
      '--- a/src.txt',
      '+++ b/src.txt',
      '@@ -1 +1 @@',
      '-original-content',
      '+mutated-content',
      '',
    ].join('\n');
    const result = await attemptApplyAndVerify({
      obligation: TEST_MUST_FAIL,
      obligationIndex: 0,
      responseText: diff,
      repoRoot: repo,
      ledger,
      runId: 'r5',
      fileMustExistPaths: new Set<string>(),
      commandTimeoutMs: undefined,
      renderContext: emptyRenderContext(),
      trigger: 'per-obligation-failed-apply',
    });

    assert.equal(result.satisfied, false);
    assert.equal(result.applied, true);
    assert.equal(result.applyOk, true);
    const restored = fs.readFileSync(path.join(repo, 'src.txt'), 'utf8');
    assert.equal(restored, 'original-content\n');
    const entries = ledger.readAll();
    const rolled = entries.find((e) => e.type === 'obligation-rolled-back');
    assert.ok(rolled, 'expected an obligation-rolled-back ledger entry');
    assert.equal(
      (rolled as { trigger: string }).trigger,
      'per-obligation-failed-apply',
    );
  });

  it('does NOT roll back a file-must-exist failure (architect file creation has no pre-state)', async () => {
    const repo = tmpDir('aaaV-');
    // Use the test-framework-misuse path to force a file-must-exist failure
    // without actually breaking the file write: architect lands a Jest-API
    // test file in a node-test project. applyFileEmit writes the file, verify
    // passes file-exists, then the misuse check flips verifyResult to
    // {satisfied: false, ...}. With trigger=per-obligation-failed-apply, the
    // helper must NOT roll back because obligation.type === 'file-must-exist'.
    const fenced = '```\nimport { describe } from \'@jest/globals\';\nexpect(1).toBe(1);\n```';
    const obligation: ObligationV1 = { type: 'file-must-exist', path: 'foo.test.ts' };
    const ledger = new JsonlLedger(path.join(repo, 'ledger.jsonl'), 'r6');
    const result = await attemptApplyAndVerify({
      obligation,
      obligationIndex: 0,
      responseText: fenced,
      repoRoot: repo,
      ledger,
      runId: 'r6',
      fileMustExistPaths: new Set<string>(['foo.test.ts']),
      commandTimeoutMs: undefined,
      renderContext: { testFramework: 'node-test' },
      trigger: 'per-obligation-failed-apply',
    });

    assert.equal(result.satisfied, false);
    const entries = ledger.readAll();
    const rolled = entries.find((e) => e.type === 'obligation-rolled-back');
    assert.equal(rolled, undefined, 'file-must-exist must not roll back');
  });

  it('passes through the test-framework-misuse override when the architect lands the wrong framework', async () => {
    const repo = tmpDir('aaaV-');
    // Write a "test file" that uses Jest API in a node-test project.
    const fenced = '```\nimport { describe } from \'@jest/globals\';\nexpect(1).toBe(1);\n```';
    const obligation: ObligationV1 = { type: 'file-must-exist', path: 'foo.test.ts' };
    const ledger = new JsonlLedger(path.join(repo, 'ledger.jsonl'), 'r7');
    const result = await attemptApplyAndVerify({
      obligation,
      obligationIndex: 0,
      responseText: fenced,
      repoRoot: repo,
      ledger,
      runId: 'r7',
      fileMustExistPaths: new Set<string>(['foo.test.ts']),
      commandTimeoutMs: undefined,
      renderContext: { testFramework: 'node-test' },
      trigger: 'per-obligation-failed-apply',
    });

    assert.equal(result.satisfied, false);
    assert.ok(
      /wrong test framework/.test(result.verifyDetail),
      `expected test-framework-misuse detail, got: ${result.verifyDetail}`,
    );
  });
});
