import { strict as assert } from 'assert';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  appendFindingEntries,
  appendRestorationEntries,
  publishAuditVerdict,
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
// injectable transport), so these tests drive publishAuditVerdict, the one
// exported function runAudit calls after the execution-grounded layer
// returns. The ordering is pinned by construction: recomputing the pass flag,
// appending the finding entries, taking the gate decision, and appending the
// completed entry all happen inside that single seam, so nothing published
// (pass flag, finding entries, gate decision, completed entry) can contradict
// a restoration verdict that already rode onto a finding.

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
  describe('publishAuditVerdict', () => {
    it('a refuted demotion flips pass and every published artifact agrees', () => {
      const finding = blockFinding();
      const result = auditResult([finding]);
      assert.equal(result.pass, false, 'precondition: the block finding fails the audit');

      applyRestorationToFinding(finding, refutedRecord());
      assert.equal(finding.severity, 'info', 'precondition: restoration demoted the finding');

      const { ledger, ledgerPath } = makeLedger();
      const returned = publishAuditVerdict(
        {
          ledger,
          result,
          attribution: ATTRIBUTION,
          pr: { number: 7, repository: 'o/r' },
          wallTimeMs: 1234,
        },
        (pass) => ({ blocked: !pass }),
      );
      assert.equal(result.pass, true, 'execution cleared the only blocking finding');
      assert.deepEqual(returned, { blocked: false }, 'the gate decision saw the recomputed pass');

      const entries = readEntries(ledgerPath);
      assert.deepEqual(
        entries.map((e) => e.type),
        ['pr-audit-finding', 'pr-audit-completed'],
        'finding entries precede the completed entry',
      );
      const findingEntry = entries[0] as LedgerEntry<'pr-audit-finding'>;
      assert.equal(findingEntry.severity, 'info', 'the entry records the demoted severity');
      const completed = entries[1] as LedgerEntry<'pr-audit-completed'>;
      assert.equal(completed.pass, true);
      assert.equal(completed.blockingCount, 0);
      assert.match(completed.detail, /^audit pass — 1 non-blocking finding\(s\)$/);
      assert.equal(completed.prNumber, 7);
      assert.equal(completed.prRepository, 'o/r');
    });

    it('the gate decision runs after the finding entries and before the completed entry', () => {
      const demoted = blockFinding();
      applyRestorationToFinding(demoted, refutedRecord());
      const stillBlocking = blockFinding({
        category: 'test-relaxation',
        location: { file: 'test/other.test.ts', line: 9 },
      });
      const result = auditResult([demoted, stillBlocking]);
      const { ledger, ledgerPath } = makeLedger();
      publishAuditVerdict({ ledger, result, attribution: undefined, pr: undefined, wallTimeMs: 50 }, (pass) => {
        assert.equal(pass, false, 'a remaining block finding keeps pass false');
        const mid = readEntries(ledgerPath);
        assert.deepEqual(
          mid.map((e) => e.type),
          ['pr-audit-finding', 'pr-audit-finding'],
          'at decision time the finding entries are published, the completed entry is not',
        );
        return null;
      });
      const completedEntries = readEntries<'pr-audit-completed'>(ledgerPath).filter(
        (e) => e.type === 'pr-audit-completed',
      );
      assert.equal(completedEntries.length, 1);
      const completed = completedEntries[0]!;
      assert.equal(completed.pass, false);
      assert.equal(completed.blockingCount, 1);
      assert.match(completed.detail, /^audit block — 1 blocking finding\(s\)$/);
      assert.equal(completed.prNumber, null);
      assert.equal(completed.prRepository, null);
    });
  });

  describe('recomputeAuditPass', () => {
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
      appendRestorationEntries(ledger, [proven, refutedRecord()], ATTRIBUTION);

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
