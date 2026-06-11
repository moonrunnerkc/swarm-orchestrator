import { strict as assert } from 'assert';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  appendFindingEntries,
  appendRestorationEntries,
  buildCompletedEntry,
  recomputeAuditPass,
} from '../../../src/cli/v8/audit-handler';
import { applyRestorationToFinding } from '../../../src/audit/execution-grounded';
import { HashChainedLedger } from '../../../src/ledger/ledger';
import type { AuditResult, Finding } from '../../../src/audit/types';
import type { RestorationProofRecord } from '../../../src/audit/execution-grounded/test-restoration';
import type {
  LedgerAgentAttribution,
  LedgerEntry,
  LedgerEntryType,
} from '../../../src/ledger/types';

// The audit handler's publishing seam. Driving handleAudit end-to-end with
// the execution-grounded layer active requires a --pr input, and a --pr input
// resolves its PR context through the live GitHub API (pr-fetch has no
// injectable transport), so these tests exercise the exported helpers the
// handler calls, in the exact order runAudit calls them after the
// execution-grounded layer returns: recomputeAuditPass, then
// appendFindingEntries, then buildCompletedEntry. What they pin is the
// invariant the ordering exists for: nothing published (pass flag, finding
// entries, completed entry) may contradict a restoration verdict that already
// rode onto a finding.

function blockFinding(over: Partial<Finding> = {}): Finding {
  return {
    category: 'assertion-strip',
    severity: 'block',
    message: 'assertion removed from test',
    location: { file: 'test/calc.test.ts', line: 4 },
    evidence: '-  expect(add(1, 2)).toBe(3);',
    ...over,
  };
}

function refutedRecord(): RestorationProofRecord {
  return {
    schemaVersion: 1,
    verdict: 'refuted',
    category: 'assertion-strip',
    findingFile: 'test/calc.test.ts',
    testFiles: ['test/calc.test.ts'],
    failingTests: [],
    controls: {
      baseTestPasses: null,
      tamperedSuitePasses: true,
      restoredFailsTwiceSameIdentity: false,
    },
    reproduceCommand: '',
    revertedHunkPatch: '',
  };
}

function auditResult(findings: Finding[]): AuditResult {
  return {
    pass: findings.every((f) => f.severity !== 'block'),
    findings,
    generatedAt: new Date().toISOString(),
    detectorVersions: { 'assertion-strip': '1.0.0' },
    detectorSet: 'default',
  };
}

const ATTRIBUTION: LedgerAgentAttribution = {
  vendor: 'claude-code',
  confidence: 'high',
  source: 'commit-trailer',
};

const tempDirs: string[] = [];

function makeLedger(): { ledger: HashChainedLedger; ledgerPath: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-audit-handler-'));
  tempDirs.push(dir);
  const ledgerPath = path.join(dir, 'ledger.jsonl');
  return { ledger: new HashChainedLedger(ledgerPath, 'audit-test'), ledgerPath };
}

function readEntries<K extends LedgerEntryType>(ledgerPath: string): Array<LedgerEntry<K>> {
  return fs
    .readFileSync(ledgerPath, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as LedgerEntry<K>);
}

