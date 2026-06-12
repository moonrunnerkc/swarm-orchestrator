import { strict as assert } from 'assert';
import {
  revertCandidatesFromItem,
  attributeAndConfirm,
  mineBackward,
  mergeCorpus,
  type BackwardOctokit,
  type BackwardEntry,
} from '../../scripts/real-prs/mine-backward';

// A reverted agent commit. The discovery search surfaces the revert commit; the
// confirm search (findOutcomeEvidence) sees the same revert, so a mined entry
// must carry the revert commit sha as its canonical evidence. This is the
// deterministic stand-in for the live spot-check: every mined entry's evidence
// is asserted against the revert that surfaced it.
const REVERTED_SHA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const REVERT_SHA = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const REPO = 'acme/widgets';

interface MockOpts {
  /** head ref of the associated PR, drives agent attribution. */
  headRef?: string;
  /** when false, listPullRequestsAssociatedWithCommit returns []. */
  hasPr?: boolean;
  /** when true, the confirm search returns no revert (outcome survived). */
  noRevertOnConfirm?: boolean;
}

function makeOctokit(opts: MockOpts = {}): { octokit: BackwardOctokit; calls: () => number } {
  let calls = 0;
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
    search: {
      commits: async (p: { q: string }) => {
        calls += 1;
        const isConfirm = p.q.startsWith('repo:');
        if (isConfirm) {
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
        // discovery query
        return {
          data: {
            items: [
              {
                sha: REVERT_SHA,
                commit: { message: `Revert "feat"\n\nThis reverts commit ${REVERTED_SHA}.` },
                repository: { full_name: REPO },
              },
            ],
          },
        };
      },
    },
  } as unknown as BackwardOctokit;
  return { octokit, calls: () => calls };
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
  });

  it('returns [] when the search item has no repository', () => {
    assert.deepEqual(
      revertCandidatesFromItem({ sha: REVERT_SHA, commit: { message: 'Revert\n\nThis reverts commit deadbeef.' }, repository: null }),
      [],
    );
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
    assert.ok(result.entries[0]!.evidence.some((e) => e.ref === REVERT_SHA));
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

  it('dedupes by repo@sha, fresh overrides existing', () => {
    const merged = mergeCorpus({ entries: [e('a/b', '111'), e('a/b', '222')] }, [e('a/b', '222'), e('c/d', '333')]);
    assert.equal(merged.length, 3);
  });

  it('handles a null existing corpus', () => {
    assert.equal(mergeCorpus(null, [e('a/b', '111')]).length, 1);
  });
});
