import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  revertCandidatesFromItem,
  attributeAndConfirm,
  mineBackward,
  mergeCorpus,
  loadCheckpoint,
  mergeCheckpoint,
  saveCheckpoint,
  splitClaimable,
  type BackwardOctokit,
  type BackwardEntry,
  type BackwardCheckpoint,
  type CheckpointRejection,
} from '../../scripts/real-prs/mine-backward';
import {
  blamedShasInMessage,
  followupCandidateFromDetail,
  hotfixCandidatesFromItem,
  regressionFixCandidatesFromItem,
  type CommitSearchItem,
  type FollowupPrDetail,
} from '../../scripts/real-prs/backward-discovery';

// A reverted agent commit. The discovery search surfaces the revert commit; the
// confirm search (findOutcomeEvidence) sees the same revert, so a mined entry
// must carry the revert commit sha as its canonical evidence. This is the
// deterministic stand-in for the live spot-check: every mined entry's evidence
// is asserted against the revert that surfaced it.
const REVERTED_SHA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const REVERT_SHA = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const HOTFIX_SHA = 'cccccccccccccccccccccccccccccccccccccccc';
const REPO = 'acme/widgets';

const REVERT_ITEM: CommitSearchItem = {
  sha: REVERT_SHA,
  commit: { message: `Revert "feat"\n\nThis reverts commit ${REVERTED_SHA}.` },
  repository: { full_name: REPO },
};

interface FollowupItem {
  number: number;
  title: string;
  html_url: string;
  user?: { login?: string } | null;
}

interface MockOpts {
  /** head ref of the associated PR, drives agent attribution. */
  headRef?: string;
  /** when false, listPullRequestsAssociatedWithCommit returns []. */
  hasPr?: boolean;
  /** when true, the confirm search returns no revert (outcome survived). */
  noRevertOnConfirm?: boolean;
  /** revert-marker discovery items, per page; defaults to the standard item. */
  revertItems?: CommitSearchItem[] | ((page: number) => CommitSearchItem[]);
  /** hotfix-marker discovery items; defaults to none. */
  hotfixItems?: CommitSearchItem[];
  /** issue-linked-regression discovery items; defaults to none. */
  regressionItems?: CommitSearchItem[];
  /** followup-fix (thin-review PR search) items; defaults to none. */
  followupItems?: FollowupItem[];
  /** overrides for the followup PR detail; defaults to a thin-review merge. */
  followupDetail?: Partial<{
    merged_at: string | null;
    merge_commit_sha: string | null;
    merged_by: { login: string } | null;
    review_comments: number;
  }>;
}

function makeOctokit(opts: MockOpts = {}): {
  octokit: BackwardOctokit;
  calls: () => number;
  prSearches: () => number;
} {
  let calls = 0;
  let prSearches = 0;
  const octokit: BackwardOctokit = {
    repos: {
      get: async () => ({ data: { default_branch: 'main' } }),
      getCommit: async () => ({
        data: {
          sha: REVERTED_SHA,
          html_url: `https://github.com/${REPO}/commit/${REVERTED_SHA}`,
          commit: {
            message: 'feat: add widget',
            committer: { date: '2026-01-01T00:00:00Z' },
            author: { date: '2026-01-01T00:00:00Z' },
          },
          files: [{ filename: 'src/widget.ts', patch: '@@ -1,2 +1,3 @@\n+const x = 1;' }],
        },
      }),
      listCommits: async () => ({ data: [] }),
      compareCommits: async () => ({ data: { status: 'ahead' } }),
      listPullRequestsAssociatedWithCommit: async () => ({
        data:
          opts.hasPr === false
            ? []
            : [
                {
                  number: 42,
                  title: 'Add widget',
                  body: 'a widget',
                  head: { ref: opts.headRef ?? 'cursor/add-widget' },
                  user: { login: 'someone' },
                  merged_at: '2026-01-01T00:00:00Z',
                },
              ],
      }),
    },
    pulls: {
      get: async () => ({
        data: {
          number: 42,
          merged_at: opts.followupDetail?.merged_at !== undefined ? opts.followupDetail.merged_at : '2026-01-01T00:00:00Z',
          merge_commit_sha:
            opts.followupDetail?.merge_commit_sha !== undefined
              ? opts.followupDetail.merge_commit_sha
              : REVERTED_SHA,
          head: { sha: REVERTED_SHA },
          user: { login: 'someone' },
          merged_by:
            opts.followupDetail?.merged_by !== undefined
              ? opts.followupDetail.merged_by
              : { login: 'someone' },
          review_comments: opts.followupDetail?.review_comments ?? 0,
        },
      }),
    },
    search: {
      commits: async (p: { q: string; page?: number }) => {
        calls += 1;
        if (p.q.startsWith('repo:')) {
          if (opts.noRevertOnConfirm === true) return { data: { items: [] } };
          return {
            data: {
              items: [
                {
                  sha: REVERT_SHA,
                  html_url: `https://github.com/${REPO}/commit/${REVERT_SHA}`,
                  commit: { message: `Revert "feat: add widget"\n\nThis reverts commit ${REVERTED_SHA}.` },
                },
              ],
            },
          };
        }
        if (p.q.includes('This reverts commit')) {
          const items =
            typeof opts.revertItems === 'function'
              ? opts.revertItems(p.page ?? 1)
              : opts.revertItems ?? [REVERT_ITEM];
          return { data: { items } };
        }
        if (p.q.includes('hotfix')) return { data: { items: opts.hotfixItems ?? [] } };
        return { data: { items: opts.regressionItems ?? [] } };
      },
      issuesAndPullRequests: async () => {
        prSearches += 1;
        return { data: { items: opts.followupItems ?? [] } };
      },
    },
  } as unknown as BackwardOctokit;
  return { octokit, calls: () => calls, prSearches: () => prSearches };
}

