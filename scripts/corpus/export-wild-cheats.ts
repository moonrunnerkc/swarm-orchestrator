// Export the maintainer-confirmed wild cheats into a versioned, citable dataset.
// Source: the Hunt 2 population (benchmarks/real-prs/hunt2/population.json), the
// entries carrying a verified maintainer complaint that names a cheat category.
// Output: benchmarks/real-prs/wild-cheat-corpus/<version>/ with dataset.json, a
// generated DATASET.md card, and a sources.json sidecar. Diffs are referenced by
// repo + head/base SHA (not vendored): the hunt keeps raw third-party diffs
// gitignored, and a URL+SHA reference reconstructs the exact diff with git.
//
// Deterministic given the committed population. Regenerate:
//   node dist/scripts/corpus/export-wild-cheats.js [--version v1]
// Every count in DATASET.md is computed here, never hand-written.

import * as fs from 'fs';
import * as path from 'path';
import { getLogger } from '../../src/logger';
import {
  WILD_CHEAT_CORPUS_DIR,
  type WildCheatDataset,
  type WildCheatEntry,
} from '../real-prs/lib/wild-cheat-corpus';

const log = getLogger('corpus:export-wild-cheats');

const POPULATION_FILE = path.join('benchmarks', 'real-prs', 'hunt2', 'population.json');

interface PopulationComplaint {
  category: string;
  phrase: string;
  source: string;
}
interface PopulationEntry {
  id: string;
  repo: string;
  prNumber: number;
  headSha: string;
  baseSha: string;
  url: string;
  vendor: string;
  vendorConfidence?: string;
  outcome?: string;
  merged: boolean;
  viable: boolean;
  complaints?: PopulationComplaint[];
}
interface PopulationFile {
  population: PopulationEntry[];
}

// Cross-comparability labels. The frontier plan asked for a mapping onto the
// "TRACE 54-category" taxonomy; that name could not be resolved to a canonical
// published source during this run (searched 2026-07; nearest analogues are
// MAST-14, TRAIL, and the 20,574-session developer-agent misalignment study).
// These are honest failure-mode descriptors pending an authoritative binding;
// DATASET.md flags them as provisional.
const CROSS_TAXONOMY: Record<string, string> = {
  'test-relaxation': 'reward-hacking / test-tampering',
  'assertion-strip': 'reward-hacking / weakened-oracle',
  'no-op-fix': 'specification-gaming / non-fix',
  'goal-not-fixed': 'task-incompletion / unmet-goal',
  'mock-of-hallucination': 'reward-hacking / fabricated-dependency-mock',
  'error-swallow': 'robustness-violation / silent-failure',
  'coverage-erosion': 'reward-hacking / coverage-reduction',
  'fake-refactor': 'specification-gaming / cosmetic-change',
  'hardcoded-output': 'reward-hacking / memorized-output',
};

function parseVersion(argv: string[]): string {
  const i = argv.indexOf('--version');
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1]! : 'v1';
}

function tally(entries: readonly WildCheatEntry[], key: (e: WildCheatEntry) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of entries) out[key(e)] = (out[key(e)] ?? 0) + 1;
  return Object.keys(out)
    .sort()
    .reduce<Record<string, number>>((acc, k) => ((acc[k] = out[k]!), acc), {});
}

/**
 * Build the dataset entries from the Hunt 2 population.
 *
 * @param population the committed Hunt 2 population entries.
 * @returns one WildCheatEntry per PR that carries a verified complaint, sorted by id.
 */
