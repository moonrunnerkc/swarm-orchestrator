/**
 * `swarm ledger verify <run-id> [--ledger <path>]` checks a hash-chained
 * ledger at rest. The chain is already verified on every append; this is the
 * on-demand check an external auditor needs for a ledger handed to them after
 * the fact (e.g. attached to a release). Read-only: it never writes the ledger
 * or the workspace.
 *
 * Resolves the ledger from `<cwd>/.swarm/ledger/<run-id>.jsonl` by default;
 * `--ledger <path>` overrides, the same convention as `swarm stats`.
 *
 * Exit codes: 0 the chain is intact, 1 the chain is broken (the message names
 * the offending line), 2 a usage or input error (bad arguments, no run-id, or
 * a ledger that does not exist).
 */

import * as fs from 'fs';
import * as path from 'path';
import { ChainTamperedError, readEntries, verifyChainEntries } from '../../ledger/ledger';
import { readBoolean, readString, runParseArgs, type ParseArgsOptions } from './argv-schema';

const VERIFY_SCHEMA: ParseArgsOptions = {
  ledger: { type: 'string' },
  help: { type: 'boolean', short: 'h' },
};

function printLedgerUsage(): void {
  process.stderr.write(
    [
      'usage: swarm ledger verify <run-id> [flags]',
      '',
      'Verify a hash-chained ledger at rest.',
      '',
      'flags:',
      '  --ledger <path>   ledger jsonl path (default .swarm/ledger/<run-id>.jsonl)',
      '  --help, -h        show this message',
      '',
      'exit: 0 intact, 1 chain broken (names the line), 2 usage/input error',
      '',
    ].join('\n'),
  );
}

/** Dispatch the `ledger` verb. Only `verify` is defined today. */
export async function handleLedger(argv: string[]): Promise<number> {
  const sub = argv[0];
  if (sub === 'verify') return handleLedgerVerify(argv.slice(1));
  if (sub === undefined) {
    printLedgerUsage();
    return 2;
  }
  if (sub === '--help' || sub === '-h') {
    printLedgerUsage();
    return 0;
  }
  process.stderr.write(`unknown ledger subcommand: ${sub}\n`);
  printLedgerUsage();
  return 2;
}

function handleLedgerVerify(argv: string[]): number {
  let runId: string;
  let ledgerFlag: string | null;
  try {
    const { values, positionals } = runParseArgs(argv, VERIFY_SCHEMA);
    if (readBoolean(values, 'help')) {
      printLedgerUsage();
      return 0;
    }
    if (positionals.length === 0) {
      process.stderr.write('missing run-id: usage `swarm ledger verify <run-id> [--ledger <path>]`\n');
      return 2;
    }
    if (positionals.length > 1) {
      process.stderr.write('unexpected extra positional argument\n');
      return 2;
    }
    runId = positionals[0] ?? '';
    ledgerFlag = readString(values, 'ledger') ?? null;
  } catch (err) {
    process.stderr.write(`${(err as Error).message}\n`);
    return 2;
  }

  const ledgerPath = ledgerFlag ?? path.join(process.cwd(), '.swarm', 'ledger', `${runId}.jsonl`);
  if (!fs.existsSync(ledgerPath)) {
    process.stderr.write(`ledger not found at ${ledgerPath}\n`);
    return 2;
  }

  let entries;
  try {
    entries = readEntries(ledgerPath);
  } catch (err) {
    // A line that will not parse is corruption, not a usage error; report it
    // with the same exit code as a broken chain so a caller treats both as
    // "this ledger cannot be trusted".
    process.stderr.write(`TAMPERED: ${(err as Error).message}\n`);
    return 1;
  }

  try {
    verifyChainEntries(entries);
  } catch (err) {
    if (err instanceof ChainTamperedError) {
      process.stderr.write(`TAMPERED: ${err.message}\n`);
      return 1;
    }
    throw err;
  }

  process.stdout.write(`OK: ${ledgerPath} chain intact (${entries.length} entries)\n`);
  return 0;
}
