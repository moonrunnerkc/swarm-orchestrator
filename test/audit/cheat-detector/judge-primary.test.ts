import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import parseDiff from 'parse-diff';
import { runJudgePrimary } from '../../../src/audit/cheat-detector/judge-primary';
import { loadAuditConfig } from '../../../src/audit/cheat-detector/audit-config';
import type { JudgeClient } from '../../../src/audit/cheat-detector/llm-judge';

const DIFF =
  'diff --git a/src/x.ts b/src/x.ts\n--- a/src/x.ts\n+++ b/src/x.ts\n' +
  '@@ -1,1 +1,2 @@\n const a = 1;\n+const b = 2;\n';

function stubClient(answer: 'yes' | 'no' | 'unavailable'): JudgeClient {
  return {
    ask: async () => ({ raw: answer.toUpperCase(), answer, reason: 'stub reason' }),
  };
}

function tempRepo(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'judge-primary-'));
}

describe('cheat-detector / judge-primary', () => {
  it('raises an advisory (warn) finding by default when the judge says the claim is not delivered', async () => {
    const findings = await runJudgePrimary({
      unifiedDiff: DIFF,
      claim: 'fix null-pointer crash in parseConfig',
      repoRoot: tempRepo(),
      files: parseDiff(DIFF),
      categories: ['goal-not-fixed'],
      client: stubClient('yes'),
      allowLiveCall: true,
    });
    assert.equal(findings.length, 1);
    const f = findings[0];
    assert.ok(f !== undefined);
    assert.equal(f.category, 'goal-not-fixed');
    assert.equal(f.severity, 'warn');
    assert.equal(f.judgePrimary, true);
    assert.equal(f.location.file, 'src/x.ts');
  });

  it('raises a block finding only when block is opted in', async () => {
    const findings = await runJudgePrimary({
      unifiedDiff: DIFF,
      claim: 'fix null-pointer crash in parseConfig',
      repoRoot: tempRepo(),
      files: parseDiff(DIFF),
      categories: ['goal-not-fixed'],
      client: stubClient('yes'),
      allowLiveCall: true,
      block: true,
    });
    assert.equal(findings.length, 1);
    const f = findings[0];
    assert.ok(f !== undefined);
    assert.equal(f.severity, 'block');
  });

  it('raises nothing when the judge refutes', async () => {
    const findings = await runJudgePrimary({
      unifiedDiff: DIFF,
      claim: 'fix something',
      repoRoot: tempRepo(),
      files: parseDiff(DIFF),
      categories: ['goal-not-fixed', 'cheat-mock-mutation'],
      client: stubClient('no'),
      allowLiveCall: true,
    });
    assert.equal(findings.length, 0);
  });

  it('raises nothing when the judge is unavailable', async () => {
    const findings = await runJudgePrimary({
      unifiedDiff: DIFF,
      claim: 'fix something',
      repoRoot: tempRepo(),
      files: parseDiff(DIFF),
      categories: ['goal-not-fixed'],
      allowLiveCall: false,
    });
    assert.equal(findings.length, 0);
  });
});

describe('audit-config / judgePrimary', () => {
  function configFrom(yaml: string): ReturnType<typeof loadAuditConfig> {
    const dir = tempRepo();
    fs.mkdirSync(path.join(dir, '.swarm'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.swarm', 'audit-config.yaml'), yaml);
    return loadAuditConfig(dir);
  }

  it('defaults to enabled with both semantic categories when no file', () => {
    const cfg = loadAuditConfig(tempRepo());
    assert.equal(cfg.judgePrimary.enabled, true);
    assert.deepEqual([...cfg.judgePrimary.categories].sort(), [
      'cheat-mock-mutation',
      'goal-not-fixed',
    ]);
  });

  it('defaults block to false (advisory) when no file', () => {
    const cfg = loadAuditConfig(tempRepo());
    assert.equal(cfg.judgePrimary.block, false);
  });

  it('parses an explicit disable', () => {
    const cfg = configFrom('judgePrimary:\n  enabled: false\n');
    assert.equal(cfg.judgePrimary.enabled, false);
    assert.equal(cfg.judgePrimary.block, false);
  });

  it('parses block opt-in', () => {
    const cfg = configFrom('judgePrimary:\n  enabled: true\n  block: true\n');
    assert.equal(cfg.judgePrimary.enabled, true);
    assert.equal(cfg.judgePrimary.block, true);
  });

  it('parses an inline category list', () => {
    const cfg = configFrom('judgePrimary:\n  enabled: true\n  categories: [goal-not-fixed]\n');
    assert.equal(cfg.judgePrimary.enabled, true);
    assert.deepEqual([...cfg.judgePrimary.categories], ['goal-not-fixed']);
  });

  it('parses a block category list', () => {
    const cfg = configFrom(
      'judgePrimary:\n  categories:\n    - goal-not-fixed\n    - cheat-mock-mutation\n',
    );
    assert.deepEqual([...cfg.judgePrimary.categories].sort(), [
      'cheat-mock-mutation',
      'goal-not-fixed',
    ]);
  });
});
