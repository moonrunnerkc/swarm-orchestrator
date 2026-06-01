// Tests for the v2.0 catch-body classification on error-swallow.
// v1.x distinguished bare vs. comment-only; v2.0 adds logging-only,
// metrics-only, and fallback-assignment classifications and emits
// `info` severity (with body-class metadata in the message) for each
// of the three legitimate shapes. The real cheat pattern stays at
// `block`.

import { strict as assert } from 'assert';
import parseDiff from 'parse-diff';
import { errorSwallowDetector, __testing } from '../../../src/audit/cheat-detector/error-swallow';
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

describe('error-swallow v2.1 catch-body classification', () => {
  // v2.1: the body shapes the detector classifies as "typically
  // legitimate" (logging-only, metrics-only, fallback-assignment) are no
  // longer surfaced as findings. A real-PR pilot showed they are noise a
  // maintainer would disable the auditor over. The classifier still
  // distinguishes them (verified via __testing.classifyCatch) so the
  // distinction is preserved; only the emission is suppressed.
  it('does not surface a logger.error catch body (classified logging-only)', () => {
    const body = '  try { doIt(); } catch (e) { logger.error("failed", e); }';
    assert.equal(run(diffOf(body)).length, 0);
    assert.equal(
      __testing.classifyCatch('try { doIt(); } catch (e) { logger.error("failed", e); }'),
      'logging-only',
    );
  });

  it('does not surface a console.warn catch body (classified logging-only)', () => {
    const body = '  try { doIt(); } catch (e) { console.warn("ignored", e); }';
    assert.equal(run(diffOf(body)).length, 0);
  });

  it('does not surface a metric.increment catch body (classified metrics-only)', () => {
    const body = '  try { doIt(); } catch (e) { metrics.increment("err.count"); }';
    assert.equal(run(diffOf(body)).length, 0);
    assert.equal(
      __testing.classifyCatch('try { doIt(); } catch (e) { metrics.increment("err.count"); }'),
      'metrics-only',
    );
  });

  it('does not surface a prom.Counter inc() catch body (classified metrics-only)', () => {
    const body =
      '  try { doIt(); } catch (e) { new Counter({ name: "errs" }).inc(); }';
    assert.equal(run(diffOf(body)).length, 0);
  });

  it('does not surface a literal-default assignment catch body (classified fallback-assignment)', () => {
    const body = '  try { doIt(); } catch (e) { result = null }';
    assert.equal(run(diffOf(body)).length, 0);
    assert.equal(
      __testing.classifyCatch('try { doIt(); } catch (e) { result = null }'),
      'fallback-assignment',
    );
  });

  it('does not flag a pre-existing bare catch that the PR only re-indented', () => {
    // nrwl/nx#34951: an existing `} catch {}` was wrapped in a new `if`,
    // so the formatter re-indented it and the diff marks it both removed
    // (old indent) and added (new indent). The PR did not introduce the
    // swallow, so it must not be flagged.
    const diff =
      'diff --git a/src/x.ts b/src/x.ts\n' +
      '--- a/src/x.ts\n' +
      '+++ b/src/x.ts\n' +
      '@@ -1,4 +1,6 @@\n' +
      ' function f() {\n' +
      '-    try {\n' +
      '-      doIt();\n' +
      '-    } catch {}\n' +
      '+    if (enabled) {\n' +
      '+      try {\n' +
      '+        doIt();\n' +
      '+      } catch {}\n' +
      '+    }\n';
    assert.equal(run(diff).length, 0);
  });

  it('still flags a newly added bare catch (no matching deleted line)', () => {
    const findings = run(diffOf('  try { doIt(); } catch {}'));
    assert.equal(findings.length, 1);
    assert.equal(findings[0]!.severity, 'block');
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
