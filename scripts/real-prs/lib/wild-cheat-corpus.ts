// The wild cheat corpus: agent PRs a maintainer publicly called a cheat and
// named the category. It is a HELD-OUT TEST SET. No tuning script, calibration
// run, or prompt-selection loop may read it, so the loader enforces that in code:
// loadWildCheatCorpus throws unless the caller declares an evaluation purpose.
// Enforcing it here (the one choke point every reader must pass through) is
// stronger than a convention a future script could forget.

import * as fs from 'fs';
import * as path from 'path';

/** The default dataset root, relative to the repo root. Versioned subdirectories
 *  (v1, v2, ...) live under it. */
export const WILD_CHEAT_CORPUS_DIR = path.join('benchmarks', 'real-prs', 'wild-cheat-corpus');

/** One matched maintainer complaint: the cheat category it names, the exact
 *  phrase that matched, and where in the PR conversation it was found. */
export interface WildCheatComplaint {
  readonly category: string;
  readonly phrase: string;
  readonly source: string;
}

/** One held-out wild cheat: an agent PR with a verified maintainer complaint. */
export interface WildCheatEntry {
  readonly id: string;
  readonly repo: string;
  readonly prNumber: number;
  readonly url: string;
  /** 'merged' shipped despite the complaint; 'closed' the maintainer rejected it;
   *  'open' the maintainer flagged it in an in-flight PR (the head SHA pins the
   *  cheat diff even if the PR later changes). */
  readonly state: 'merged' | 'closed' | 'open';
  /** The agent the pr-source fingerprinter attributed the PR to. */
  readonly vendor: string;
  /** The fingerprinter's confidence in that attribution. */
  readonly vendorConfidence: string;
  readonly headSha: string;
  readonly baseSha: string;
  /** The primary maintainer-named cheat category (the first complaint's category). */
  readonly complaintCategory: string;
  /** Every matched complaint signal on the PR. */
  readonly complaints: readonly WildCheatComplaint[];
  /** Repository-outcome label where computable, else 'unknown'. */
  readonly outcome: string;
  /** Whether the repo is execution-grounded-viable. */
  readonly egViable: boolean;
  /** Cross-comparability label (see DATASET.md); provisional pending an
   *  authoritative external taxonomy binding. */
  readonly crossTaxonomy: string;
  /** Always true: the whole corpus is held out from tuning. */
  readonly holdout: true;
  /** Set when an entry has been read and diagnosed by a prior run (so it is
   *  "spent"): re-running it is confirmatory, not exploratory, and future hunt
   *  pre-registrations must report it separately from the fresh held-out set.
   *  outline/outline#12197 was spent by Hunt 3 and Hunt 4's outline diagnosis. */
  readonly diagnosed?: {
    readonly spentBy: readonly string[];
    readonly note: string;
  };
}

/** The on-disk dataset shape written by export-wild-cheats.ts. */
export interface WildCheatDataset {
  readonly version: string;
  readonly generatedBy: string;
  readonly note: string;
  readonly counts: Record<string, number>;
  readonly entries: readonly WildCheatEntry[];
}

/** Thrown when a non-evaluation caller tries to read the held-out corpus. */
export class HeldOutCorpusError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HeldOutCorpusError';
  }
}

/**
 * Load the wild cheat corpus, refusing to hand held-out entries to a tuning or
 * calibration caller. Evaluation callers (measurement, separation, judge
 * baseline) pass `forEvaluation: true`; every tuning/calibration path leaves it
 * false and is rejected. The corpus is entirely held out, so a non-evaluation
 * load always throws once any entry is present.
 *
 * @param opts.forEvaluation true only for read-only measurement; never for a
 *   loop that could tune a detector, prompt, or threshold on these entries.
 * @param opts.dir dataset root override (defaults to the committed corpus dir).
 * @param opts.version dataset version subdirectory (defaults to 'v1').
 * @returns the corpus entries.
 * @throws {HeldOutCorpusError} when a non-evaluation caller loads held-out entries.
 * @throws {Error} when the dataset file is missing or unparseable.
 */
export function loadWildCheatCorpus(opts: {
  forEvaluation: boolean;
  dir?: string;
  version?: string;
}): readonly WildCheatEntry[] {
  const version = opts.version ?? 'v1';
  const file = path.join(opts.dir ?? WILD_CHEAT_CORPUS_DIR, version, 'dataset.json');
  if (!fs.existsSync(file)) {
    throw new Error(
      `wild cheat corpus not found at ${file}; run \`npm run export-wild-cheats\` to build it`,
    );
  }
  const dataset = JSON.parse(fs.readFileSync(file, 'utf8')) as WildCheatDataset;
  const heldOut = dataset.entries.filter((e) => e.holdout === true);
  if (!opts.forEvaluation && heldOut.length > 0) {
    throw new HeldOutCorpusError(
      `refusing to load ${heldOut.length} held-out wild-cheat entries for a non-evaluation caller. ` +
        'This corpus is a held-out test set; tuning, calibration, and prompt-selection may not read it. ' +
        'Pass { forEvaluation: true } only from a read-only measurement path.',
    );
  }
  return dataset.entries;
}
