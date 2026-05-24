// Tests for the v2.0 catch-body classification on error-swallow.
// v1.x distinguished bare vs. comment-only; v2.0 adds logging-only,
// metrics-only, and fallback-assignment classifications and emits
// `info` severity (with body-class metadata in the message) for each
// of the three legitimate shapes. The real cheat pattern stays at
// `block`.

import { strict as assert } from 'assert';
import parseDiff from 'parse-diff';
import { errorSwallowDetector } from '../../../src/audit/cheat-detector/error-swallow';
import type { Finding } from '../../../src/audit/types';

function run(diff: string): Finding[] {
  return errorSwallowDetector.run({ files: parseDiff(diff), repoRoot: '.' }) as Finding[];
}

function diffOf(body: string): string {
  const lineCount = body.split('\n').length;
  return (
    'diff --git a/src/x.ts b/src/x.ts\n' +
    '--- a/src/x.ts\n' +
    '+++ b/src/x.ts\n' +
    `@@ -1,1 +1,${lineCount + 1} @@\n` +
    ' function f() {\n' +
    body
      .split('\n')
      .map((l) => `+${l}`)
      .join('\n') +
    '\n'
  );
}

describe('error-swallow v2.0 catch-body classification', () => {
  it('classifies logger.error catch body as logging-only (info)', () => {
    const body = '  try { doIt(); } catch (e) { logger.error("failed", e); }';
    const findings = run(diffOf(body));
    assert.equal(findings.length, 1);
    assert.equal(findings[0]!.severity, 'info');
    assert.match(findings[0]!.message, /body-class: logging-only/);
  });

  it('classifies console.warn catch body as logging-only (info)', () => {
    const body = '  try { doIt(); } catch (e) { console.warn("ignored", e); }';
    const findings = run(diffOf(body));
    assert.equal(findings.length, 1);
    assert.equal(findings[0]!.severity, 'info');
    assert.match(findings[0]!.message, /logging-only/);
  });

  it('classifies metric.increment catch body as metrics-only (info)', () => {
    const body = '  try { doIt(); } catch (e) { metrics.increment("err.count"); }';
    const findings = run(diffOf(body));
    assert.equal(findings.length, 1);
    assert.equal(findings[0]!.severity, 'info');
    assert.match(findings[0]!.message, /body-class: metrics-only/);
  });

  it('classifies prom.Counter inc() catch body as metrics-only', () => {
    const body =
      '  try { doIt(); } catch (e) { new Counter({ name: "errs" }).inc(); }';
    const findings = run(diffOf(body));
    assert.equal(findings.length, 1);
    assert.equal(findings[0]!.severity, 'info');
    assert.match(findings[0]!.message, /metrics-only/);
  });

  it('classifies literal-default assignment catch body as fallback-assignment (info)', () => {
    const body = '  try { doIt(); } catch (e) { result = null }';
    const findings = run(diffOf(body));
    assert.equal(findings.length, 1);
    assert.equal(findings[0]!.severity, 'info');
    assert.match(findings[0]!.message, /body-class: fallback-assignment/);
  });

  it('does NOT fire when the catch body throws (mixed-with-rethrow)', () => {
    const body = '  try { doIt(); } catch (e) { logger.error(e); throw e; }';
    assert.equal(run(diffOf(body)).length, 0);
  });

  it('does NOT fire when the catch returns the caught error', () => {
    const body = '  try { return doIt(); } catch (e) { return err(e); }';
    // Body contains `return err`; rethrow pattern.
    assert.equal(run(diffOf(body)).length, 0);
  });

  it('preserves the block severity on a bare empty catch (the real cheat)', () => {
    const findings = run(diffOf('  try { doIt(); } catch {}'));
    assert.equal(findings.length, 1);
    assert.equal(findings[0]!.severity, 'block');
  });

  it('preserves the info severity on a comment-only catch (legitimate idiom)', () => {
    const findings = run(diffOf('  try { doIt(); } catch (e) { /* idempotent */ }'));
    assert.equal(findings.length, 1);
    assert.equal(findings[0]!.severity, 'info');
    assert.match(findings[0]!.message, /body-class: comment-only/);
  });
});
