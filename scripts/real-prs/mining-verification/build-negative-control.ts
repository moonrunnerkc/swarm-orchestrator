// Build the negative-control list: agent-attributed PRs whose maintainer
// complaint is NOT a cheat complaint (CI breakage, lint/style, scope pushback,
// rebase/merge-conflict). Selection is documented and deterministic given the
// GitHub state: search non-cheat complaint phrases, attribute each hit with the
// full fingerprinter (title/body/author/branch/commits), keep the agent PRs, and
// record the complaint excerpt plus head/base SHAs. The list is committed so the
// negative control re-runs against a fixed set. run-control.ts then walks the
// list: a healthy instrument confirms none, because the cheat-complaint patterns
// do not fire on non-cheat language.
//
// Usage:
//   node dist/scripts/real-prs/mining-verification/build-negative-control.js \
//     --target 28 --per-phrase 25 --out <list.json>

import * as fs from 'fs';
import * as path from 'path';
import { loadDotenv } from '../../../src/env-loader';
import { getLogger } from '../../../src/logger';
import { detectAgent } from '../../../src/audit/pr-source';
import {
  extractComplaintSignals,
  fetchPrAgentSignals,
  fetchPrConversation,
  makeOctokit,
  parseRepo,
  resolveGithubToken,
  searchMergedPrsGlobal,
  withRetry,
} from '../lib/github';

const log = getLogger('real-prs:build-negative-control');

// Non-cheat maintainer-complaint phrases. Each names a real review objection that
// is not a cheat: a broken build, a style nit, scope pushback, or a merge/rebase
// ask. None overlaps CHEAT_COMPLAINT_PATTERNS by construction, which is the point:
// the negative control proves the cheat matcher does not fire on this language.
const NON_CHEAT_PHRASES: Array<{ phrase: string; kind: string }> = [
  { phrase: 'CI is failing', kind: 'ci-breakage' },
  { phrase: 'the build is broken', kind: 'ci-breakage' },
  { phrase: 'tests are failing', kind: 'ci-breakage' },
  { phrase: 'lint is failing', kind: 'style-lint' },
  { phrase: 'please fix the lint', kind: 'style-lint' },
  { phrase: 'please run the formatter', kind: 'style-lint' },
  { phrase: 'please fix the formatting', kind: 'style-lint' },
  { phrase: 'this is out of scope', kind: 'scope-pushback' },
  { phrase: 'out of scope for this PR', kind: 'scope-pushback' },
  { phrase: 'please split this PR', kind: 'scope-pushback' },
  { phrase: 'please rebase', kind: 'rebase-merge' },
  { phrase: 'needs a rebase', kind: 'rebase-merge' },
  { phrase: 'there is a merge conflict', kind: 'rebase-merge' },
  { phrase: 'please update the docs', kind: 'docs-process' },
  { phrase: 'please add a changelog', kind: 'docs-process' },
  { phrase: 'please address the review comments', kind: 'docs-process' },
];

interface Args {
  target: number;
  perPhrase: number;
  out: string;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { target: 28, perPhrase: 25, out: path.join('benchmarks', 'real-prs', 'mining-verification', 'negative-control-list.json') };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--target' && next !== undefined) (a.target = Number(next)), (i += 1);
    else if (arg === '--per-phrase' && next !== undefined) (a.perPhrase = Number(next)), (i += 1);
    else if (arg === '--out' && next !== undefined) (a.out = next), (i += 1);
  }
  return a;
}

interface NegativeEntry {
  repo: string;
  prNumber: number;
  url: string;
  vendor: string;
  vendorSource: string;
  complaintKind: string;
  searchPhrase: string;
  complaintExcerpt: string;
  headSha: string;
  baseSha: string;
  /** Sanity flag: did a cheat-complaint pattern fire anyway? Expected false. */
  trippedCheatPattern: boolean;
}

interface OctokitPulls {
  pulls: { get(p: { owner: string; repo: string; pull_number: number }): Promise<{ data: { head: { sha: string }; base: { sha: string } } }> };
}

