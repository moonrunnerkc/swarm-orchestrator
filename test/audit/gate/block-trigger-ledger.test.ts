import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { HashChainedLedger } from '../../../src/ledger/ledger';
import type { PrAuditBlockTriggerEntry } from '../../../src/ledger/types';
import { appendBlockTriggerEntry } from '../../../src/audit/gate/block-trigger-ledger';
import {
  blockTriggerEvidenceSha256,
  type BlockTrigger,
} from '../../../src/audit/gate/block-triggers';

const corroboratedTrigger: BlockTrigger = {
  kind: 'corroborated-under-constraint',
  summary: 'coverage-erosion corroborated at src/pay.ts:12',
  reproduce: 'swarm audit acme/widgets#7',
  evidence: {
    kind: 'corroborated-under-constraint',
    category: 'coverage-erosion',
    file: 'src/pay.ts',
    line: 12,
    signal: 'surviving-mutant',
    mutants: ['BlockStatement@src/pay.ts:12 -> Survived'],
    findingEvidence: '- assert()\n+ // removed',
  },
};

const obligationTrigger: BlockTrigger = {
  kind: 'obligation-failure',
  summary: 'test-must-pass failed',
  reproduce: 'npm test',
  evidence: {
    kind: 'obligation-failure',
    obligationType: 'test-must-pass',
    command: 'npm test',
    output: '1 failing',
    runsPassed: [false, false],
  },
};

describe('appendBlockTriggerEntry', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'block-trigger-ledger-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('writes a verifiable entry that pins the evidence and localizes the corroborated trigger', () => {
    const ledger = new HashChainedLedger(path.join(dir, 'audit.jsonl'), 'run-1');
    const written = appendBlockTriggerEntry(ledger, corroboratedTrigger, { eligible: false, blocked: false });

    assert.equal(written.type, 'pr-audit-block-trigger');
    assert.equal(written.trigger, 'corroborated-under-constraint');
    assert.equal(written.eligible, false);
    assert.equal(written.blocked, false);
    assert.equal(written.reproduce, 'swarm audit acme/widgets#7');
    assert.equal(written.evidenceSha256, blockTriggerEvidenceSha256(corroboratedTrigger.evidence));
    assert.equal(written.category, 'coverage-erosion');
    assert.equal(written.file, 'src/pay.ts');
    assert.equal(written.line, 12);

    ledger.verifyChain();
    const entries = ledger.readAll() as PrAuditBlockTriggerEntry[];
    assert.equal(entries.length, 1);
    assert.equal(entries[0]!.evidenceSha256, written.evidenceSha256);
  });

  it('records eligible and blocked flags and leaves non-localized triggers without file/line', () => {
    const ledger = new HashChainedLedger(path.join(dir, 'audit.jsonl'), 'run-2');
    const written = appendBlockTriggerEntry(ledger, obligationTrigger, { eligible: true, blocked: true });

    assert.equal(written.eligible, true);
    assert.equal(written.blocked, true);
    assert.equal(written.category, undefined);
    assert.equal(written.file, undefined);
    assert.equal(written.line, undefined);
    ledger.verifyChain();
  });
});