const generousBudget = { apiBudget: 1000, wallClockMs: 1_000_000, limit: 50, months: 18, now: () => 0 };

describe('revertCandidatesFromItem (pure)', () => {
  it('extracts the repo and reverted sha from a revert commit', () => {
    const cands = revertCandidatesFromItem({
      sha: REVERT_SHA,
      commit: { message: `Revert\n\nThis reverts commit ${REVERTED_SHA}.` },
      repository: { full_name: REPO },
    });
    assert.equal(cands.length, 1);
    assert.equal(cands[0]!.repo, REPO);
    assert.equal(cands[0]!.revertedSha, REVERTED_SHA.toLowerCase());
    assert.equal(cands[0]!.surfacedBy, REVERT_SHA);
    assert.equal(cands[0]!.source, 'revert-marker');
  });

  it('returns [] when the search item has no repository', () => {
    assert.deepEqual(
      revertCandidatesFromItem({ sha: REVERT_SHA, commit: { message: 'Revert\n\nThis reverts commit deadbeef.' }, repository: null }),
      [],
    );
  });
});

describe('blamedShasInMessage (pure)', () => {
  it('extracts a sha the message blames for the breakage', () => {
    assert.deepEqual(blamedShasInMessage(`fix crash caused by ${REVERTED_SHA}`), [REVERTED_SHA]);
    assert.deepEqual(blamedShasInMessage('regression from deadbeef123 in the parser'), ['deadbeef123']);
  });

  it('extracts a sha blamed via a commit URL', () => {
    const msg = `hotfix: broken by https://github.com/${REPO}/commit/${REVERTED_SHA}`;
    assert.deepEqual(blamedShasInMessage(msg), [REVERTED_SHA]);
  });

  it('ignores short hex runs and ordinary prose', () => {
    assert.deepEqual(blamedShasInMessage('fix the bug introduced in decade one, caused by bad00 luck'), []);
  });
});

describe('hotfixCandidatesFromItem (pure)', () => {
  it('derives a candidate from a hotfix commit that blames a sha', () => {
    const cands = hotfixCandidatesFromItem({
      sha: HOTFIX_SHA,
      commit: { message: `hotfix: crash caused by ${REVERTED_SHA}` },
      repository: { full_name: REPO },
    });
    assert.equal(cands.length, 1);
    assert.equal(cands[0]!.revertedSha, REVERTED_SHA);
    assert.equal(cands[0]!.source, 'hotfix-marker');
    assert.equal(cands[0]!.surfacedBy, HOTFIX_SHA);
  });

  it('derives nothing from a hotfix that names no commit', () => {
    const cands = hotfixCandidatesFromItem({
      sha: HOTFIX_SHA,
      commit: { message: 'hotfix: crash in the parser' },
      repository: { full_name: REPO },
    });
    assert.deepEqual(cands, []);
  });
});

