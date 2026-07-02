// Phase 3 (part A): featurize every instance. Runs the full cheat-detector
// registry deterministically over each diff (no judge here: the detector votes
// must be reproducible), reads the v3-denoise judge verdict, and assembles the
// labeling-function vote vector plus the structural diff features. Writes
// triage-features.json, which the label model, ranker, and calibration read.
//
// Re-run after the judge denoise pass to fold fresh judge verdicts into the
// vote matrix; the detector votes are unchanged, so the run is cheap.
//
// Usage: node dist/scripts/triage/featurize.js

import * as fs from 'fs';
import * as path from 'path';
import { getLogger } from '../../src/logger';
import { runCheatDetectors } from '../../src/audit/cheat-detector';
import { structuralFeatures, STRUCTURAL_FEATURE_NAMES } from '../../src/audit/triage/features';
import { LABELING_FUNCTION_NAMES, votesFor } from '../../src/audit/triage/labeling-functions';
import { repoRoot } from '../real-prs/lib/paths';
import { evalLabel, loadDataset, loadVerdicts, splitOf, triageDir } from './lib/triage-io';

const log = getLogger('triage:featurize');

interface FeatureRow {
  id: string;
  tier: string;
  knownLabel: 0 | 1 | null;
  split: string;
  votes: number[];
  structural: number[];
}

async function main(): Promise<void> {
  const root = repoRoot();
  const dataset = loadDataset(root);
  const verdicts = loadVerdicts(root);
  log.info(`featurizing ${dataset.instances.length} instances; ${verdicts.size} judge verdicts loaded`);

  const rows: FeatureRow[] = [];
  let n = 0;
  for (const inst of dataset.instances) {
    n += 1;
    const diffAbs = path.join(root, inst.diffPath);
    if (!fs.existsSync(diffAbs)) {
      log.warn(`${inst.id}: diff missing, skipping`);
      continue;
    }
    const diff = fs.readFileSync(diffAbs, 'utf8');
    const result = await runCheatDetectors({ unifiedDiff: diff, repoRoot: root, detectorSet: 'all' });
    const fired = new Set<string>(result.findings.map((f) => f.category));
    const verdict = verdicts.get(inst.id) ?? 'unavailable';
    rows.push({
      id: inst.id,
      tier: inst.tier,
      knownLabel: evalLabel(inst.tier),
      split: splitOf(inst.id, inst.tier),
      votes: votesFor(fired, verdict, inst.tier),
      structural: structuralFeatures(diff),
    });
    if (n % 100 === 0) log.info(`featurized ${n}/${dataset.instances.length}`);
  }

  const out = {
    lfNames: LABELING_FUNCTION_NAMES,
    structuralNames: STRUCTURAL_FEATURE_NAMES,
    instances: rows,
  };
  fs.writeFileSync(path.join(triageDir(root), 'triage-features.json'), JSON.stringify(out, null, 2) + '\n');
  const judged = rows.filter((r) => r.votes[LABELING_FUNCTION_NAMES.indexOf('judge')] !== 0).length;
  log.info(`wrote ${rows.length} feature rows (${judged} with a judge vote)`);
}

main().catch((err: unknown) => {
  log.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
