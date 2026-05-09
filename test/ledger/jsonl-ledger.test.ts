import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { JsonlLedger, readEntries } from '../../src/ledger/jsonl-ledger';
import type {
  ObligationAttemptedEntry,
  RunFinishedEntry,
  RunStartedEntry,
} from '../../src/ledger/types';
import { emptyUsage } from '../../src/session/types';

function tmpFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jsonl-ledger-'));
  return path.join(dir, 'ledger.jsonl');
}

describe('ledger/JsonlLedger', () => {
  it('appends entries with monotonic sequence and stamps headers', () => {
    const file = tmpFile();
    const led = new JsonlLedger(file, 'run-1');
    led.append<RunStartedEntry>({
      type: 'run-started',
      contractId: 'c',
      contractHash: 'h',
      obligationCount: 1,
      goal: 'g',
    });
    led.append<ObligationAttemptedEntry>({
      type: 'obligation-attempted',
      obligationIndex: 0,
      obligationType: 'file-must-exist',
      personaId: 'architect',
    });
    led.append<RunFinishedEntry>({
      type: 'run-finished',
      satisfied: 1,
      failed: 0,
      totalUsage: emptyUsage(),
    });

    const entries = led.readAll();
    assert.equal(entries.length, 3);
    assert.deepEqual(
      entries.map((e) => e.seq),
      [0, 1, 2],
    );
    for (const e of entries) {
      assert.equal(e.runId, 'run-1');
      assert.match(e.ts, /^\d{4}-\d{2}-\d{2}T/);
    }
  });

  it('readEntries skips blank lines and surfaces malformed JSON', () => {
    const file = tmpFile();
    fs.writeFileSync(
      file,
      ['{"type":"run-started","contractId":"c","contractHash":"h","obligationCount":0,"goal":"g","ts":"t","runId":"r","seq":0}', '', 'not-json'].join('\n'),
    );
    assert.throws(() => readEntries(file), /not valid JSON/);
  });

  it('resuming an existing ledger continues the sequence', () => {
    const file = tmpFile();
    const a = new JsonlLedger(file, 'r');
    a.append<RunStartedEntry>({
      type: 'run-started',
      contractId: 'c',
      contractHash: 'h',
      obligationCount: 0,
      goal: 'g',
    });
    a.append<RunFinishedEntry>({
      type: 'run-finished',
      satisfied: 0,
      failed: 0,
      totalUsage: emptyUsage(),
    });
    const b = new JsonlLedger(file, 'r');
    assert.equal(b.nextSeq(), 2);
    b.append<RunFinishedEntry>({
      type: 'run-finished',
      satisfied: 1,
      failed: 0,
      totalUsage: emptyUsage(),
    });
    const entries = readEntries(file);
    assert.equal(entries.length, 3);
    assert.deepEqual(entries.map((e) => e.seq), [0, 1, 2]);
  });
});
