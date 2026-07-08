// Close-out Phase 1: complaint-bar audit and stratification.
//
// The fold-time capture schema (`complaints` in hunt2 population.json and the
// corpus dataset) recorded only the cheat-phrase and source-type, never the
// comment author. So no entry's strict-bar status is settleable from frozen
// captured evidence; the only authorship signal is a live re-fetch. This script
// performs that live check for every corpus entry, classifying each cheat-phrase
// complaint by author role (self / bot / human-non-author), recording whether the
// repo is solo-maintainer (owner == PR author), and assigning a complaint_bar:
//
//   strict     a human other than the PR author currently carries a cheat phrase
//   legacy     only the PR author (self) or a bot carries one (present under the
//              original loose bar, fails the strict bar)
//   uncertain  the live thread cannot settle it (fetch error / deleted PR / the
//              cheat phrase no longer appears in any comment)
//
// The `solo` flag marks a legacy entry whose only complaint is a self-flag by the
// repo owner: a maintainer flagging their own agent's PR is a real signal of a
// different kind, not the strict bar and not noise.
//
// Read-only, GitHub core API only. Frozen corpus files are not modified; this
// writes the audit JSON only. The v3 dataset (entries byte-identical + the
// complaint_bar field) is stamped by fold-complaint-bar.ts from this output.
//
// Usage:
//   node dist/scripts/real-prs/mining-verification/complaint-bar-audit.js \
//     --input <list.json> --dataset <corpus dataset.json> --out <audit.json>

import * as fs from 'fs';
import * as path from 'path';
import { loadDotenv } from '../../../src/env-loader';
import { getLogger } from '../../../src/logger';
import { SwarmError } from '../../../src/errors';
import {
  extractComplaintSignals,
  isBotAuthor,
  makeOctokit,
  parseRepo,
  resolveGithubToken,
  withRetry,
} from '../lib/github';

const log = getLogger('real-prs:complaint-bar-audit');

interface Args {
  input: string;
  dataset: string;
  datasetOut: string;
  version: string;
  out: string;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { input: '', dataset: '', datasetOut: '', version: 'v3', out: '' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--input' && next !== undefined) (a.input = next), (i += 1);
    else if (arg === '--dataset' && next !== undefined) (a.dataset = next), (i += 1);
    else if (arg === '--dataset-out' && next !== undefined) (a.datasetOut = next), (i += 1);
    else if (arg === '--version' && next !== undefined) (a.version = next), (i += 1);
    else if (arg === '--out' && next !== undefined) (a.out = next), (i += 1);
  }
  if (a.input === '' || a.out === '') throw new Error('requires --input and --out');
  return a;
}

interface InputEntry {
  repo: string;
  prNumber: number;
}

type Role = 'self' | 'bot' | 'human';
type ComplaintBar = 'strict' | 'legacy' | 'uncertain';

interface RawEntry {
  source: string;
  author: string;
  authorType: string | undefined;
  body: string;
}

interface OctokitConv {
  pulls: {
    get(p: { owner: string; repo: string; pull_number: number }): Promise<{ data: { user: { login?: string } | null } }>;
    listReviews: unknown;
    listReviewComments: unknown;
  };
  issues: { listComments: unknown };
  paginate(fn: unknown, p: unknown): Promise<Array<{ user?: { login?: string; type?: string } | null; body?: string | null }>>;
}

async function fetchRaw(
  octokit: OctokitConv,
  repo: string,
  prNumber: number,
): Promise<{ prAuthor: string; entries: RawEntry[] }> {
  const t = parseRepo(repo);
  const pr = await withRetry(
    () => octokit.pulls.get({ owner: t.owner, repo: t.repo, pull_number: prNumber }),
    `pr ${repo}#${prNumber}`,
  );
  const prAuthor = pr.data.user?.login ?? '';
  const entries: RawEntry[] = [];
  const collect = async (fn: unknown, source: string, key: 'pull_number' | 'issue_number'): Promise<void> => {
    const items = await withRetry(
      () => octokit.paginate(fn, { owner: t.owner, repo: t.repo, [key]: prNumber, per_page: 100 }),
      `${source} ${repo}#${prNumber}`,
    );
    for (const it of items) {
      const body = it.body ?? '';
      if (body.trim().length === 0) continue;
      entries.push({ source, author: it.user?.login ?? '', authorType: it.user?.type ?? undefined, body });
    }
  };
  await collect(octokit.pulls.listReviews, 'review', 'pull_number');
  await collect(octokit.pulls.listReviewComments, 'review-comment', 'pull_number');
  await collect(octokit.issues.listComments, 'issue-comment', 'issue_number');
  return { prAuthor, entries };
}

