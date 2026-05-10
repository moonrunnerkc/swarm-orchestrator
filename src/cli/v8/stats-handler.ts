/**
 * `swarm v8 stats <run-id>` aggregates a run's ledger and prints
 * diagnostic counts. Read-only; never modifies the ledger or workspace.
 *
 * Output (one section per category, plain text, no JSON unless
 * `--json` passed):
 *  - Run summary: contract id, mode, total obligations, satisfied,
 *    failed, wall time.
 *  - Rollbacks: total count, breakdown by trigger
 *    (per-obligation-falsification vs post-merge-regression),
 *    per-obligation-type rollback count.
 *  - Falsification: counter-examples found per adapter, with
 *    obligation-type breakdown.
 *  - Files touched: top 10 paths by mutation count across the run.
 *
 * Uses the existing `JsonlLedger` reader (no new file format). Resolves
 * the ledger path from `<repo>/.swarm/ledger/<run-id>.jsonl` by
 * default; `--ledger <path>` overrides.
 */

import * as path from 'path';
import { readEntries } from '../../ledger/jsonl-ledger';
import type { LedgerEntry } from '../../ledger/types';

interface StatsFlags {
  runId: string;
  ledgerPath: string | null;
  json: boolean;
}

function parseStatsFlags(argv: string[]): StatsFlags {
  const flags: StatsFlags = {
    runId: '',
    ledgerPath: null,
    json: false,
  };
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i] ?? '';
    if (arg === '--ledger') {
      flags.ledgerPath = requireValue(argv, ++i, '--ledger');
    } else if (arg === '--json') {
      flags.json = true;
    } else if (arg.startsWith('--')) {
      throw new Error(`unknown flag: ${arg}`);
    } else {
      if (flags.runId.length > 0) throw new Error('unexpected extra positional argument');
      flags.runId = arg;
    }
    i += 1;
  }
  if (flags.runId.length === 0) {
    throw new Error('missing run-id: usage `swarm v8 stats <run-id> [flags]`');
  }
  return flags;
}

function requireValue(argv: string[], index: number, flag: string): string {
  const v = argv[index];
  if (v === undefined || v.startsWith('--')) {
    throw new Error(`flag ${flag} requires a value`);
  }
  return v;
}

function formatPlain(stats: RunStats): string {
  const lines: string[] = [];
  lines.push(`Run: ${stats.runId}`);
  lines.push(`  mode: ${stats.mode}`);
  lines.push(`  obligations: ${stats.satisfied}/${stats.totalObligations} satisfied`);
  lines.push(`  failed: ${stats.failed}`);
  lines.push(`  wallTimeMs: ${stats.wallTimeMs}`);
  lines.push('');
  lines.push(`Rollbacks: ${stats.rollbackCount}`);
  for (const [trigger, count] of Object.entries(stats.rollbackByTrigger)) {
    lines.push(`  ${trigger}: ${count}`);
  }
  for (const [type, count] of Object.entries(stats.rollbackByObligationType)) {
    lines.push(`  ${type}: ${count}`);
  }
  lines.push('');
  lines.push(`Falsifications: ${stats.falsificationCount}`);
  for (const [adapter, count] of Object.entries(stats.falsificationByAdapter)) {
    lines.push(`  ${adapter}: ${count}`);
  }
  for (const [type, count] of Object.entries(stats.falsificationByObligationType)) {
    lines.push(`  ${type}: ${count}`);
  }
  lines.push('');
  lines.push('Files touched (top 10):');
  for (const [f, count] of stats.topFiles) {
    lines.push(`  ${f}: ${count}`);
  }
  return lines.join('\n');
}

interface RunStats {
  runId: string;
  mode: 'single' | 'tournament';
  totalObligations: number;
  satisfied: number;
  failed: number;
  wallTimeMs: number;
  rollbackCount: number;
  rollbackByTrigger: Record<string, number>;
  rollbackByObligationType: Record<string, number>;
  falsificationCount: number;
  falsificationByAdapter: Record<string, number>;
  falsificationByObligationType: Record<string, number>;
  topFiles: Array<[string, number]>;
}