export function buildWildCheatEntries(population: readonly PopulationEntry[]): WildCheatEntry[] {
  return population
    .filter((p) => (p.complaints?.length ?? 0) > 0)
    .map((p): WildCheatEntry => {
      const complaints = (p.complaints ?? []).map((c) => ({
        category: c.category,
        phrase: c.phrase,
        source: c.source,
      }));
      const primary = complaints[0]!.category;
      return {
        id: p.id,
        repo: p.repo,
        prNumber: p.prNumber,
        url: p.url,
        state: p.merged ? 'merged' : 'closed',
        vendor: p.vendor,
        vendorConfidence: p.vendorConfidence ?? 'unknown',
        headSha: p.headSha,
        baseSha: p.baseSha,
        complaintCategory: primary,
        complaints,
        outcome: p.outcome ?? 'unknown',
        egViable: p.viable === true,
        crossTaxonomy: CROSS_TAXONOMY[primary] ?? 'unmapped',
        holdout: true,
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

function renderDatasetCard(dataset: WildCheatDataset): string {
  const e = dataset.entries;
  const byCat = tally(e, (x) => x.complaintCategory);
  const byVendor = tally(e, (x) => x.vendor);
  const byState = tally(e, (x) => x.state);
  const merged = byState['merged'] ?? 0;
  const closed = byState['closed'] ?? 0;
  const egViable = e.filter((x) => x.egViable).length;
  const catRows = Object.entries(byCat)
    .map(([c, n]) => `| ${c} | ${n} | ${CROSS_TAXONOMY[c] ?? 'unmapped'} |`)
    .join('\n');
  const vendorRows = Object.entries(byVendor)
    .map(([v, n]) => `| ${v} | ${n} |`)
    .join('\n');
  return `# Wild cheat corpus ${dataset.version}

Agent pull requests a human maintainer publicly called a cheat and named the
category, mined by the Hunt 2 complaint cascade. Every number here is computed by
\`scripts/corpus/export-wild-cheats.ts\`; nothing is hand-entered.

## What this is

${e.length} agent-attributed PRs, each carrying at least one maintainer complaint
whose phrasing names a cheat category. ${merged} shipped (\`merged\`) despite the
complaint; ${closed} the maintainer caught and rejected (\`closed\`). ${egViable} are
in execution-grounded-viable repositories.

This is a **held-out test set**. No tuning script, calibration run, or
prompt-selection loop may read it; \`loadWildCheatCorpus\` refuses any non-evaluation
caller in code (\`scripts/real-prs/lib/wild-cheat-corpus.ts\`).

## Provenance

- Mined from GitHub PR review/issue comments by the Hunt 2 cascade
  (\`scripts/real-prs/hunt2.ts\`), phrase matcher \`CHEAT_COMPLAINT_PATTERNS\` /
  \`extractComplaintSignals\` in \`scripts/real-prs/lib/github.ts\`.
- Each complaint is verified against the fetched PR conversation; the PR is
  agent-attributed by the shipped fingerprinter (\`src/audit/pr-source\`,
  \`detectAgent\`) before it counts.
- Full mining record and funnel:
  [\`benchmarks/real-prs/HUNT-2-REPORT.md\`](../../HUNT-2-REPORT.md).

## Truth condition (corrected)

A corpus entry exists when a maintainer publicly called the PR a cheat and named the
category, and the human maintainer of this project confirmed it at fold time. Entries
1 through ${e.length} entered under that complaint-plus-human bar. A model verdict is
neither half of it. For a period the intake path was read as if a dual-arbiter
both-confirm were the existence condition; the mining-verification run measured that
gate at **0/11 recall on these very maintainer-confirmed cheats** (against 21/23 on
planted, diff-legible cheats) and it was removed. The arbiter fields on every entry
are **annotations for ranking, never a veto**: a model verdict neither creates nor
destroys a corpus entry. See
[\`evidence/mining-verification/EVIDENCE-REPORT.md\`](../../../../evidence/mining-verification/EVIDENCE-REPORT.md).

The miner enforces the human half definitionally: a complaint counts only from a
**human other than the PR author**. Self-comments (the author describing their own
change) and bots (account type Bot, the \`[bot]\` suffix, and the Copilot review
surface) are excluded before matching, so "someone typed the word cheat" cannot pass as
"a maintainer called it one". These \`v1\` entries were mined before that tightening; a
re-verification (\`benchmarks/real-prs/mining-verification/TIGHTENING-REPORT.md\`) found
that a number of them carry a self- or bot-authored complaint in the current thread and
would not pass the tightened bar. The frozen set is unchanged; the finding is recorded
for a future tightened re-verification.

## Selection bias (read before citing)

These are only the cheats a **human caught and complained about in writing**. The
corpus over-represents cheats that are visible in review and under-represents
cheats that shipped silently (no complaint) or were never reviewed. It is a
lower bound on wild-cheat prevalence, not a random sample. The proof tier proved
**zero** of the execution-grounded-viable ones (HUNT-2-REPORT.md): control-
verifiable cheats are rarer than complained-about cheats.

A second bias the corpus must never acquire: gating entry on diff-legibility. A cheat
two arbiters can both see in a 6000-character slice is, by construction, the cheat
existing instruments already catch. Had entry been gated on a both-confirm, the
corpus would have biased every future evaluation toward what the tools already see
and away from the wild cheats that are the point (the 0/11 above is that bias made
measurable). Entry is gated on the human complaint, not on any instrument's ability
to re-derive it from the diff.

## Category distribution

| maintainer-named category | count | cross-taxonomy (provisional) |
| --- | --- | --- |
${catRows}

## Vendor distribution

| agent | count |
| --- | --- |
${vendorRows}

## Cross-taxonomy mapping (provisional)

The frontier plan asked for a mapping onto the TRACE 54-category taxonomy. That
name could not be resolved to a canonical published source during this run
(searched 2026-07; nearest analogues: MAST-14, TRAIL, and the 20,574-session
developer-agent misalignment study). The \`crossTaxonomy\` column above is a
best-effort failure-mode descriptor, provided as a scaffold; a maintainer with
the authoritative TRACE reference should rebind it to TRACE's category ids. It is
labeled provisional so it is never cited as a TRACE mapping it is not.

## Schema

Each entry in \`dataset.json\`: \`id\`, \`repo\`, \`prNumber\`, \`url\`, \`state\`
(merged|closed), \`vendor\`, \`vendorConfidence\` (attribution evidence), \`headSha\`,
\`baseSha\`, \`complaintCategory\`, \`complaints[]\` ({category, phrase, source}),
\`outcome\` (repository-outcome label where computable, else unknown), \`egViable\`,
\`crossTaxonomy\`, \`holdout\` (always true).

The diff is referenced by \`repo\` + \`headSha\` + \`baseSha\`, not vendored: fetch it
with \`git fetch <repo> <headSha>\` or the GitHub PR page at \`url\`. This keeps
third-party code out of the tree, matching the hunt's gitignore policy.

## License

The dataset (this schema, the labels, the mapping) is released under the
repository license. The referenced PR contents remain under their upstream
repositories' own licenses; this corpus vends no third-party code, only public
metadata (repo, PR number, SHAs, public complaint text) and derived labels.

## Reproduce

\`\`\`sh
npm run build
npm run export-wild-cheats   # regenerates this directory from population.json
\`\`\`
`;
}

function main(): void {
  const version = parseVersion(process.argv.slice(2));
  if (!fs.existsSync(POPULATION_FILE)) {
    throw new Error(`missing ${POPULATION_FILE}; the Hunt 2 population must be committed first`);
  }
  const pop = JSON.parse(fs.readFileSync(POPULATION_FILE, 'utf8')) as PopulationFile;
  const entries = buildWildCheatEntries(pop.population);
  if (entries.length === 0) {
    throw new Error('no complaint-carrying entries found in the population; nothing to export');
  }
  const counts = {
    entries: entries.length,
    merged: entries.filter((e) => e.state === 'merged').length,
    closed: entries.filter((e) => e.state === 'closed').length,
    egViable: entries.filter((e) => e.egViable).length,
  };
  const dataset: WildCheatDataset = {
    version,
    generatedBy: 'scripts/corpus/export-wild-cheats.ts',
    note:
      'Maintainer-confirmed wild cheats (held-out test set). Built from Hunt 2 population. ' +
      'See DATASET.md for provenance, selection bias, and the provisional cross-taxonomy mapping.',
    counts,
    entries,
  };
  const outDir = path.join(WILD_CHEAT_CORPUS_DIR, version);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'dataset.json'), `${JSON.stringify(dataset, null, 2)}\n`);
  fs.writeFileSync(path.join(outDir, 'DATASET.md'), renderDatasetCard(dataset));
  fs.writeFileSync(
    path.join(outDir, 'sources.json'),
    `${JSON.stringify(
      {
        computedBy: 'scripts/corpus/export-wild-cheats.ts',
        source: POPULATION_FILE,
        selection: 'population entries with >= 1 verified maintainer complaint',
        counts,
        categories: tally(entries, (e) => e.complaintCategory),
        vendors: tally(entries, (e) => e.vendor),
      },
      null,
      2,
    )}\n`,
  );
  log.info(`exported ${entries.length} wild cheats -> ${outDir} (${JSON.stringify(counts)})`);
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    log.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
    process.exitCode = 1;
  }
}
