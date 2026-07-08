// Phase 1.4 regression for the miner definitional tightening. For each PR in an
// input list, fetch the RAW conversation (bots and self-comments included, unlike
// the tightened fetchPrConversation) and classify every cheat-phrase match by the
// author's role: the PR author (self), a bot (the Copilot review surface and other
// [bot]/type=Bot accounts), or another human. The tightened intake admits a PR only
// when a non-author, non-bot human matched a cheat phrase. Run over the last
// package's 24 candidates (the noise fixture: every self/bot match must be excluded)
// and over the folded corpus (every entry must still be admitted, or the exclusion
// is reported). Read-only, GitHub core API only.
//
// Usage:
//   node dist/scripts/real-prs/mining-verification/tightening-regression.js \
//     --input <list.json> --out <result.json> --label <name>

import * as fs from 'fs';
import * as path from 'path';
import { loadDotenv } from '../../../src/env-loader';
import { getLogger } from '../../../src/logger';
import {
  extractComplaintSignals,
  isBotAuthor,
  makeOctokit,
  parseRepo,
  resolveGithubToken,
  withRetry,
} from '../lib/github';

const log = getLogger('real-prs:tightening-regression');

interface Args {
  input: string;
  out: string;
  label: string;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { input: '', out: '', label: 'regression' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--input' && next !== undefined) (a.input = next), (i += 1);
    else if (arg === '--out' && next !== undefined) (a.out = next), (i += 1);
    else if (arg === '--label' && next !== undefined) (a.label = next), (i += 1);
  }
  if (a.input === '' || a.out === '') throw new Error('requires --input and --out');
  return a;
}

interface InputEntry {
  repo: string;
  prNumber: number;
}

type Role = 'self' | 'bot' | 'human';

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

async function fetchRaw(octokit: OctokitConv, repo: string, prNumber: number): Promise<{ prAuthor: string; entries: RawEntry[] }> {
  const t = parseRepo(repo);
  const pr = await withRetry(() => octokit.pulls.get({ owner: t.owner, repo: t.repo, pull_number: prNumber }), `pr ${repo}#${prNumber}`);
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

export interface RegressionEntry {
  id: string;
  repo: string;
  prNumber: number;
  prAuthor: string;
  fetchError?: string;
  /** cheat-phrase matches by author role. */
  matchesByRole: Record<Role, number>;
  /** A cheat phrase matched at all (old, untightened behavior). */
  oldHit: boolean;
  /** A non-author, non-bot human matched a cheat phrase (tightened behavior). */
  newHit: boolean;
  /** Why the tightening excluded a PR that used to hit. */
  excludedReason?: 'self-only' | 'bot-only' | 'self-and-bot';
}

/** Pure: fold the raw entries into the regression record for one PR. */
export function classifyPr(id: string, repo: string, prNumber: number, prAuthor: string, entries: readonly RawEntry[]): RegressionEntry {
  const byRole: Record<Role, number> = { self: 0, bot: 0, human: 0 };
  for (const e of entries) {
    const signals = extractComplaintSignals(e.body, e.source);
    if (signals.length === 0) continue;
    byRole[roleOf(e, prAuthor)] += 1;
  }
  const oldHit = byRole.self + byRole.bot + byRole.human > 0;
  const newHit = byRole.human > 0;
  const out: RegressionEntry = { id, repo, prNumber, prAuthor, matchesByRole: byRole, oldHit, newHit };
  if (oldHit && !newHit) {
    out.excludedReason = byRole.self > 0 && byRole.bot > 0 ? 'self-and-bot' : byRole.self > 0 ? 'self-only' : 'bot-only';
  }
  return out;
}

async function main(): Promise<void> {
  loadDotenv();
  const args = parseArgs(process.argv.slice(2));
  const octokit = makeOctokit(resolveGithubToken()) as unknown as OctokitConv;
  const list = JSON.parse(fs.readFileSync(args.input, 'utf8')) as { entries: InputEntry[] };
  const results: RegressionEntry[] = [];
  for (const e of list.entries) {
    const id = `${e.repo.replace(/[^\w.-]+/g, '-')}-pr${e.prNumber}`;
    try {
      const { prAuthor, entries } = await fetchRaw(octokit, e.repo, e.prNumber);
      results.push(classifyPr(id, e.repo, e.prNumber, prAuthor, entries));
    } catch (err) {
      results.push({ id, repo: e.repo, prNumber: e.prNumber, prAuthor: '', matchesByRole: { self: 0, bot: 0, human: 0 }, oldHit: false, newHit: false, fetchError: String(err) });
    }
    log.info(`${id}: old=${results[results.length - 1]!.oldHit} new=${results[results.length - 1]!.newHit}${results[results.length - 1]!.excludedReason ? ` (${results[results.length - 1]!.excludedReason})` : ''}`);
  }
  const summary = {
    total: results.length,
    oldHit: results.filter((r) => r.oldHit).length,
    newHit: results.filter((r) => r.newHit).length,
    excludedSelfOnly: results.filter((r) => r.excludedReason === 'self-only').length,
    excludedBotOnly: results.filter((r) => r.excludedReason === 'bot-only').length,
    excludedSelfAndBot: results.filter((r) => r.excludedReason === 'self-and-bot').length,
    fetchErrors: results.filter((r) => r.fetchError !== undefined).length,
  };
  const out = {
    generatedBy: 'scripts/real-prs/mining-verification/tightening-regression.ts',
    label: args.label,
    input: args.input,
    summary,
    entries: results,
  };
  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, `${JSON.stringify(out, null, 2)}\n`);
  log.info(`${args.label}: ${JSON.stringify(summary)} -> ${args.out}`);
}

if (require.main === module) {
  main().catch((err: unknown) => {
    log.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
    process.exitCode = 1;
  });
}