describe('regressionFixCandidatesFromItem (pure)', () => {
  const message = `fix parser crash, closes #42\n\nregression introduced in ${REVERTED_SHA}`;

  it('derives a candidate from an issue-linked regression fix that blames a sha', () => {
    const cands = regressionFixCandidatesFromItem({
      sha: HOTFIX_SHA,
      commit: { message },
      repository: { full_name: REPO },
    });
    assert.equal(cands.length, 1);
    assert.equal(cands[0]!.revertedSha, REVERTED_SHA);
    assert.equal(cands[0]!.source, 'issue-linked-regression');
  });

  it('derives nothing without an issue link', () => {
    const cands = regressionFixCandidatesFromItem({
      sha: HOTFIX_SHA,
      commit: { message: `fix parser crash\n\nregression introduced in ${REVERTED_SHA}` },
      repository: { full_name: REPO },
    });
    assert.deepEqual(cands, []);
  });

  it('derives nothing without a blamed sha', () => {
    const cands = regressionFixCandidatesFromItem({
      sha: HOTFIX_SHA,
      commit: { message: 'fix parser crash, closes #42' },
      repository: { full_name: REPO },
    });
    assert.deepEqual(cands, []);
  });
});

describe('followupCandidateFromDetail (pure)', () => {
  const thin: FollowupPrDetail = {
    repo: REPO,
    number: 42,
    url: `https://github.com/${REPO}/pull/42`,
    mergedAt: '2026-01-01T00:00:00Z',
    mergeCommitSha: REVERTED_SHA,
    headSha: 'dddddddddddddddddddddddddddddddddddddddd',
    authorLogin: 'someone',
    mergedByLogin: 'someone',
    reviewCommentCount: 0,
  };

  it('derives a candidate on the merge commit for a thin-review author-merged PR', () => {
    const res = followupCandidateFromDetail(thin);
    assert.ok('candidate' in res);
    assert.equal(res.candidate.revertedSha, REVERTED_SHA);
    assert.equal(res.candidate.source, 'followup-fix');
    assert.equal(res.candidate.surfacedBy, thin.url);
  });

  it('falls back to the head sha when GitHub reports no merge commit', () => {
    const res = followupCandidateFromDetail({ ...thin, mergeCommitSha: null });
    assert.ok('candidate' in res);
    assert.equal(res.candidate.revertedSha, thin.headSha);
  });

  it('rejects a PR with review comments as not thin-review', () => {
    const res = followupCandidateFromDetail({ ...thin, reviewCommentCount: 3 });
    assert.deepEqual(res, { dropReason: 'not-thin-review' });
  });

  it('rejects a PR merged by someone other than its author', () => {
    const res = followupCandidateFromDetail({ ...thin, mergedByLogin: 'maintainer' });
    assert.deepEqual(res, { dropReason: 'not-thin-review' });
  });

  it('rejects a dependency-bot PR', () => {
    const res = followupCandidateFromDetail({
      ...thin,
      authorLogin: 'renovate[bot]',
      mergedByLogin: 'renovate[bot]',
    });
    assert.deepEqual(res, { dropReason: 'dependency-bot' });
  });

  it('rejects an unmerged PR', () => {
    assert.deepEqual(followupCandidateFromDetail({ ...thin, mergedAt: null }), { dropReason: 'not-merged' });
  });

  it('rejects an excluded-owner repo', () => {
    const res = followupCandidateFromDetail({ ...thin, repo: 'moonrunnerkc/swarm-orchestrator' });
    assert.deepEqual(res, { dropReason: 'excluded-owner' });
  });
});

describe('attributeAndConfirm', () => {
  const candidate = { repo: REPO, revertedSha: REVERTED_SHA, surfacedBy: REVERT_SHA };
  const alwaysSpend = (): boolean => true;

  it('mines an agent-attributed reverted commit and carries the revert sha as evidence', async () => {
    const { octokit } = makeOctokit();
    const entry = await attributeAndConfirm(octokit, candidate, alwaysSpend);
    assert.ok(entry !== null);
    assert.equal(entry!.vendor.toLowerCase().includes('cursor'), true);
    assert.equal(entry!.outcome, 'reverted');
    assert.equal(entry!.revertedSha, REVERTED_SHA);
    // The spot-check: the entry's canonical evidence names the revert commit.
    assert.ok(entry!.evidence.some((e) => e.kind === 'revert-commit' && e.ref === REVERT_SHA));
  });

  it('returns null when the reverted commit is not agent-attributed', async () => {
    const { octokit } = makeOctokit({ headRef: 'feature/manual', hasPr: true });
    const entry = await attributeAndConfirm(octokit, candidate, alwaysSpend);
    assert.equal(entry, null);
  });

  it('returns null when the outcome cannot be confirmed (survived)', async () => {
    const { octokit } = makeOctokit({ noRevertOnConfirm: true });
    const entry = await attributeAndConfirm(octokit, candidate, alwaysSpend);
    assert.equal(entry, null);
  });

  it('respects the spend budget (returns null when spend is denied)', async () => {
    const { octokit } = makeOctokit();
    const entry = await attributeAndConfirm(octokit, candidate, () => false);
    assert.equal(entry, null);
  });
});

