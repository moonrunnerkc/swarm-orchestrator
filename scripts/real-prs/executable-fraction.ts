// Executable-fraction metric per intake (Stage 1 of the capability run). An
// intake is a complaint-mined review package (incoming/intake.json). The
// executable fraction is the share of its candidates that the execution-grounded
// proof tier can actually run against: a candidate is proof-executable when the
// EG-viability screen marked it viable AND its ecosystem has at least one proof
// engine that executes on it. After the polyglot reach work, that set is
// {node, python, go} (test-tamper restoration runs on all three; error-swallow
// on node + python). Elixir and every other ecosystem stay non-executable and
// are recorded, not silently dropped.
//
// Deterministic and offline: it reads the committed intake and the committed
// EG-viability screen, never the network. Emits
// benchmarks/real-corpus/executable-fraction.json.

import * as fs from 'fs';
import * as path from 'path';

/** Ecosystems with a provisioner AND at least one proof engine that executes on
 *  them. The executable frontier the capability run engineers toward. */
export const PROOF_EXECUTABLE_ECOSYSTEMS: ReadonlySet<string> = new Set(['node', 'python', 'go']);

export interface IntakeRecordLike {
  id?: string;
  egViable?: boolean;
  egEcosystem?: string | null;
}

export interface ExecutableFraction {
  total: number;
  recognized: number;
  provisionable: number;
  proofExecutable: number;
  fraction: number;
  /** Proof-executable records by ecosystem (egViable + engine present). */
  byEcosystem: Record<string, number>;
  /** Records in an executable ecosystem the screen could not provision (no
   *  lockfile / no runner). A reach gap in provisioning, not in engines. */
  provisionableGap: Record<string, number>;
  /** Records whose ecosystem carries no proof engine (unrecognized, elixir, ...). */
  nonExecutable: Record<string, number>;
}

/**
 * Pure: the executable fraction over a set of intake records. Every record lands
 * in exactly one of three buckets so they sum to `total`:
 *   - `proofExecutable`: EG-viable and its ecosystem has a proof engine;
 *   - `provisionableGap`: ecosystem has an engine, but the screen could not
 *     provision it (missing lockfile / test runner);
 *   - `nonExecutable`: ecosystem carries no proof engine (`unrecognized`, elixir).
 * `recognized` counts records with a known ecosystem; `provisionable` counts
 * EG-viable records; `fraction` is proofExecutable / total.
 *
 * @param records the intake's candidate records (egViable + egEcosystem).
 * @param executable the ecosystems with a proof engine (default {node,python,go}).
 * @returns the fraction breakdown, with buckets that sum to total.
 */
export function computeExecutableFraction(
  records: readonly IntakeRecordLike[],
  executable: ReadonlySet<string> = PROOF_EXECUTABLE_ECOSYSTEMS,
): ExecutableFraction {
  const byEcosystem: Record<string, number> = {};
  const provisionableGap: Record<string, number> = {};
  const nonExecutable: Record<string, number> = {};
  let recognized = 0;
  let provisionable = 0;
  let proofExecutable = 0;
  for (const r of records) {
    const eco = r.egEcosystem ?? null;
    if (eco !== null) recognized += 1;
    if (r.egViable === true) provisionable += 1;
    if (eco === null || !executable.has(eco)) {
      const key = eco ?? 'unrecognized';
      nonExecutable[key] = (nonExecutable[key] ?? 0) + 1;
    } else if (r.egViable === true) {
      proofExecutable += 1;
      byEcosystem[eco] = (byEcosystem[eco] ?? 0) + 1;
    } else {
      provisionableGap[eco] = (provisionableGap[eco] ?? 0) + 1;
    }
  }
  const total = records.length;
  return {
    total,
    recognized,
    provisionable,
    proofExecutable,
    fraction: total === 0 ? 0 : proofExecutable / total,
    byEcosystem,
    provisionableGap,
    nonExecutable,
  };
}

interface ViabilitySummary {
  screened: number;
  viableCount: number;
  provisionableCount: number;
  viableByEcosystem: Record<string, number>;
}

/** Corpus-wide executable fraction from the committed EG-viability screen. The
 *  proof-executable numerator is the sum of the screen's viable-by-ecosystem
 *  counts over the ecosystems that carry a proof engine. */
function corpusFraction(v: ViabilitySummary): {
  screened: number;
  proofExecutable: number;
  fraction: number;
  byEcosystem: Record<string, number>;
} {
  const byEcosystem: Record<string, number> = {};
  let proofExecutable = 0;
  for (const [eco, n] of Object.entries(v.viableByEcosystem)) {
    if (PROOF_EXECUTABLE_ECOSYSTEMS.has(eco)) {
      byEcosystem[eco] = n;
      proofExecutable += n;
    }
  }
  return {
    screened: v.screened,
    proofExecutable,
    fraction: v.screened === 0 ? 0 : proofExecutable / v.screened,
    byEcosystem,
  };
}

function parseArg(argv: string[], flag: string, fallback: string): string {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1]! : fallback;
}

function main(): void {
  const argv = process.argv.slice(2);
  const intakeFile = parseArg(
    argv,
    '--intake',
    path.join('benchmarks', 'real-prs', 'wild-cheat-corpus', 'incoming', 'intake.json'),
  );
  const viabilityFile = parseArg(
    argv,
    '--viability',
    path.join('benchmarks', 'real-corpus', 'eg-viability.json'),
  );
  const out = parseArg(argv, '--out', path.join('benchmarks', 'real-corpus', 'executable-fraction.json'));

  const intake = JSON.parse(fs.readFileSync(intakeFile, 'utf8')) as {
    minedFrom?: string;
    records: IntakeRecordLike[];
  };
  const viability = JSON.parse(fs.readFileSync(viabilityFile, 'utf8')) as ViabilitySummary;

  const result = {
    computedBy: 'scripts/real-prs/executable-fraction.ts',
    executableEcosystems: [...PROOF_EXECUTABLE_ECOSYSTEMS].sort(),
    intake: {
      file: intakeFile,
      minedFrom: intake.minedFrom ?? null,
      ...computeExecutableFraction(intake.records),
    },
    corpus: {
      file: viabilityFile,
      ...corpusFraction(viability),
    },
  };
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(result, null, 2) + '\n');
  process.stdout.write(
    `executable-fraction: intake ${result.intake.proofExecutable}/${result.intake.total} ` +
      `(${(result.intake.fraction * 100).toFixed(1)}%), corpus ${result.corpus.proofExecutable}/` +
      `${result.corpus.screened} (${(result.corpus.fraction * 100).toFixed(1)}%) out=${out}\n`,
  );
}

if (require.main === module) {
  main();
}
