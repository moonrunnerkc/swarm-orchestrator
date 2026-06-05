import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { handleLedger } from '../../../src/cli/v8/ledger-verify-handler';
import { HashChainedLedger } from '../../../src/ledger/ledger';
import type { RunFinishedEntry, RunStartedEntry } from '../../../src/ledger/types';
import { emptyUsage } from '../../../src/session/types';

/** Build a valid two-entry hash-chained ledger and return its path. */
function writeLedger(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-ledger-verify-'));
  const file = path.join(dir, 'ledger.jsonl');
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
    satisfied: 1,
    failed: 0,
    totalUsage: emptyUsage(),
  });
  return file;
}

/** Run the handler with stdout/stderr captured. */
async function run(argv: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  let stdout = '';
  let stderr = '';
  const outWrite = process.stdout.write.bind(process.stdout);
  const errWrite = process.stderr.write.bind(process.stderr);
  (process.stdout.write as unknown) = (chunk: string | Uint8Array): boolean => {
    stdout += chunk.toString();
    return true;
  };
  (process.stderr.write as unknown) = (chunk: string | Uint8Array): boolean => {
    stderr += chunk.toString();
    return true;
  };
  try {
    const code = await handleLedger(argv);
    return { code, stdout, stderr };
  } finally {
    process.stdout.write = outWrite;
    process.stderr.write = errWrite;
  }
}

describe('cli/v8 ledger verify', () => {
  it('exits 0 and reports the entry count on an intact chain', async () => {
    const file = writeLedger();
    const { code, stdout } = await run(['verify', 'r1', '--ledger', file]);
    assert.equal(code, 0);
    assert.match(stdout, /OK:/);
    assert.match(stdout, /2 entries/);
  });

  it('exits 1 and names the offending line on a tampered chain', async () => {
    const file = writeLedger();
    // Edit the first entry's payload so its recomputed entryHash no longer
    // matches, breaking the chain at the next link.
    const text = fs.readFileSync(file, 'utf8');
    fs.writeFileSync(file, text.replace('"original goal"', '"tampered goal"'), 'utf8');
    const { code, stderr } = await run(['verify', 'r1', '--ledger', file]);
    assert.equal(code, 1);
    assert.match(stderr, /TAMPERED:/);
    assert.match(stderr, /line \d+/, 'the failure names the offending line');
  });

  it('exits 1 on a line that does not parse as JSON', async () => {
    const file = writeLedger();
    fs.appendFileSync(file, 'this is not json\n', 'utf8');
    const { code, stderr } = await run(['verify', 'r1', '--ledger', file]);
    assert.equal(code, 1);
    assert.match(stderr, /TAMPERED:/);
  });

  it('exits 2 when the run-id is missing', async () => {
    const { code, stderr } = await run(['verify']);
    assert.equal(code, 2);
    assert.match(stderr, /missing run-id/);
  });

  it('exits 2 when the ledger file does not exist', async () => {
    const { code, stderr } = await run(['verify', 'no-such-run', '--ledger', '/tmp/swarm-does-not-exist.jsonl']);
    assert.equal(code, 2);
    assert.match(stderr, /ledger not found/);
  });

  it('exits 2 on an unknown subcommand', async () => {
    const { code, stderr } = await run(['frobnicate']);
    assert.equal(code, 2);
    assert.match(stderr, /unknown ledger subcommand/);
  });
});