describe('mineBackward (budgets)', () => {
  it('mines a confirmed entry end to end', async () => {
    const { octokit } = makeOctokit();
    const result = await mineBackward(octokit, { ...generousBudget });
    assert.equal(result.entries.length, 1);
    assert.equal(result.entries[0]!.outcome, 'reverted');
    assert.equal(result.entries[0]!.source, 'revert-marker');
    assert.ok(result.entries[0]!.evidence.some((e) => e.ref === REVERT_SHA));
  });

  it('records a staged funnel that ends at the confirmed entry', async () => {
    const { octokit } = makeOctokit();
    const result = await mineBackward(octokit, { ...generousBudget });
    const f = result.funnel;
    // The mock surfaces the same revert on every page, so dedup collapses all
    // but the first candidate; the surviving one passes the whole funnel.
    assert.equal(f.candidatesProcessed, 1);
    assert.equal(f.agentAttributed, 1);
    assert.equal(f.evidenceChecked, 1);
    assert.equal(f.evidenceConfirmed, 1);
    assert.ok(f.dropReasons['duplicate-candidate']! >= 1);
    // Per-source split: everything above happened under the revert source.
    assert.equal(f.bySource['revert-marker']!.confirmed, 1);
    assert.ok(f.bySource['revert-marker']!.markers >= 1);
  });

  it('funnel localizes a non-agent drop to the attribution stage and its source', async () => {
    const { octokit } = makeOctokit({ headRef: 'feature/manual', hasPr: true });
    const result = await mineBackward(octokit, { ...generousBudget });
    assert.equal(result.entries.length, 0);
    assert.equal(result.funnel.agentAttributed, 0);
    assert.equal(result.funnel.dropReasons['not-agent-attributed'], 1);
    assert.equal(result.funnel.bySource['revert-marker']!.dropReasons['not-agent-attributed'], 1);
  });

  it('stops at the api budget and reports it', async () => {
    const { octokit } = makeOctokit();
    const result = await mineBackward(octokit, { ...generousBudget, apiBudget: 1 });
    assert.equal(result.stoppedReason, 'api-budget');
    assert.ok(result.apiCalls <= 1);
  });

  it('stops at the wall-clock cap and reports it', async () => {
    const { octokit } = makeOctokit();
    let t = 0;
    const result = await mineBackward(octokit, {
      ...generousBudget,
      wallClockMs: 5,
      now: () => (t += 10),
    });
    assert.equal(result.stoppedReason, 'wall-clock');
  });

  it('stops at the entry limit', async () => {
    const { octokit } = makeOctokit();
    const result = await mineBackward(octokit, { ...generousBudget, limit: 0 });
    assert.equal(result.stoppedReason, 'limit');
    assert.equal(result.entries.length, 0);
  });
});

