// Reader/writer for the frozen localized-confirm-prompt measurement.
//
// The localized confirm prompt was measured once against the local model
// (glm47-flash-abl). Those judge calls are NOT in the committed judge
// cache (only the conservative-prompt calls are), and the local model is
// not always reachable, so a `--no-live` regen of tail-defect / per-hunk
// cannot recompute them. Rather than let a cache-miss silently zero the
// experiment, the numbers live here as cited evidence (the same pattern
// `benchmarks/results/AB-REPORT.md` uses for its frozen pre/post
// snapshots), and the report generators read them. A deliberate
// `--refresh-localized` run against a live model rewrites this file.

import * as fs from 'fs';
import * as path from 'path';

export interface LocalizedExperiment {
  measuredAt: string;
  model: string;
  note: string;
  tailDefect: { count: number; localizedCaught: number };
  perHunk: {
    count: number;
    localizedDefectFlagged: number;
    localizedPointedCorrectly: number;
    localizedBenignFalse: number;
  };
}

/** Absolute path of the frozen experiment sidecar under the corpus dir. */
export function localizedExperimentPath(root: string): string {
  return path.join(root, 'benchmarks', 'oracle-corpus', 'localized-experiment.json');
}

/**
 * Read the frozen localized-prompt measurement.
 *
 * @param root repo root
 * @returns the parsed experiment
 * @throws if the sidecar is missing; it is committed evidence, so its
 *   absence is a real error, not a silent zero.
 */
export function readLocalizedExperiment(root: string): LocalizedExperiment {
  const file = localizedExperimentPath(root);
  if (!fs.existsSync(file)) {
    throw new Error(
      `localized-experiment.json not found at ${file}; it is committed evidence. ` +
        'Restore it from git or re-measure with --refresh-localized against a live model.',
    );
  }
  return JSON.parse(fs.readFileSync(file, 'utf8')) as LocalizedExperiment;
}

/** Overwrite the frozen experiment sidecar (a deliberate refresh). */
export function writeLocalizedExperiment(root: string, exp: LocalizedExperiment): void {
  fs.writeFileSync(localizedExperimentPath(root), `${JSON.stringify(exp, null, 2)}\n`);
}