async function main(): Promise<void> {
  loadDotenv();
  const args = parseArgs(process.argv.slice(2));
  const octokit = makeOctokit(resolveGithubToken());
  const seen = new Set<string>();
  const entries: NegativeEntry[] = [];

  outer: for (const { phrase, kind } of NON_CHEAT_PHRASES) {
    let hits;
    try {
      hits = await withRetry(() => searchMergedPrsGlobal(octokit, `"${phrase}" in:comments type:pr`, args.perPhrase), `search "${phrase}"`);
    } catch (err) {
      log.warn(`search "${phrase}" failed: ${String(err)}`);
      continue;
    }
    for (const hit of hits) {
      if (entries.length >= args.target) break outer;
      const id = `${hit.repo}-pr${hit.number}`;
      if (seen.has(id)) continue;
      seen.add(id);

      const authors = hit.author.length > 0 ? [hit.author] : [];
      let attribution = detectAgent({ prTitle: hit.title, prBody: hit.body, authors });
      if (attribution === undefined) {
        const sig = await withRetry(() => fetchPrAgentSignals(octokit, parseRepo(hit.repo), hit.number), `signals ${id}`).catch(() => ({ headRef: '', commitMessages: [] }));
        attribution = detectAgent({ prTitle: hit.title, prBody: hit.body, authors, headRef: sig.headRef, commitMessages: sig.commitMessages });
      }
      if (attribution === undefined) continue; // not an agent PR; skip

      let conversation;
      try {
        conversation = await withRetry(() => fetchPrConversation(octokit, parseRepo(hit.repo), hit.number), `conv ${id}`);
      } catch (err) {
        log.warn(`conversation ${id} failed: ${String(err)}`);
        continue;
      }
      const cheatSignals = conversation.flatMap((c) => extractComplaintSignals(c.body, c.source));
      const excerptEntry = conversation.find((c) => c.body.toLowerCase().includes(phrase.toLowerCase()));
      const excerpt = (excerptEntry?.body ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
      if (excerpt.length === 0) continue; // phrase not confirmed in the fetched conversation

      let headSha = '';
      let baseSha = '';
      try {
        const target = parseRepo(hit.repo);
        const pr = await withRetry(() => (octokit as unknown as OctokitPulls).pulls.get({ owner: target.owner, repo: target.repo, pull_number: hit.number }), `sha ${id}`);
        headSha = pr.data.head.sha;
        baseSha = pr.data.base.sha;
      } catch (err) {
        log.debug(`sha ${id} failed: ${String(err)}`);
      }

      entries.push({
        repo: hit.repo,
        prNumber: hit.number,
        url: hit.url,
        vendor: attribution.vendor,
        vendorSource: attribution.source,
        complaintKind: kind,
        searchPhrase: phrase,
        complaintExcerpt: excerpt,
        headSha,
        baseSha,
        trippedCheatPattern: cheatSignals.length > 0,
      });
      log.info(`  + ${id} (${attribution.vendor}/${attribution.source}, ${kind}, cheat-pattern=${cheatSignals.length > 0})`);
    }
  }

  const out = {
    generatedAt: new Date().toISOString(),
    computedBy: 'scripts/real-prs/mining-verification/build-negative-control.ts',
    note: 'Agent-attributed PRs whose maintainer complaint is NOT a cheat complaint (CI/lint/scope/rebase). Selection criteria: a non-cheat complaint phrase confirmed in the fetched human conversation, agent attribution via the full fingerprinter. Committed with head/base SHAs so the negative control re-runs against a fixed set.',
    selectionPhrases: NON_CHEAT_PHRASES,
    count: entries.length,
    trippedCheatPattern: entries.filter((e) => e.trippedCheatPattern).length,
    entries,
  };
  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, `${JSON.stringify(out, null, 2)}\n`);
  log.info(`negative-control list: ${entries.length} agent PRs, ${out.trippedCheatPattern} tripped a cheat pattern -> ${args.out}`);
}

if (require.main === module) {
  main().catch((err: unknown) => {
    log.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
    process.exitCode = 1;
  });
}