describe('mineBackward (widened discovery)', () => {
  it('confirms an entry surfaced by a hotfix marker and labels its source', async () => {
    const { octokit } = makeOctokit({
      revertItems: [],
      hotfixItems: [
        {
          sha: HOTFIX_SHA,
          commit: { message: `hotfix: crash caused by ${REVERTED_SHA}` },
          repository: { full_name: REPO },
        },
      ],
    });
    const result = await mineBackward(octokit, { ...generousBudget });
    assert.equal(result.entries.length, 1);
    assert.equal(result.entries[0]!.source, 'hotfix-marker');
    assert.equal(result.entries[0]!.surfacedBy, HOTFIX_SHA);
    assert.equal(result.funnel.bySource['hotfix-marker']!.confirmed, 1);
    // The confirmation bar is the shared one: the entry still carries the
    // canonical revert-commit evidence findOutcomeEvidence found.
    assert.ok(result.entries[0]!.evidence.some((e) => e.kind === 'revert-commit' && e.ref === REVERT_SHA));
  });

  it('confirms an entry from a thin-review agent merge with a follow-up revert', async () => {
    const { octokit } = makeOctokit({
      revertItems: [],
      followupItems: [
        { number: 42, title: 'Add widget', html_url: `https://github.com/${REPO}/pull/42`, user: { login: 'someone' } },
      ],
    });
    const result = await mineBackward(octokit, { ...generousBudget });
    assert.equal(result.entries.length, 1);
    assert.equal(result.entries[0]!.source, 'followup-fix');
    assert.equal(result.entries[0]!.revertedSha, REVERTED_SHA);
    assert.equal(result.funnel.bySource['followup-fix']!.confirmed, 1);
    assert.ok(result.funnel.bySource['followup-fix']!.markers >= 1);
  });

  it('drops a non-thin followup hit with a labeled rejection reason, not silently', async () => {
    const { octokit } = makeOctokit({
      revertItems: [],
      followupItems: [
        { number: 42, title: 'Add widget', html_url: `https://github.com/${REPO}/pull/42`, user: { login: 'someone' } },
      ],
      followupDetail: { review_comments: 2 },
    });
    const result = await mineBackward(octokit, { ...generousBudget });
    assert.equal(result.entries.length, 0);
    assert.ok(result.funnel.bySource['followup-fix']!.dropReasons['not-thin-review']! >= 1);
  });

  it('dedups a candidate two sources both surface, charging the later source', async () => {
    const { octokit } = makeOctokit({
      hotfixItems: [
        {
          sha: HOTFIX_SHA,
          commit: { message: `hotfix: crash caused by ${REVERTED_SHA}` },
          repository: { full_name: REPO },
        },
      ],
    });
    const result = await mineBackward(octokit, { ...generousBudget });
    // The revert source mined the entry; the hotfix source's identical
    // candidate is recorded as a duplicate under ITS funnel, so overlap
    // between the nets stays measurable.
    assert.equal(result.entries.length, 1);
    assert.equal(result.entries[0]!.source, 'revert-marker');
    assert.ok(result.funnel.bySource['hotfix-marker']!.dropReasons['duplicate-candidate']! >= 1);
    assert.equal(result.funnel.bySource['hotfix-marker']!.confirmed, 0);
  });

  it('budget shares keep the first source from starving the rest', async () => {
    // Endless revert pages, each with a fresh sha, none agent-attributed:
    // without shares this alone would drain the whole budget.
    const { octokit, prSearches } = makeOctokit({
      hasPr: false,
      revertItems: (page: number) => [
        {
          sha: REVERT_SHA,
          commit: {
            message: `Revert\n\nThis reverts commit ${page.toString(16).padStart(4, '0')}${'f'.repeat(36)}.`,
          },
          repository: { full_name: REPO },
        },
      ],
    });
    const result = await mineBackward(octokit, { ...generousBudget, apiBudget: 12 });
    assert.equal(result.funnel.bySource['revert-marker']!.stopped, 'source-budget');
    // The later sources still ran their searches inside the shared budget.
    assert.ok(result.funnel.bySource['hotfix-marker']!.markers >= 0);
    assert.ok(prSearches() >= 1);
    assert.ok(result.apiCalls <= 12);
  });

  it('records every source query in the discovery descriptors', async () => {
    const { octokit } = makeOctokit({ revertItems: [] });
    const result = await mineBackward(octokit, { ...generousBudget });
    const sources = result.discovery.map((d) => d.source);
    assert.deepEqual(sources, ['revert-marker', 'hotfix-marker', 'issue-linked-regression', 'followup-fix']);
    const followup = result.discovery.find((d) => d.source === 'followup-fix')!;
    assert.ok(followup.aim!.includes('PREREGISTRATION-AMENDMENT-3'));
    assert.ok(followup.queries.every((q) => q.includes('review:none comments:0')));
    const revert = result.discovery.find((d) => d.source === 'revert-marker')!;
    assert.ok(revert.queries[0]!.includes('"This reverts commit"'));
  });
});