after(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

describe('cli/v8 audit-handler publishing seam', () => {
  describe('recomputeAuditPass', () => {
    it('a refuted demotion flips pass to true and the completed entry agrees', () => {
      const finding = blockFinding();
      const result = auditResult([finding]);
      assert.equal(result.pass, false, 'precondition: the block finding fails the audit');

      applyRestorationToFinding(finding, refutedRecord());
      assert.equal(finding.severity, 'info', 'precondition: restoration demoted the finding');

      recomputeAuditPass(result);
      assert.equal(result.pass, true, 'execution cleared the only blocking finding');

      const entry = buildCompletedEntry(result, { number: 7, repository: 'o/r' }, 1234);
      assert.equal(entry.pass, true);
      assert.equal(entry.blockingCount, 0);
      assert.match(entry.detail, /^audit pass — 1 non-blocking finding\(s\)$/);
    });

    it('advisory execution-grounded findings never flip pass on their own', () => {
      const demoted = blockFinding();
      applyRestorationToFinding(demoted, refutedRecord());
      const egFinding: Finding = {
        category: 'mutation-survives-on-changed-line',
        severity: 'warn',
        message: 'a mutation survived',
        location: { file: 'src/calc.ts', line: 2 },
        evidence: 'mutation ArithmeticOperator @ src/calc.ts:2 -> Survived',
      };
      const result = auditResult([demoted, egFinding]);
      recomputeAuditPass(result);
      assert.equal(result.pass, true, 'warn/info severities do not block');
    });

    it('a remaining block finding keeps pass false and the completed entry consistent', () => {
      const demoted = blockFinding();
      applyRestorationToFinding(demoted, refutedRecord());
      const stillBlocking = blockFinding({
        category: 'test-relaxation',
        location: { file: 'test/other.test.ts', line: 9 },
      });
      const result = auditResult([demoted, stillBlocking]);
      recomputeAuditPass(result);
      assert.equal(result.pass, false);

      const entry = buildCompletedEntry(result, undefined, 50);
      assert.equal(entry.pass, false);
      assert.equal(entry.blockingCount, 1);
      assert.match(entry.detail, /^audit block — 1 blocking finding\(s\)$/);
      assert.equal(entry.prNumber, null);
      assert.equal(entry.prRepository, null);
    });
  });

  describe('appendFindingEntries', () => {
    it('entries reflect the post-demotion state: severity and evidence hash as published', () => {
      const finding = blockFinding();
      applyRestorationToFinding(finding, refutedRecord());

      const { ledger, ledgerPath } = makeLedger();
      appendFindingEntries(ledger, [finding], ATTRIBUTION);

      const entries = readEntries<'pr-audit-finding'>(ledgerPath);
      assert.equal(entries.length, 1);
      const entry = entries[0]!;
      assert.equal(entry.type, 'pr-audit-finding');
      assert.equal(entry.severity, 'info', 'the entry records the demoted severity');
      assert.equal(
        entry.evidenceSha256,
        crypto.createHash('sha256').update(finding.evidence).digest('hex'),
        'the hash covers the evidence including the demotion note',
      );
      assert.equal(entry.aiAgent?.vendor, 'claude-code');
    });

    it('skips execution-grounded findings (they have dedicated entry kinds)', () => {
      const egFinding: Finding = {
        category: 'uncovered-changed-line',
        severity: 'info',
        message: 'not executed by any test',
        location: { file: 'src/calc.ts', line: 3 },
        evidence: 'uncovered changed line src/calc.ts:3',
      };
      const { ledger, ledgerPath } = makeLedger();
      appendFindingEntries(ledger, [egFinding, blockFinding()], undefined);

      const entries = readEntries<'pr-audit-finding'>(ledgerPath);
      assert.equal(entries.length, 1, 'only the structural finding is recorded here');
      assert.equal(entries[0]!.category, 'assertion-strip');
    });

    it('routes judge-primary findings to their own entry kind', () => {
      const primary = blockFinding({
        category: 'goal-not-fixed',
        judgePrimary: true,
        judgeModelId: 'claude-haiku-test',
        judgeReasoning: 'the diff does not deliver the claim',
      });
      const { ledger, ledgerPath } = makeLedger();
      appendFindingEntries(ledger, [primary], ATTRIBUTION);

      const entries = readEntries<'pr-audit-judge-primary'>(ledgerPath);
      assert.equal(entries.length, 1);
      assert.equal(entries[0]!.type, 'pr-audit-judge-primary');
      assert.equal(entries[0]!.modelId, 'claude-haiku-test');
    });
  });

  describe('appendRestorationEntries', () => {
    it('appends one pr-audit-restoration entry per record with attribution', () => {
      const proven: RestorationProofRecord = {
        ...refutedRecord(),
        verdict: 'proven',
        failingTests: ['calc › adds'],
        controls: {
          baseTestPasses: true,
          tamperedSuitePasses: true,
          restoredFailsTwiceSameIdentity: true,
        },
        reproduceCommand: 'git fetch origin pull/7/head && npx mocha test/calc.test.ts',
      };
      const { ledger, ledgerPath } = makeLedger();
      appendRestorationEntries(ledger, [proven, refutedRecord()], { aiAgent: ATTRIBUTION });

      const entries = readEntries<'pr-audit-restoration'>(ledgerPath);
      assert.equal(entries.length, 2);
      assert.equal(entries[0]!.type, 'pr-audit-restoration');
      assert.equal(entries[0]!.verdict, 'proven');
      assert.deepEqual(entries[0]!.failingTests, ['calc › adds']);
      assert.deepEqual(entries[0]!.controls, {
        baseTestPasses: true,
        tamperedSuitePasses: true,
        restoredFailsTwiceSameIdentity: true,
      });
      assert.equal(entries[1]!.verdict, 'refuted');
      for (const entry of entries) {
        assert.equal(entry.aiAgent?.vendor, 'claude-code');
      }
    });
  });
});
