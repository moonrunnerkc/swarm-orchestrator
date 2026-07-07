// Mine honest twins for the closed (maintainer-rejected) wild cheats: for each
// rejected cheat PR that references an issue, find the merged PR that eventually
// landed a fix for the same issue. A resolved pair records both PRs and the
// linkage; an unresolvable cheat is recorded unpaired, never forced. The corpus
// is loaded through the hold-out choke point (this is an evaluation build).
//
// This produces the LINKAGE evidence for the wild-pair tier. Running the full
// separation over a wild pair needs both diffs provisioned, which is
// provisioning-bound (see EG-VIABILITY-POLYGLOT-REPORT.md); that step is recorded
// as follow-on. Bounded by --limit and the shared GitHub pacer.
//
// Usage: node dist/scripts/corpus/mine-honest-twins.js [--limit 20]

import * as fs from 'fs';
import * as path from 'path';
import { loadDotenv } from '../../src/env-loader';
import { getLogger } from '../../src/logger';
import { parseIssueReferences } from '../../src/audit/execution-grounded/issue-repro';
import { loadWildCheatCorpus } from '../real-prs/lib/wild-cheat-corpus';
import { makeOctokit, resolveGithubToken, searchMergedPrsGlobal, withRetry } from '../real-prs/lib/github';

const log = getLogger('corpus:mine-honest-twins');

const POPULATION_FILE = path.join('benchmarks', 'real-prs', 'hunt2', 'population.json');
const OUT_DIR = path.join('benchmarks', 'twins', 'wild-pair');
const OUT_FILE = path.join(OUT_DIR, 'honest-twins.json');

interface PopEntry {
  id: string;
  body?: string;
  prNumber: number;
}

interface ResolvedPair {
  cheatId: string;
  repo: string;
  cheatPrNumber: number;
  issue: number;
  honestPrNumber: number;
  honestUrl: string;
  linkage: 'issue-xref';
}
interface Unpaired {
  cheatId: string;
  repo: string;
  reason: string;
}

function parseLimit(argv: string[]): number {
  const i = argv.indexOf('--limit');
  return i >= 0 && argv[i + 1] !== undefined ? Number(argv[i + 1]) : 20;
}

async function main(): Promise<void> {
  loadDotenv();
  const limit = parseLimit(process.argv.slice(2));
  const closed = loadWildCheatCorpus({ forEvaluation: true })
    .filter((e) => e.state === 'closed')
    .slice(0, limit);
  const pop = JSON.parse(fs.readFileSync(POPULATION_FILE, 'utf8')) as { population: PopEntry[] };
  const byId = new Map(pop.population.map((p) => [p.id, p]));
  const octokit = makeOctokit(resolveGithubToken());

  log.info(`mining honest twins for ${closed.length} closed wild cheat(s)`);
  const resolved: ResolvedPair[] = [];
  const unpaired: Unpaired[] = [];

  for (const cheat of closed) {
    const body = byId.get(cheat.id)?.body ?? '';
    const refs = parseIssueReferences(body);
    if (refs.length === 0) {
      unpaired.push({ cheatId: cheat.id, repo: cheat.repo, reason: 'no issue reference in the cheat PR body' });
      continue;
    }
    const issue = refs[0]!.number;
    let hit: { repo: string; number: number; url: string } | null = null;
    try {
      const merged = await withRetry(
        () => searchMergedPrsGlobal(octokit, `repo:${cheat.repo} is:pr is:merged in:body #${issue}`, 5),
        `honest-twin ${cheat.id}`,
      );
      hit = merged.find((m) => m.number !== cheat.prNumber) ?? null;
    } catch (err) {
      unpaired.push({ cheatId: cheat.id, repo: cheat.repo, reason: `search failed: ${String(err)}` });
      continue;
    }
    if (hit === null) {
      unpaired.push({ cheatId: cheat.id, repo: cheat.repo, reason: `no merged PR references issue #${issue}` });
      continue;
    }
    resolved.push({
      cheatId: cheat.id,
      repo: cheat.repo,
      cheatPrNumber: cheat.prNumber,
      issue,
      honestPrNumber: hit.number,
      honestUrl: hit.url,
      linkage: 'issue-xref',
    });
    log.info(`  ${cheat.id}: paired with ${hit.url} (issue #${issue})`);
  }

  const out = {
    generatedAt: new Date().toISOString(),
    computedBy: 'scripts/corpus/mine-honest-twins.ts',
    tier: 'wild-pair',
    note:
      'Honest-twin linkage for the closed wild cheats: a rejected cheat PR paired with the merged PR ' +
      'that landed a fix for the same issue. Unresolvable cheats are recorded unpaired, not forced. ' +
      'Running the separation over a wild pair needs both diffs provisioned (provisioning-bound, follow-on).',
    counts: { closedExamined: closed.length, resolved: resolved.length, unpaired: unpaired.length },
    resolved,
    unpaired,
  };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, `${JSON.stringify(out, null, 2)}\n`);
  log.info(`wrote ${OUT_FILE}: ${resolved.length} resolved, ${unpaired.length} unpaired`);
}

if (require.main === module) {
  main().catch((err: unknown) => {
    log.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
    process.exitCode = 1;
  });
}