describe('mineBackward (checkpoint resume)', () => {
  it('skips an already-confirmed candidate without re-walking confirmation', async () => {
    const { octokit, calls } = makeOctokit();
    const alreadyConfirmed = new Set([`${REPO}@${REVERTED_SHA.toLowerCase()}`]);
    const result = await mineBackward(octokit, { ...generousBudget }, { alreadyConfirmed });
    assert.equal(result.entries.length, 0);
    assert.ok(result.funnel.dropReasons['already-confirmed']! >= 1);
    assert.equal(result.funnel.candidatesProcessed, 0);
    assert.equal(result.funnel.evidenceChecked, 0);
    // Only discovery searches spent calls; no per-candidate confirmation ran.
    assert.ok(calls() > 0);
  });

  it('still mines a candidate the checkpoint does not know', async () => {
    const { octokit } = makeOctokit();
    const alreadyConfirmed = new Set([`other/repo@${'9'.repeat(40)}`]);
    const result = await mineBackward(octokit, { ...generousBudget }, { alreadyConfirmed });
    assert.equal(result.entries.length, 1);
  });

  it('skips a review-rejected candidate with its labeled drop reason, spending nothing', async () => {
    const { octokit } = makeOctokit();
    const rejected = new Map([
      [`${REPO}@${REVERTED_SHA.toLowerCase()}`, 'rejected-revert-of-revert-restored'],
    ]);
    const result = await mineBackward(octokit, { ...generousBudget }, { rejected });
    assert.equal(result.entries.length, 0);
    assert.ok(result.funnel.dropReasons['rejected-revert-of-revert-restored']! >= 1);
    assert.equal(result.funnel.candidatesProcessed, 0);
    assert.equal(result.funnel.evidenceChecked, 0);
  });
});

describe('checkpoint persistence', () => {
  const entry = (repo: string, sha: string): BackwardEntry => ({
    repo,
    revertedSha: sha,
    prNumber: 1,
    vendor: 'cursor',
    outcome: 'reverted',
    evidence: [],
    surfacedBy: 'x',
  });

  it('mergeCheckpoint accumulates across runs, deduped by repo@sha', () => {
    const run1 = mergeCheckpoint(null, [entry('a/b', '111')], '2026-07-24T05:00:00Z');
    assert.equal(run1.entries.length, 1);
    assert.equal(run1.entries[0]!.firstConfirmedAt, '2026-07-24T05:00:00Z');
    const run2 = mergeCheckpoint(run1, [entry('a/b', '111'), entry('c/d', '222')], '2026-07-25T05:00:00Z');
    assert.equal(run2.entries.length, 2);
    assert.equal(run2.savedAt, '2026-07-25T05:00:00Z');
  });

  it('mergeCheckpoint keeps the prior entry and its firstConfirmedAt on a re-confirmation', () => {
    const prior: BackwardCheckpoint = {
      savedAt: '2026-07-16T05:00:00Z',
      entries: [{ ...entry('a/b', '111'), firstConfirmedAt: '2026-07-16T05:00:00Z' }],
    };
    const grown = mergeCheckpoint(prior, [{ ...entry('a/b', '111'), vendor: 'devin' }], '2026-07-25T05:00:00Z');
    assert.equal(grown.entries.length, 1);
    assert.equal(grown.entries[0]!.firstConfirmedAt, '2026-07-16T05:00:00Z');
    assert.equal(grown.entries[0]!.vendor, 'cursor');
  });

  it('round-trips through save and load', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'backward-ckpt-')), 'sub', 'checkpoint.json');
    const grown = mergeCheckpoint(null, [entry('a/b', '111')], '2026-07-25T05:00:00Z');
    saveCheckpoint(file, grown);
    const loaded = loadCheckpoint(file);
    assert.deepEqual(loaded, grown);
  });

  it('loadCheckpoint returns null for a missing or malformed file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'backward-ckpt-'));
    assert.equal(loadCheckpoint(path.join(dir, 'nope.json')), null);
    const bad = path.join(dir, 'bad.json');
    fs.writeFileSync(bad, 'not json');
    assert.equal(loadCheckpoint(bad), null);
    const wrongShape = path.join(dir, 'shape.json');
    fs.writeFileSync(wrongShape, JSON.stringify({ savedAt: 'x' }));
    assert.equal(loadCheckpoint(wrongShape), null);
  });

  it('round-trips rejections through save, load, and merge', () => {
    const rejection: CheckpointRejection = {
      repo: 'mhmugisha/anything-property-management',
      revertedSha: '54b6ba499d4d61cc81d40da4d95ae19ad4e7749d',
      reason: 'revert-of-revert-restored',
      decidedBy: 'automated-review',
      decidedAt: '2026-07-25',
      note: 'evidence commit is a revert of the revert; the agent change is live on main',
    };
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'backward-ckpt-')), 'checkpoint.json');
    const prior: BackwardCheckpoint = {
      savedAt: '2026-07-25T00:00:00Z',
      entries: [{ ...entry('a/b', '111'), firstConfirmedAt: '2026-07-16T05:00:00Z' }],
      rejections: [rejection],
    };
    saveCheckpoint(file, prior);
    const loaded = loadCheckpoint(file);
    assert.deepEqual(loaded?.rejections, [rejection]);
    const grown = mergeCheckpoint(loaded, [entry('c/d', '222')], '2026-07-26T05:00:00Z');
    assert.deepEqual(grown.rejections, [rejection]);
    assert.equal(grown.entries.length, 2);
  });

  it('the artifact corpus is the checkpoint-grown set merged over the committed one', () => {
    // The evaporation defect: committed corpus empty, checkpoint carries the
    // prior nights' confirmations, tonight confirms nothing fresh. The output
    // must still list the checkpointed entries.
    const checkpoint = mergeCheckpoint(null, [entry('a/b', '111'), entry('c/d', '222')], '2026-07-24T05:00:00Z');
    const grown = mergeCheckpoint(checkpoint, [], '2026-07-25T05:00:00Z');
    const merged = mergeCorpus({ entries: [] }, grown.entries);
    assert.equal(merged.length, 2);
  });
});