function roleOf(entry: RawEntry, prAuthor: string): Role {
  if (prAuthor.length > 0 && entry.author.toLowerCase() === prAuthor.toLowerCase()) return 'self';
  if (isBotAuthor(entry.author, entry.authorType)) return 'bot';
  return 'human';
}

/** One classified cheat-phrase match: who said it, where, and the phrase. */
interface Match {
  role: Role;
  author: string;
  source: string;
  phrase: string;
  category: string;
}

export interface AuditEntry {
  id: string;
  repo: string;
  prNumber: number;
  prAuthor: string;
  repoOwner: string;
  /** repo owner == PR author (case-insensitive): the solo-maintainer shape. */
  solo: boolean;
  matchesByRole: Record<Role, number>;
  /** Distinct human non-author complainant logins (the strict-bar evidence). */
  humanComplainants: string[];
  matches: Match[];
  complaintBar: ComplaintBar;
  barNote: string;
  fetchError?: string;
}

/** Pure: fold the raw entries into the audit record for one PR. */
export function auditPr(
  id: string,
  repo: string,
  prNumber: number,
  prAuthor: string,
  entries: readonly RawEntry[],
): AuditEntry {
  const repoOwner = parseRepo(repo).owner;
  const solo = repoOwner.length > 0 && repoOwner.toLowerCase() === prAuthor.toLowerCase();
  const byRole: Record<Role, number> = { self: 0, bot: 0, human: 0 };
  const matches: Match[] = [];
  const humanSet = new Set<string>();
  for (const e of entries) {
    const signals = extractComplaintSignals(e.body, e.source);
    if (signals.length === 0) continue;
    const role = roleOf(e, prAuthor);
    byRole[role] += 1;
    if (role === 'human' && e.author.length > 0) humanSet.add(e.author);
    for (const s of signals) {
      matches.push({ role, author: e.author, source: s.source, phrase: s.phrase, category: s.category });
    }
  }
  const authorIsBot = isBotAuthor(prAuthor, undefined);
  let complaintBar: ComplaintBar;
  let barNote: string;
  if (byRole.human > 0) {
    complaintBar = 'strict';
    barNote = `human non-author complaint (${humanSet.size} distinct: ${[...humanSet].join(', ')})`;
  } else if (byRole.self > 0 || byRole.bot > 0) {
    complaintBar = 'legacy';
    if (byRole.self > 0 && solo) barNote = 'solo-maintainer self-flag (repo owner == PR author)';
    else if (byRole.self > 0 && authorIsBot) barNote = 'bot-self (the PR author is a bot)';
    else if (byRole.self > 0 && byRole.bot > 0) barNote = 'self-and-bot only';
    else if (byRole.self > 0) barNote = 'self-only (non-owner contributor)';
    else barNote = 'bot-only (bot review surface)';
  } else {
    complaintBar = 'uncertain';
    barNote = 'no cheat-phrase complaint in the current thread (capture-time comment may be edited or deleted)';
  }
  const out: AuditEntry = {
    id,
    repo,
    prNumber,
    prAuthor,
    repoOwner,
    solo,
    matchesByRole: byRole,
    humanComplainants: [...humanSet],
    matches,
    complaintBar,
    barNote,
  };
  return out;
}

