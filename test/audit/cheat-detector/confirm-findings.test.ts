import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { confirmFindings } from '../../../src/audit/cheat-detector/confirm-findings';
import type { JudgeClient } from '../../../src/audit/cheat-detector/llm-judge';
import type { Finding } from '../../../src/audit/types';

function block(category: Finding['category']): Finding {
  return {
    category,
    severity: 'block',
    message: 'm',
    location: { file: 'src/a.ts', line: 1 },
    evidence: 'e',
  };
}

function clientReturning(answer: 'yes' | 'no'): JudgeClient {
  return {
    ask: async () => ({ raw: `${answer.toUpperCase()} reason`, answer, reason: 'because' }),
  };
}

function tmpRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-confirm-'));
}

describe('cheat-detector / confirm-findings', () => {
  it('downgrades a block to advisory when the judge refutes it', async () => {
    const repoRoot = tmpRoot();
    const { findings, refuted } = await confirmFindings([block('error-swallow')], {
      unifiedDiff: 'diff',
      prTitle: 'fix x',
      repoRoot,
      client: clientReturning('no'),
    });
    assert.equal(findings[0]!.severity, 'warn');
    assert.equal(refuted.length, 1);
    assert.match(findings[0]!.judgeReasoning ?? '', /refuted/);
  });

  it('keeps a block when the judge confirms it, attaching reasoning', async () => {
    const repoRoot = tmpRoot();
    const { findings, refuted } = await confirmFindings([block('error-swallow')], {
      unifiedDiff: 'diff',
      prTitle: 'fix x',
      repoRoot,
      client: clientReturning('yes'),
    });
    assert.equal(findings[0]!.severity, 'block');
    assert.equal(refuted.length, 0);
    assert.equal(findings[0]!.judgeReasoning, 'because');
  });

  it('leaves the deterministic verdict standing when the judge is unavailable', async () => {
    const repoRoot = tmpRoot();
    const { findings } = await confirmFindings([block('error-swallow')], {
      unifiedDiff: 'diff',
      prTitle: 'fix x',
      repoRoot,
      allowLiveCall: false,
    });
    assert.equal(findings[0]!.severity, 'block');
  });

  it('does not touch advisory findings or non-confirmable categories', async () => {
    const repoRoot = tmpRoot();
    const warnFinding: Finding = { ...block('error-swallow'), severity: 'warn' };
    const other = block('comment-only-fix');
    const { findings } = await confirmFindings([warnFinding, other], {
      unifiedDiff: 'diff',
      prTitle: 'fix x',
      repoRoot,
      client: clientReturning('no'),
    });
    assert.equal(findings[0]!.severity, 'warn');
    assert.equal(findings[1]!.severity, 'block');
  });
});