function computeStats(entries: LedgerEntry[], runId: string): RunStats {
  let totalObligations = 0;
  let satisfied = 0;
  let failed = 0;
  const rollbackByTrigger: Record<string, number> = {};
  const rollbackByObligationType: Record<string, number> = {};
  const falsificationByAdapter: Record<string, number> = {};
  const falsificationByObligationType: Record<string, number> = {};
  const fileTouches: Map<string, number> = new Map();
  let rollbackCount = 0;
  let falsificationCount = 0;
  let firstTs: string | null = null;
  let runFinishedTs: string | null = null;
  let mode: 'single' | 'tournament' = 'single';

  for (const e of entries) {
    if (firstTs === null) firstTs = e.ts;
    if (e.type === 'run-started') {
      totalObligations = e.obligationCount;
    } else if (e.type === 'run-finished') {
      satisfied = e.satisfied;
      failed = e.failed;
      runFinishedTs = e.ts;
    } else if (e.type === 'tournament-round-started') {
      mode = 'tournament';
    } else if (e.type === 'obligation-rolled-back') {
      rollbackCount += 1;
      rollbackByTrigger[e.trigger] = (rollbackByTrigger[e.trigger] ?? 0) + 1;
      const obligationType = findObligationType(entries, e.obligationIndex);
      if (obligationType) {
        rollbackByObligationType[obligationType] =
          (rollbackByObligationType[obligationType] ?? 0) + 1;
      }
    } else if (e.type === 'falsification-call') {
      if (e.counterExamplesFound > 0) {
        falsificationCount += 1;
        falsificationByAdapter[e.adapterName] = (falsificationByAdapter[e.adapterName] ?? 0) + 1;
        falsificationByObligationType[e.obligationType] =
          (falsificationByObligationType[e.obligationType] ?? 0) + 1;
      }
    } else if (e.type === 'workspace-snapshot') {
      for (const f of e.files) {
        fileTouches.set(f.path, (fileTouches.get(f.path) ?? 0) + 1);
      }
    }
  }

  const wallTimeMs =
    firstTs !== null && runFinishedTs !== null
      ? Math.max(0, Date.parse(runFinishedTs) - Date.parse(firstTs))
      : 0;

  const topFiles = [...fileTouches.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);

  return {
    runId,
    mode,
    totalObligations,
    satisfied,
    failed,
    wallTimeMs,
    rollbackCount,
    rollbackByTrigger,
    rollbackByObligationType,
    falsificationCount,
    falsificationByAdapter,
    falsificationByObligationType,
    topFiles,
  };
}

function findObligationType(entries: readonly LedgerEntry[], obligationIndex: number): string | null {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const e = entries[i];
    if (e && e.type === 'obligation-attempted' && e.obligationIndex === obligationIndex) {
      return e.obligationType;
    }
  }
  return null;
}

export async function handleStats(argv: string[]): Promise<number> {
  let flags: StatsFlags;
  try {
    flags = parseStatsFlags(argv);
  } catch (err) {
    process.stderr.write(`${(err as Error).message}\n`);
    return 1;
  }

  const ledgerPath = flags.ledgerPath ?? path.join(process.cwd(), '.swarm', 'ledger', `${flags.runId}.jsonl`);

  let entries: LedgerEntry[];
  try {
    entries = readEntries(ledgerPath);
  } catch (err) {
    process.stderr.write(`failed to read ledger at ${ledgerPath}: ${(err as Error).message}\n`);
    return 1;
  }

  const stats = computeStats(entries, flags.runId);

  if (flags.json) {
    process.stdout.write(JSON.stringify(stats, null, 2) + '\n');
  } else {
    process.stdout.write(formatPlain(stats) + '\n');
  }

  return 0;
}