async function main(): Promise<void> {
  loadDotenv();
  const args = parseArgs(process.argv.slice(2));
  const octokit = makeOctokit(resolveGithubToken()) as unknown as OctokitConv;
  const list = JSON.parse(fs.readFileSync(args.input, 'utf8')) as { entries: InputEntry[] };
  const results: AuditEntry[] = [];
  for (const e of list.entries) {
    const id = `${e.repo.replace(/[^\w.-]+/g, '-')}-pr${e.prNumber}`;
    try {
      const { prAuthor, entries } = await fetchRaw(octokit, e.repo, e.prNumber);
      results.push(auditPr(id, e.repo, e.prNumber, prAuthor, entries));
    } catch (err) {
      const repoOwner = parseRepo(e.repo).owner;
      results.push({
        id,
        repo: e.repo,
        prNumber: e.prNumber,
        prAuthor: '',
        repoOwner,
        solo: false,
        matchesByRole: { self: 0, bot: 0, human: 0 },
        humanComplainants: [],
        matches: [],
        complaintBar: 'uncertain',
        barNote: `fetch error (deleted or private PR): ${String(err)}`,
        fetchError: String(err),
      });
    }
    const r = results[results.length - 1]!;
    log.info(`${id}: bar=${r.complaintBar} solo=${r.solo} roles=${JSON.stringify(r.matchesByRole)} (${r.barNote})`);
  }
  const summary = {
    total: results.length,
    strict: results.filter((r) => r.complaintBar === 'strict').length,
    legacy: results.filter((r) => r.complaintBar === 'legacy').length,
    uncertain: results.filter((r) => r.complaintBar === 'uncertain').length,
    soloMaintainerSelfFlag: results.filter((r) => r.complaintBar === 'legacy' && r.solo && r.matchesByRole.self > 0).length,
    fetchErrors: results.filter((r) => r.fetchError !== undefined).length,
  };
  const out = {
    generatedBy: 'scripts/real-prs/mining-verification/complaint-bar-audit.ts',
    caveat:
      'Fold-time capture never stored the complaint author, so every strict/legacy assignment here is a live reconstruction (dated at run time), carrying a bounded temporal-drift risk. Only entries the live thread itself cannot settle are marked uncertain.',
    input: args.input,
    summary,
    entries: results,
  };
  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, `${JSON.stringify(out, null, 2)}\n`);
  log.info(`complaint-bar-audit: ${JSON.stringify(summary)} -> ${args.out}`);

  if (args.dataset !== '' && args.datasetOut !== '') {
    stampDataset(args.dataset, args.datasetOut, args.version, results);
  }
}

/** Copy the prior corpus dataset byte-for-byte per entry and add the complaint_bar
 *  stratification fields, matched to the audit by repo + prNumber. Never edits an
 *  existing corpus version: this writes a new version file only. */
export function stampDataset(
  datasetPath: string,
  outPath: string,
  version: string,
  audit: readonly AuditEntry[],
): void {
  const prior = JSON.parse(fs.readFileSync(datasetPath, 'utf8')) as {
    entries: Array<Record<string, unknown> & { repo: string; prNumber: number }>;
  };
  const byKey = new Map(audit.map((a) => [`${a.repo}#${a.prNumber}`, a]));
  const entries = prior.entries.map((e) => {
    const a = byKey.get(`${e.repo}#${e.prNumber}`);
    if (a === undefined) {
      throw new SwarmError(
        `no complaint-bar audit for ${e.repo}#${e.prNumber}; the audit input must cover every corpus entry`,
        'REAL_PRS_BAR_UNAUDITED',
        { remediation: 'Add the entry to the --input list and re-run the audit.' },
      );
    }
    return {
      ...e,
      complaintBar: a.complaintBar,
      complaintBarNote: a.barNote,
      solo: a.solo,
      humanComplainants: a.humanComplainants,
    };
  });
  const strata = {
    strict: entries.filter((e) => e.complaintBar === 'strict').length,
    legacy: entries.filter((e) => e.complaintBar === 'legacy').length,
    uncertain: entries.filter((e) => e.complaintBar === 'uncertain').length,
  };
  const out = {
    version,
    generatedBy: 'scripts/real-prs/mining-verification/complaint-bar-audit.ts',
    note: `Wild cheat corpus ${version}: ${(prior as { version?: string }).version ?? 'prior'} entries carried forward byte-identical, plus a complaint_bar stratification (strict / legacy / uncertain) from a live thread re-fetch. No entry added or removed. See COMPLAINT-BAR-AUDIT.md.`,
    strata,
    entries,
  };
  fs.writeFileSync(outPath, `${JSON.stringify(out, null, 2)}\n`);
  log.info(`stamped ${version}: strata=${JSON.stringify(strata)} -> ${outPath}`);
}

if (require.main === module) {
  main().catch((err: unknown) => {
    log.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
    process.exitCode = 1;
  });
}
