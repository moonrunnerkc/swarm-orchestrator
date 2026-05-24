import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { handleAudit } from '../../src/cli/v8/audit-handler';
import { buildShadowOutput } from '../../src/audit/shadow-output';
import type { AuditResult } from '../../src/audit/types';

// Spec-aligned schema check for the v10.3 single-file shadow output.
// Tests use --diff-file to bypass the @octokit/rest comment-post path
// entirely; combined with the assertion that no stdout markdown is
// produced under --shadow-output, this verifies the advisory-mode
// shadow run cannot end up posting a comment.

const FIXTURE_DIFF = `diff --git a/src/x.ts b/src/x.ts
--- a/src/x.ts
+++ b/src/x.ts
@@ -1,1 +1,2 @@
 export function add(a: number, b: number): number {
+  return a + b;
}
`;

describe('audit / shadow-output (v10.3-advisory)', function () {
  this.timeout(15_000);

  let tmpRoot: string;
  let diffFile: string;
  let outFile: string;
  let ledgerFile: string;
  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-shadow-out-'));
    diffFile = path.join(tmpRoot, 'in.patch');
    outFile = path.join(tmpRoot, 'out', 'verdict.json');
    ledgerFile = path.join(tmpRoot, 'audit.ledger.jsonl');
    fs.writeFileSync(diffFile, FIXTURE_DIFF);
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  async function captureStdoutDuring(fn: () => Promise<number>): Promise<{
    captured: string;
    exit: number;
  }> {
    const original = process.stdout.write.bind(process.stdout);
    const buffer: string[] = [];
    process.stdout.write = ((chunk: string | Uint8Array) => {
      buffer.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    }) as typeof process.stdout.write;
    try {
      const exit = await fn();
      return { captured: buffer.join(''), exit };
    } finally {
      process.stdout.write = original;
    }
  }

  it('writes a single JSON file with the spec schema and never prints rendered markdown', async () => {
    const { captured, exit } = await captureStdoutDuring(() =>
      handleAudit([
        '--diff-file', diffFile,
        '--mode', 'advise',
        '--shadow-output', outFile,
        '--ledger-path', ledgerFile,
        '--repo-root', tmpRoot,
        '--output', 'markdown',
      ]),
    );
    assert.equal(exit, 0, 'advise + shadow-output must return 0');
    assert.ok(fs.existsSync(outFile), `expected output file at ${outFile}`);

    const parsed = JSON.parse(fs.readFileSync(outFile, 'utf8'));
    assert.equal(parsed.schemaVersion, 2);
    assert.equal(parsed.prRef, null, 'no PR ref when --diff-file is the input');
    assert.equal(typeof parsed.auditedAt, 'string');
    assert.equal(typeof parsed.durationMs, 'number');
    assert.ok(Array.isArray(parsed.detectorVerdicts));
    assert.ok(parsed.detectorVerdicts.length >= 1);
    for (const v of parsed.detectorVerdicts) {
      assert.equal(typeof v.detector, 'string');
      assert.equal(typeof v.version, 'string');
      assert.equal(typeof v.fired, 'boolean');
      assert.ok(['block', 'warn', 'info', 'none'].includes(v.severity));
    }
    assert.equal(typeof parsed.judgeInvocations, 'number');
    assert.equal(typeof parsed.renderedComment, 'string');
    assert.ok(parsed.renderedComment.length > 0, 'renderedComment must be the PR-comment body');

    // The whole point of shadow mode is no comment goes anywhere a
    // human sees during a CI run. Captured stdout may carry the
    // logger's "wrote <path>" info line, but it must not carry the
    // rendered PR-comment markdown body even though `--output
    // markdown` was also passed.
    assert.doesNotMatch(
      captured,
      /# Swarm Audit:/u,
      `--shadow-output must suppress the rendered comment headline; stdout was: ${JSON.stringify(captured)}`,
    );
    assert.doesNotMatch(
      captured,
      /Detector precision badge/u,
      '--shadow-output must suppress finding bodies',
    );
  });

  it('records llm-judge-result entries in judgeInvocations when the judge fired', () => {
    // Synthetic ledger with two judge entries; the helper should
    // count both, irrespective of cacheHit.
    fs.writeFileSync(
      ledgerFile,
      [
        JSON.stringify({ type: 'llm-judge-result', detector: 'no-op-fix', cacheHit: false }),
        JSON.stringify({ type: 'pr-audit-finding', category: 'no-op-fix' }),
        JSON.stringify({ type: 'llm-judge-result', detector: 'no-op-fix', cacheHit: true }),
      ].join('\n') + '\n',
    );
    const result: AuditResult = {
      pass: true,
      findings: [],
      generatedAt: '2026-05-24T18:00:00.000Z',
      detectorVersions: { 'no-op-fix': '2.0.0' },
      detectorSet: 'default',
    };
    const entry = buildShadowOutput({
      prRef: 'acme/widget#42',
      durationMs: 1234,
      result,
      mode: 'advise',
      ledgerPath: ledgerFile,
      ledgerUrl: ledgerFile,
    });
    assert.equal(entry.judgeInvocations, 2);
    assert.equal(entry.prRef, 'acme/widget#42');
    assert.equal(entry.detectorVerdicts.length, 1);
    assert.equal(entry.detectorVerdicts[0]?.detector, 'no-op-fix');
    assert.equal(entry.detectorVerdicts[0]?.fired, false);
    assert.equal(entry.detectorVerdicts[0]?.severity, 'none');
  });

  it('reports fired=true with the worst severity when findings are present', () => {
    const result: AuditResult = {
      pass: false,
      findings: [
        {
          category: 'no-op-fix',
          severity: 'warn',
          message: 'x',
          location: { file: 'a.ts', line: 1 },
          evidence: '',
        },
        {
          category: 'no-op-fix',
          severity: 'block',
          message: 'y',
          location: { file: 'a.ts', line: 1 },
          evidence: '',
        },
      ],
      generatedAt: '2026-05-24T18:00:00.000Z',
      detectorVersions: { 'no-op-fix': '2.0.0', 'error-swallow': '2.0.0' },
      detectorSet: 'default',
    };
    const entry = buildShadowOutput({
      prRef: null,
      durationMs: 0,
      result,
      mode: 'advise',
      ledgerPath: path.join(tmpRoot, 'missing.jsonl'),
    });
    const noOp = entry.detectorVerdicts.find((v) => v.detector === 'no-op-fix');
    const errSw = entry.detectorVerdicts.find((v) => v.detector === 'error-swallow');
    assert.equal(noOp?.fired, true);
    assert.equal(noOp?.severity, 'block');
    assert.equal(errSw?.fired, false);
    assert.equal(errSw?.severity, 'none');
    assert.equal(entry.judgeInvocations, 0, 'missing ledger should report zero');
  });
});
