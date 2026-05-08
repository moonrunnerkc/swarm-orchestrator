import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  HashChainedLedger,
  ChainTamperedError,
  GENESIS_PREV_HASH,
  canonicalJson,
  computeEntryHash,
  readEntries,
  verifyChainAt,
  verifyChainEntries,
} from '../../src/ledger/ledger';
import type {
  ObligationAttemptedEntry,
  ObligationSatisfiedEntry,
  RunFinishedEntry,
  RunStartedEntry,
} from '../../src/ledger/types';
import { emptyUsage } from '../../src/session/types';

function tmpFile(prefix = 'hash-chain-'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return path.join(dir, 'ledger.jsonl');
}

describe('ledger/hash-chain', () => {
  describe('canonicalJson', () => {
    it('sorts keys deterministically', () => {
      const a = canonicalJson({ b: 1, a: 2, c: { z: 1, y: 2 } });
      const b = canonicalJson({ a: 2, c: { y: 2, z: 1 }, b: 1 });
      assert.equal(a, b);
      assert.equal(a, '{"a":2,"b":1,"c":{"y":2,"z":1}}');
    });

    it('preserves array order', () => {
      const out = canonicalJson({ arr: [3, 1, 2] });
      assert.equal(out, '{"arr":[3,1,2]}');
    });

    it('handles primitives, null, and nested arrays of objects', () => {
      assert.equal(canonicalJson(null), 'null');
      assert.equal(canonicalJson(42), '42');
      assert.equal(canonicalJson('x'), '"x"');
      assert.equal(canonicalJson([{ b: 1, a: 2 }, { c: 3 }]), '[{"a":2,"b":1},{"c":3}]');
    });
  });

  describe('append + readAll', () => {
    it('chains the genesis entry from the all-zero digest', () => {
      const file = tmpFile();
      const led = new HashChainedLedger(file, 'r1');
      led.append<RunStartedEntry>({
        type: 'run-started',
        contractId: 'c',
        contractHash: 'h',
        obligationCount: 0,
        goal: 'g',
      });
      const entries = led.readAll();
      assert.equal(entries.length, 1);
      const first = entries[0];
      assert.ok(first);
      assert.equal(first.prevHash, GENESIS_PREV_HASH);
      assert.equal(first.entryHash.length, 64);
      assert.match(first.entryHash, /^[0-9a-f]{64}$/);
    });

    it('chains subsequent entries to the prior entryHash', () => {
      const file = tmpFile();
      const led = new HashChainedLedger(file, 'r1');
      led.append<RunStartedEntry>({
        type: 'run-started',
        contractId: 'c',
        contractHash: 'h',
        obligationCount: 0,
        goal: 'g',
      });
      led.append<RunFinishedEntry>({
        type: 'run-finished',
        satisfied: 0,
        failed: 0,
        totalUsage: emptyUsage(),
      });
      const entries = led.readAll();
      assert.equal(entries.length, 2);
      assert.equal(entries[1]?.prevHash, entries[0]?.entryHash);
    });

    it('verifyChain accepts a valid chain', () => {
      const file = tmpFile();
      const led = new HashChainedLedger(file, 'r1');
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
      led.append<ObligationSatisfiedEntry>({
        type: 'obligation-satisfied',
        obligationIndex: 0,
        obligationType: 'file-must-exist',
        detail: 'wrote x',
      });
      assert.doesNotThrow(() => led.verifyChain());
      assert.doesNotThrow(() => verifyChainAt(file));
    });
  });

  describe('verifyChain — tamper detection', () => {
    it('rejects an edited payload', () => {
      const file = tmpFile();
      const led = new HashChainedLedger(file, 'r1');
      led.append<RunStartedEntry>({
        type: 'run-started',
        contractId: 'c',
        contractHash: 'h',
        obligationCount: 1,
        goal: 'original goal',
      });
      led.append<RunFinishedEntry>({
        type: 'run-finished',
        satisfied: 0,
        failed: 0,
        totalUsage: emptyUsage(),
      });
      // Tamper: edit the goal string in the on-disk file.
      const text = fs.readFileSync(file, 'utf8');
      const tampered = text.replace('"original goal"', '"tampered goal"');
      fs.writeFileSync(file, tampered, 'utf8');
      assert.throws(
        () => verifyChainAt(file),
        (err: unknown) =>
          err instanceof ChainTamperedError && err.kind === 'entry-hash-mismatch',
      );
    });

    it('rejects a removed entry', () => {
      const file = tmpFile();
      const led = new HashChainedLedger(file, 'r1');
      led.append<RunStartedEntry>({
        type: 'run-started',
        contractId: 'c',
        contractHash: 'h',
        obligationCount: 0,
        goal: 'g',
      });
      led.append<RunFinishedEntry>({
        type: 'run-finished',
        satisfied: 0,
        failed: 0,
        totalUsage: emptyUsage(),
      });
      // Tamper: drop the first entry.
      const lines = fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.length > 0);
      fs.writeFileSync(file, lines.slice(1).join('\n') + '\n', 'utf8');
      assert.throws(() => verifyChainAt(file), ChainTamperedError);
    });

    it('rejects a reordered ledger', () => {
      const file = tmpFile();
      const led = new HashChainedLedger(file, 'r1');
      led.append<RunStartedEntry>({
        type: 'run-started',
        contractId: 'c',
        contractHash: 'h',
        obligationCount: 0,
        goal: 'g',
      });
      led.append<RunFinishedEntry>({
        type: 'run-finished',
        satisfied: 0,
        failed: 0,
        totalUsage: emptyUsage(),
      });
      const lines = fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.length > 0);
      // Swap entries so prevHash chain is broken.
      fs.writeFileSync(file, [lines[1], lines[0]].join('\n') + '\n', 'utf8');
      assert.throws(() => verifyChainAt(file), ChainTamperedError);
    });

    it('rejects a missing entryHash', () => {
      const file = tmpFile();
      const led = new HashChainedLedger(file, 'r1');
      led.append<RunStartedEntry>({
        type: 'run-started',
        contractId: 'c',
        contractHash: 'h',
        obligationCount: 0,
        goal: 'g',
      });
      const text = fs.readFileSync(file, 'utf8');
      // Strip the entryHash field.
      const tampered = text.replace(/,"entryHash":"[0-9a-f]{64}"/, '');
      fs.writeFileSync(file, tampered, 'utf8');
      assert.throws(
        () => verifyChainAt(file),
        (err: unknown) =>
          err instanceof ChainTamperedError && err.kind === 'malformed-header',
      );
    });

    it('refuses to chain onto a tampered file at construction', () => {
      const file = tmpFile();
      const led = new HashChainedLedger(file, 'r1');
      led.append<RunStartedEntry>({
        type: 'run-started',
        contractId: 'c',
        contractHash: 'h',
        obligationCount: 0,
        goal: 'g',
      });
      const text = fs.readFileSync(file, 'utf8');
      const tampered = text.replace(/"goal":"g"/, '"goal":"haxed"');
      fs.writeFileSync(file, tampered, 'utf8');
      assert.throws(
        () => new HashChainedLedger(file, 'r2'),
        ChainTamperedError,
      );
    });
  });

  describe('resume semantics', () => {
    it('continues seq numbering and chains from the prior tail', () => {
      const file = tmpFile();
      const led1 = new HashChainedLedger(file, 'r1');
      const e1 = led1.append<RunStartedEntry>({
        type: 'run-started',
        contractId: 'c',
        contractHash: 'h',
        obligationCount: 0,
        goal: 'g',
      });
      const e2 = led1.append<RunFinishedEntry>({
        type: 'run-finished',
        satisfied: 0,
        failed: 0,
        totalUsage: emptyUsage(),
      });
      const led2 = new HashChainedLedger(file, 'r2');
      assert.equal(led2.nextSeq(), 2);
      const e3 = led2.append<RunStartedEntry>({
        type: 'run-started',
        contractId: 'c',
        contractHash: 'h',
        obligationCount: 0,
        goal: 'g2',
      });
      assert.equal(e1.prevHash, GENESIS_PREV_HASH);
      assert.equal(e2.prevHash, e1.entryHash);
      assert.equal(e3.prevHash, e2.entryHash);
      assert.equal(e3.seq, 2);
      assert.doesNotThrow(() => verifyChainAt(file));
    });
  });

  describe('computeEntryHash determinism', () => {
    it('produces the same hash regardless of key order in source', () => {
      const a = computeEntryHash({ b: 1, a: 2, ts: 't', runId: 'r', seq: 0, prevHash: 'p' });
      const b = computeEntryHash({ ts: 't', a: 2, prevHash: 'p', b: 1, runId: 'r', seq: 0 });
      assert.equal(a, b);
    });
  });

  describe('readEntries', () => {
    it('skips blank lines and tolerates trailing newline', () => {
      const file = tmpFile();
      const led = new HashChainedLedger(file, 'r1');
      led.append<RunStartedEntry>({
        type: 'run-started',
        contractId: 'c',
        contractHash: 'h',
        obligationCount: 0,
        goal: 'g',
      });
      const text = fs.readFileSync(file, 'utf8');
      fs.writeFileSync(file, '\n\n' + text + '\n\n', 'utf8');
      const entries = readEntries(file);
      assert.equal(entries.length, 1);
    });

    it('verifyChainEntries accepts an empty ledger', () => {
      assert.doesNotThrow(() => verifyChainEntries([]));
    });
  });
});