describe('mergeCorpus', () => {
  const e = (repo: string, sha: string): BackwardEntry => ({
    repo,
    revertedSha: sha,
    prNumber: 1,
    vendor: 'cursor',
    outcome: 'reverted',
    evidence: [],
    surfacedBy: 'x',
  });

  it('dedupes by repo@sha across existing and fresh entries', () => {
    const merged = mergeCorpus({ entries: [e('a/b', '111'), e('a/b', '222')] }, [e('a/b', '222'), e('c/d', '333')]);
    assert.equal(merged.length, 3);
  });

  it('handles a null existing corpus', () => {
    assert.equal(mergeCorpus(null, [e('a/b', '111')]).length, 1);
  });

  it('keeps a source-less pre-widening entry alongside labeled fresh ones', () => {
    const merged = mergeCorpus({ entries: [e('a/b', '111')] }, [{ ...e('c/d', '333'), source: 'hotfix-marker' }]);
    assert.equal(merged.length, 2);
    assert.equal(merged.find((x) => x.repo === 'a/b')!.source, undefined);
    assert.equal(merged.find((x) => x.repo === 'c/d')!.source, 'hotfix-marker');
  });

  it('a committed entry keeps its review annotations over a fresh re-confirmation', () => {
    const labeled: BackwardEntry = {
      ...e('kayan2004/ground-trip', '21cad8d'),
      outcomeLabel: 'reverted-motive-ambiguous',
      incidentId: 'kayan2004-ground-trip-edbcac71',
    };
    const merged = mergeCorpus({ entries: [labeled] }, [e('kayan2004/ground-trip', '21cad8d')]);
    assert.equal(merged.length, 1);
    assert.equal(merged[0]!.outcomeLabel, 'reverted-motive-ambiguous');
    assert.equal(merged[0]!.incidentId, 'kayan2004-ground-trip-edbcac71');
  });
});

describe('splitClaimable', () => {
  const e = (sha: string, outcomeLabel?: 'reverted-motive-ambiguous'): BackwardEntry => ({
    repo: 'kayan2004/ground-trip',
    revertedSha: sha,
    prNumber: null,
    vendor: 'claude-code',
    outcome: 'reverted',
    evidence: [],
    surfacedBy: 'x',
    ...(outcomeLabel !== undefined ? { outcomeLabel } : {}),
  });

  it('excludes motive-ambiguous entries from the claimable set, keeping the data', () => {
    const { claimable, motiveAmbiguous } = splitClaimable([
      e('111'),
      e('21cad8d', 'reverted-motive-ambiguous'),
      e('73b22bc', 'reverted-motive-ambiguous'),
    ]);
    assert.equal(claimable.length, 1);
    assert.equal(claimable[0]!.revertedSha, '111');
    assert.equal(motiveAmbiguous, 2);
  });

  it('claims everything when nothing is labeled', () => {
    const { claimable, motiveAmbiguous } = splitClaimable([e('111'), e('222')]);
    assert.equal(claimable.length, 2);
    assert.equal(motiveAmbiguous, 0);
  });
});
