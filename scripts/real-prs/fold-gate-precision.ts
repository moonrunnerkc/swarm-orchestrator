// Fold the wild hunt-2 proof-tier results into the gate-precision artifact.
//
// gate-precision.json measures proven-finding precision on the EG-viable slice of
// the outcome-labeled corpus: of the PRs where a proof fired a fully-controlled
// block trigger, how many were genuinely bad? The corpus slice is small, so the
// hunt-2 wild run grows that denominator with agent PRs the proof tier actually
// executed in the wild. This step merges hunt-2's proof-ran records in, without
// inventing a number:
//
//   - A hunt-2 `ran-no-proof` record grows COVERAGE (a PR the proof tier
//     evaluated and abstained on), not the precision numerator/denominator
//     (no trigger fired).
//   - A hunt-2 `proven-block` is a FIRED trigger. It does NOT auto-count toward
//     precision: a wild proven block must pass the stop-the-line protocol (replay
//     in a fresh clone, verify controls, check PR history) before it is labeled a
//     true or false positive. Until adjudicated it is listed as pending, so the
//     precision number stays honest.
//
// Output: rewrites benchmarks/real-corpus/gate-precision.json in place, adding a
// `wildHunt2` section and a `combined` coverage roll-up. Idempotent.
//
// Usage:
//   node dist/scripts/real-prs/fold-gate-precision.js

import * as fs from 'fs';
import * as path from 'path';
import { getLogger } from '../../src/logger';

const log = getLogger('real-prs:fold-gate-precision');

const GATE_FILE = path.join('benchmarks', 'real-corpus', 'gate-precision.json');
const HUNT2_FILE = path.join('benchmarks', 'real-prs', 'hunt2', 'hunt2-summary.json');

interface ProofRecordLite {
  id: string;
  repo: string;
  prNumber: number;
  url: string;
  status: string;
  provenTriggers: { kind: string; file: string; reproduce: string }[];
  flags?: string[];
}

interface Hunt2Summary {
  generatedAt: string;
  funnel: Record<string, number>;
  complaintCatalog?: { id: string; viable: boolean; complaints: { category: string }[] }[];
  records: ProofRecordLite[];
}

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
}

function main(): void {
  if (!fs.existsSync(HUNT2_FILE)) {
    throw new Error(`missing ${HUNT2_FILE}; run hunt2 first`);
  }
  if (!fs.existsSync(GATE_FILE)) {
    throw new Error(`missing ${GATE_FILE}; run gate-precision first`);
  }
  const gate = readJson<Record<string, unknown>>(GATE_FILE);
  const hunt2 = readJson<Hunt2Summary>(HUNT2_FILE);

  const proofRan = hunt2.records.filter((r) => r.status === 'ran-no-proof' || r.status === 'proven-block');
  const proven = hunt2.records.filter((r) => r.status === 'proven-block');
  const ranNoProof = hunt2.records.filter((r) => r.status === 'ran-no-proof');
  const notProvisioned = hunt2.records.filter((r) => r.status === 'not-provisioned' || r.status === 'error');
  const viableComplaints = (hunt2.complaintCatalog ?? []).filter((c) => c.viable).length;

  const wildHunt2 = {
    generatedAt: hunt2.generatedAt,
    source: 'benchmarks/real-prs/hunt2/hunt2-summary.json',
    method:
      'viability-first + complaint-mined triage cascade; proof tier run on (candidate ∪ complaint) ∩ EG-viable agent PRs',
    proofRan: proofRan.length,
    ranNoProof: ranNoProof.length,
    notProvisioned: notProvisioned.length,
    provenBlocks: proven.length,
    viableComplaintTargets: viableComplaints,
    firedTriggersPendingAdjudication: proven.map((r) => ({
      id: r.id,
      repo: r.repo,
      prNumber: r.prNumber,
      url: r.url,
      triggers: r.provenTriggers,
      flags: r.flags ?? [],
      adjudication: 'pending stop-the-line (replay in fresh clone, verify controls, check PR history)',
    })),
    note:
      proven.length === 0
        ? 'The wild proof tier fired zero block triggers on the cascade. This grows the coverage denominator (more agent PRs the proof tier evaluated and abstained on) and leaves proven-finding precision an honest n=0.'
        : `${proven.length} wild proven block(s) fired; each is pending stop-the-line adjudication and is NOT counted toward precision until a human verifies it.`,
  };

  const corpusCoverage = (gate.coverage as { proofTierRan?: number; provisioned?: number } | undefined) ?? {};
  const combined = {
    proofTierRan: (corpusCoverage.proofTierRan ?? 0) + proofRan.length,
    provisioned: (corpusCoverage.provisioned ?? 0) + proofRan.length,
    firedTriggers: ((): number => {
      const corpusFired =
        (gate.provenFindingPrecision as { n?: number } | undefined)?.n ?? 0;
      return corpusFired + proven.length;
    })(),
    adjudicatedFired:
      (gate.provenFindingPrecision as { n?: number } | undefined)?.n ?? 0,
    note: 'firedTriggers counts corpus (already adjudicated) + wild hunt-2 (pending). precision is computed only over adjudicatedFired.',
  };

  gate.wildHunt2 = wildHunt2;
  gate.combined = combined;
  fs.writeFileSync(GATE_FILE, `${JSON.stringify(gate, null, 2)}\n`);
  log.info(
    `folded hunt-2 into gate-precision: proofRan +${proofRan.length}, proven ${proven.length}, ` +
      `viable-complaint targets ${viableComplaints}; combined proofTierRan=${combined.proofTierRan}`,
  );
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    log.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
    process.exitCode = 1;
  }
}
