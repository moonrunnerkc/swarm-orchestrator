import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { appendWorkVerifiedEntry } from '../../../src/cli/v8/audit-handler';
import { composeMergeDecision } from '../../../src/audit/gate/merge-decision';
import { HashChainedLedger } from '../../../src/ledger/ledger';
import type { PrAuditWorkVerifiedEntry } from '../../../src/ledger/types';

function freshLedger(): HashChainedLedger {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-workverified-'));
  return new HashChainedLedger(path.join(dir, 'ledger.jsonl'), 'audit-workverified-test');
}

describe('audit-handler / pr-audit-work-verified', () => {
  it('records an AUTO-MERGE verdict with all passing controls and no reasons', () => {
    const ledger = freshLedger();
    const decision = composeMergeDecision({
      egViable: true,
      egViabilityReason: '',
      negativeGateClean: true,
      negativeGateDetail: '',
      controls: [
        { id: 'build-must-pass', kind: 'build', status: 'pass', detail: 'build ok' },
        { id: 'test-must-pass', kind: 'test', status: 'pass', detail: '42 tests ok' },
      ],
    });
    appendWorkVerifiedEntry(ledger, decision, { vendor: 'claude-code', confidence: 'high', source: 'bot-author' });

    ledger.verifyChain();
    const entries = ledger.readAll();
    const entry = entries.find(
      (e): e is PrAuditWorkVerifiedEntry => e.type === 'pr-audit-work-verified',
    );
    assert.ok(entry, 'work-verified entry must be written');
    assert.equal(entry.verdict, 'auto-merge');
    assert.equal(entry.egViable, true);
    assert.equal(entry.negativeGateClean, true);
    assert.equal(entry.controls.length, 2);
    assert.equal(entry.controls[0]?.status, 'pass');
    assert.equal(entry.reasons.length, 0);
    assert.equal(entry.aiAgent?.vendor, 'claude-code');
  });

  it('records a HUMAN verdict with the fail and unavailable reasons verbatim', () => {
    const ledger = freshLedger();
    const decision = composeMergeDecision({
      egViable: true,
      egViabilityReason: '',
      negativeGateClean: false,
      negativeGateDetail: 'test-tamper-proven',
      controls: [
        { id: 'test-must-pass', kind: 'test', status: 'fail', detail: '3 tests failed' },
        { id: 'falsifier', kind: 'falsifier', status: 'unavailable', detail: 'no adapter configured' },
      ],
    });
    appendWorkVerifiedEntry(ledger, decision, undefined);

    ledger.verifyChain();
    const entry = ledger
      .readAll()
      .find((e): e is PrAuditWorkVerifiedEntry => e.type === 'pr-audit-work-verified');
    assert.ok(entry);
    assert.equal(entry.verdict, 'human');
    const codes = entry.reasons.map((r) => r.code).sort();
    assert.deepEqual(codes, [
      'negative-gate-blocked',
      'positive-control-failed',
      'positive-control-unavailable',
    ]);
    // The unavailable falsifier is recorded as not-proven, never as a pass.
    const falsifier = entry.controls.find((c) => c.kind === 'falsifier');
    assert.equal(falsifier?.status, 'unavailable');
  });
});
