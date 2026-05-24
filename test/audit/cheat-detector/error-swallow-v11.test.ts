// Tests for the error-swallow severity split. Bare empty catches
// stay severity 'block' (the real cheat pattern); comment-only catches
// downgrade to severity 'info' (legitimate intentional-swallow idioms
// the v10.1 real-corpus baseline showed produce a 23% FP rate).

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

describe('error-swallow severity split (bare vs. comment-only)', () => {
  it('declares a 2.x detector version', () => {
    assert.ok(errorSwallowDetector.version.startsWith('2.'));
  });

  describe('bare empty catch (cheat pattern) → block', () => {
    it('blocks `} catch {}`', () => {
      const findings = run(diffOf('  try { doIt(); } catch {}'));
      assert.equal(findings.length, 1);
      assert.equal(findings[0]?.severity, 'block');
      assert.match(findings[0]?.message ?? '', /bare empty catch/);
    });

    it('blocks `} catch (e) {}` (named parameter, empty body)', () => {
      const findings = run(diffOf('  try { doIt(); } catch (e) {}'));
      assert.equal(findings.length, 1);
      assert.equal(findings[0]?.severity, 'block');
    });

    it('blocks Python `except: pass`', () => {
      const findings = run(diffOf('  try:\n    do_it()\n  except: pass'));
      assert.equal(findings.length, 1);
      assert.equal(findings[0]?.severity, 'block');
    });
  });

  describe('comment-only catch (legitimate idiom) → info, not block', () => {
    it('downgrades line-comment catch to info', () => {
      const findings = run(diffOf('  try { doIt(); } catch (e) { // intentional swallow }'));
      assert.equal(findings.length, 1);
      assert.equal(findings[0]?.severity, 'info');
      assert.match(findings[0]?.message ?? '', /comment-only catch/);
    });

    it('downgrades block-comment catch to info', () => {
      const findings = run(diffOf('  try { doIt(); } catch (e) { /* column may already exist */ }'));
      assert.equal(findings.length, 1);
      assert.equal(findings[0]?.severity, 'info');
    });

    it('downgrades the bookforge idempotent-DDL pattern (the real-corpus FP that drove this change)', () => {
      const ddl =
        '  for (const [col, sql] of migrations) {\n' +
        '    if (!cols.includes(col)) {\n' +
        '      try { conn.exec(sql); } catch (e) { /* column may already exist */ }\n' +
        '    }\n' +
        '  }';
      const findings = run(diffOf(ddl));
      assert.equal(findings.length, 1);
      assert.equal(findings[0]?.severity, 'info');
    });
  });

  describe('not a catch at all → no finding', () => {
    it('does not fire when the catch has both a comment and a real statement', () => {
      const body = '  try { doIt(); } catch (e) { /* log and rethrow */ logger.error(e); throw e; }';
      assert.equal(run(diffOf(body)).length, 0);
    });

    it('does not fire when there is no try/catch at all', () => {
      assert.equal(run(diffOf('  return doIt();')).length, 0);
    });
  });
});
