// Phase 1: distant-supervision label miner. Assembles the PU dataset the
// triage pipeline trains and calibrates on, from the anchors Phase 0 settled:
// the oracle's injected cheats (strong ground-truth positives), the
// execution-grounded restoration proofs (real-data positives, only when
// proven), the revert-bad corpus (weak positives, down-weighted per Phase 0),
// and the presumed-clean corpus (the unlabeled negative pool).
//
// It reuses the corpora already mined on disk; it does not re-fetch from
// GitHub (there is no token in this environment and prior wild hunts found
// effectively zero provable cheats, so the measurable ground truth is the
// in-repo oracle). Output is byte-stable and digest-pinned like the oracle.
//
// Usage: node dist/scripts/triage/mine-dataset.js

import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { getLogger } from '../../src/logger';
import { buildDataset } from '../../src/audit/triage/dataset';
import {
  cleanInstances,
  oracleInstances,
  restorationInstances,
  revertInstances,
  type OracleLabelInput,
  type RealPrInput,
  type RestorationProofInput,
} from '../../src/audit/oracle/distant-supervision/sources';
import type { TriageInstance } from '../../src/audit/triage/types';
import { regressionDir, regressionDiffsDir, repoRoot, repoSlug, sourcesV2File } from '../real-prs/lib/paths';

const log = getLogger('triage:mine');

function sha256File(abs: string): string {
  return createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
}

function rel(root: string, abs: string): string {
  return path.relative(root, abs);
}

/** Walk the oracle corpus for every `.label.json` and pair it with its diff. */
function readOracle(root: string): OracleLabelInput[] {
  const oracleRoot = path.join(root, 'benchmarks', 'oracle-corpus');
  const out: OracleLabelInput[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir).sort()) {
      const abs = path.join(dir, entry);
      if (fs.statSync(abs).isDirectory()) walk(abs);
      else if (entry.endsWith('.label.json')) {
        const label = JSON.parse(fs.readFileSync(abs, 'utf8')) as {
          category: string;
          injectorId: string;
          sourcePrUrl: string;
          sha256: string;
        };
        const stem = entry.replace(/\.label\.json$/, '');
        const diffAbs = path.join(dir, `${stem}.diff`);
        if (!fs.existsSync(diffAbs)) {
          throw new Error(`oracle label ${abs} has no sibling diff ${diffAbs}`);
        }
        out.push({
          category: label.category,
          injectorId: label.injectorId,
          sourcePrUrl: label.sourcePrUrl,
          prStem: stem,
          diffPath: rel(root, diffAbs),
          sha256: label.sha256,
        });
      }
    }
  };
  walk(oracleRoot);
  return out;
}

/** Read every execution-grounded restoration proof record under the corpus. */
function readRestorationProofs(root: string): RestorationProofInput[] {
  const egRoot = path.join(regressionDir(root), 'execution-grounded');
  const out: RestorationProofInput[] = [];
  if (!fs.existsSync(egRoot)) return out;
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir).sort()) {
      const abs = path.join(dir, entry);
      if (fs.statSync(abs).isDirectory()) walk(abs);
      else if (entry === 'restoration-proof.json') {
        const proof = JSON.parse(fs.readFileSync(abs, 'utf8')) as {
          prRef: string;
          records?: Array<{ verdict: string; category: string }>;
        };
        const [repo, prRaw] = proof.prRef.split('#');
        const prNumber = Number(prRaw);
        const diffAbs = path.join(regressionDiffsDir(root), repoSlug(repo), `${prNumber}.diff`);
        if (!fs.existsSync(diffAbs)) continue;
        const sha = sha256File(diffAbs);
        for (const r of proof.records ?? []) {
          out.push({
            prRef: proof.prRef,
            verdict: r.verdict,
            category: r.category,
            sourcePrUrl: `https://github.com/${repo}/pull/${prNumber}`,
            diffPath: rel(root, diffAbs),
            sha256: sha,
          });
        }
      }
    }
  };
  walk(egRoot);
  return out;
}

/** Read the revert-bad corpus sources and resolve each PR's diff. */
function readRevert(root: string): RealPrInput[] {
  const sourcesFile = path.join(regressionDir(root), 'sources.json');
  const parsed = JSON.parse(fs.readFileSync(sourcesFile, 'utf8')) as {
    prs: Array<{ repo: string; prNumber: number; url: string; diffPath: string }>;
  };
  const out: RealPrInput[] = [];
  for (const pr of parsed.prs) {
    const diffAbs = path.join(regressionDir(root), pr.diffPath);
    if (!fs.existsSync(diffAbs)) {
      log.warn(`revert PR ${pr.repo}#${pr.prNumber}: diff missing at ${pr.diffPath}, skipping`);
      continue;
    }
    out.push({
      repo: pr.repo,
      prNumber: pr.prNumber,
      sourcePrUrl: pr.url,
      diffPath: rel(root, diffAbs),
      sha256: sha256File(diffAbs),
    });
  }
  return out;
}

/** Read the presumed-clean corpus sources and resolve each PR's diff. */
function readClean(root: string): RealPrInput[] {
  const parsed = JSON.parse(fs.readFileSync(sourcesV2File(root), 'utf8')) as {
    prs: Array<{ repo: string; prNumber: number; url: string }>;
  };
  const diffsRoot = path.join(root, 'benchmarks', 'real-prs', 'diffs');
  const out: RealPrInput[] = [];
  for (const pr of parsed.prs) {
    const diffAbs = path.join(diffsRoot, repoSlug(pr.repo), `${pr.prNumber}.diff`);
    if (!fs.existsSync(diffAbs)) {
      log.warn(`clean PR ${pr.repo}#${pr.prNumber}: diff missing, skipping`);
      continue;
    }
    out.push({
      repo: pr.repo,
      prNumber: pr.prNumber,
      sourcePrUrl: pr.url,
      diffPath: rel(root, diffAbs),
      sha256: sha256File(diffAbs),
    });
  }
  return out;
}

function main(): void {
  const root = repoRoot();
  const instances: TriageInstance[] = [
    ...oracleInstances(readOracle(root)),
    ...restorationInstances(readRestorationProofs(root)),
    ...revertInstances(readRevert(root)),
    ...cleanInstances(readClean(root)),
  ];
  const dataset = buildDataset(instances);

  const outDir = path.join(root, 'benchmarks', 'triage');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'triage-dataset.json'), JSON.stringify(dataset, null, 2) + '\n');

  log.info(
    `mined ${dataset.summary.total} instances ` +
      `(${dataset.summary.positives} positive, ${dataset.summary.unlabeled} unlabeled); ` +
      `tiers ${JSON.stringify(dataset.summary.byTier)}`,
  );
  log.info(`corpus sha256 ${dataset.corpusSha256}`);
}

main();
