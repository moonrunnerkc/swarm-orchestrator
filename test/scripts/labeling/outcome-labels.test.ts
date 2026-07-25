import { strict as assert } from 'assert';
import { findOutcomeEvidence, type OctokitLike } from '../../../scripts/labeling/outcome-labels';
import {
  directlyRevertedShas,
  messageDirectlyRevertsSha,
  messageRestoresSha,
  restoredShasInMessage,
} from '../../../scripts/real-prs/lib/github';

// Fixture built from the real mhmugisha/anything-property-management chain that
// produced the backward miner's false confirmation (nightly runs 29556363341 and
// 29892749070): the agent commit was reverted, the revert was reverted, and the
// change is live on main. The miner keyed on `This reverts commit <agent-sha>`
// inside the quoted `Revert "..."` title of the revert-of-revert and confirmed
// outcome-bad on a restored change.
const REPO = 'mhmugisha/anything-property-management';
const FILE = 'anything/apps/web/src/app/api/reports/payment-status/route.js';
const AGENT_SHA = '54b6ba499d4d61cc81d40da4d95ae19ad4e7749d';
const REVERT_SHA = 'aab11e8da3841dbcc31c03c640fa18aff1506c7b';
const RESTORE_SHA = '0cbe4b686efac0a9dffc75fea9db6b0b5d54d258';

const AGENT_MESSAGE =
  'fix: key payment-status monthly Paid by tenant_id to match arrears keying\n\n' +
  'Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>';
const REVERT_MESSAGE = `This reverts commit ${AGENT_SHA}.`;
const RESTORE_MESSAGE =
  `Revert "This reverts commit ${AGENT_SHA}."\n\n` + `This reverts commit ${REVERT_SHA}.`;

const LANDED_AT = '2026-07-16T17:27:40Z';
const OVERLAP_PATCH = '@@ -255,3 +255,3 @@\n-  const key = tenantName;\n+  const key = tenantId;\n   rows.push(key);';
const PR_RANGES = { [FILE]: [{ start: 255, end: 286 }] };

interface FakeCommit {
  sha: string;
  message: string;
  date: string;
  files?: { filename: string; patch?: string }[];
  statsTotal?: number;
}

const CHAIN: Record<string, FakeCommit> = {
  agent: { sha: AGENT_SHA, message: AGENT_MESSAGE, date: LANDED_AT },
  revert: {
    sha: REVERT_SHA,
    message: REVERT_MESSAGE,
    date: '2026-07-16T18:07:46Z',
    files: [{ filename: FILE, patch: OVERLAP_PATCH }],
    statsTotal: 16,
  },
  restore: {
    sha: RESTORE_SHA,
    message: RESTORE_MESSAGE,
    date: '2026-07-16T18:12:15Z',
    files: [{ filename: FILE, patch: OVERLAP_PATCH }],
    statsTotal: 16,
  },
};

/** A GitHub fake over a fixed commit set. search.commits matches the quoted
 *  phrase against message text, the way GitHub's index surfaces quoted-title
 *  trailer text (the exact trap under test). */
function fakeOctokit(commits: FakeCommit[]): OctokitLike {
  const bySha = new Map(commits.map((c) => [c.sha, c]));
  return {
    repos: {
      get: async () => ({ data: { default_branch: 'main' } }),
      getCommit: async (p: { ref: string }) => {
        const found = [...bySha.values()].find((c) => c.sha.startsWith(p.ref) || p.ref.startsWith(c.sha));
        if (found === undefined) throw Object.assign(new Error('not found'), { status: 404 });
        return {
          data: {
            sha: found.sha,
            html_url: `https://github.com/${REPO}/commit/${found.sha}`,
            commit: {
              message: found.message,
              committer: { date: found.date },
              author: { date: found.date },
            },
            stats: { total: found.statsTotal ?? 0 },
            files: found.files ?? [],
          },
        };
      },
      listCommits: async (p: { path?: string }) => ({
        data: commits
          .filter((c) => c.sha !== AGENT_SHA && (p.path === undefined || (c.files ?? []).some((f) => f.filename === p.path)))
          .map((c) => ({ sha: c.sha })),
      }),
      compareCommits: async () => ({ data: { status: 'behind' } }),
    },
    search: {
      commits: async (p: { q: string }) => {
        const phrase = /"([^"]+)"/.exec(p.q)?.[1] ?? '';
        return {
          data: {
            items: commits
              .filter((c) => phrase.length > 0 && c.message.includes(phrase))
              .map((c) => ({
                sha: c.sha,
                html_url: `https://github.com/${REPO}/commit/${c.sha}`,
                commit: { message: c.message },
              })),
          },
        };
      },
    },
  } as unknown as OctokitLike;
}

function evidenceInput(): Parameters<typeof findOutcomeEvidence>[1] {
  return {
    repo: REPO,
    headSha: AGENT_SHA,
    defaultBranch: 'main',
    landedAt: LANDED_AT,
    prRanges: PR_RANGES,
    hotfixWindowDays: 30,
  };
}

describe('revert trailer direction (pure)', () => {
  it('reads the quoted-title trailer as a restore, not a revert', () => {
    assert.equal(messageDirectlyRevertsSha(RESTORE_MESSAGE, AGENT_SHA), false);
    assert.equal(messageDirectlyRevertsSha(RESTORE_MESSAGE, REVERT_SHA), true);
    assert.equal(messageRestoresSha(RESTORE_MESSAGE, AGENT_SHA), true);
    assert.deepEqual(directlyRevertedShas(RESTORE_MESSAGE), [REVERT_SHA]);
    assert.deepEqual(restoredShasInMessage(RESTORE_MESSAGE), [AGENT_SHA]);
  });

  it('still reads a bare trailer subject as a direct revert', () => {
    assert.equal(messageDirectlyRevertsSha(REVERT_MESSAGE, AGENT_SHA), true);
    assert.deepEqual(restoredShasInMessage(REVERT_MESSAGE), []);
  });

  it('reads every trailer of a multi-commit revert as direct', () => {
    const groundTrip =
      'revert: remove multi-turn clarification loop\n\n' +
      'Reverts commits bdc7b61..74d6846, per request to remove the feature.\n\n' +
      'This reverts commit 74d6846.\nThis reverts commit 21cad8d.\nThis reverts commit a4bcfbf.';
    assert.equal(messageDirectlyRevertsSha(groundTrip, '21cad8d'), true);
    assert.deepEqual(restoredShasInMessage(groundTrip), []);
  });
});

describe('findOutcomeEvidence revert-chain resolution', () => {
  it('does not confirm outcome-bad on the real mhmugisha revert-of-revert chain', async () => {
    const res = await findOutcomeEvidence(
      fakeOctokit([CHAIN.agent!, CHAIN.revert!, CHAIN.restore!]),
      evidenceInput(),
    );
    assert.equal(res.outcome, 'survived');
    assert.deepEqual(res.evidence, []);
  });

  it('still confirms reverted when the revert stands unreverted', async () => {
    const res = await findOutcomeEvidence(fakeOctokit([CHAIN.agent!, CHAIN.revert!]), evidenceInput());
    assert.equal(res.outcome, 'reverted');
    assert.ok(res.evidence.some((e) => e.kind === 'revert-commit' && e.ref === REVERT_SHA));
  });

  it('does not admit a restore commit as a hotfix of the change it puts back', async () => {
    // Without the restore skip, the revert-of-revert re-touches the change's
    // exact lines with "Revert" in its subject and reads as a 16-line hotfix.
    const res = await findOutcomeEvidence(fakeOctokit([CHAIN.agent!, CHAIN.restore!]), evidenceInput());
    assert.equal(res.outcome, 'survived');
    assert.deepEqual(res.evidence, []);
  });

  it('still admits a genuine fix-shaped follow-up as a hotfix', async () => {
    const hotfix: FakeCommit = {
      sha: 'feedfacefeedfacefeedfacefeedfacefeedface',
      message: 'fix: correct tenant id keying for arrears rows',
      date: '2026-07-17T10:00:00Z',
      files: [{ filename: FILE, patch: OVERLAP_PATCH }],
      statsTotal: 12,
    };
    const res = await findOutcomeEvidence(fakeOctokit([CHAIN.agent!, hotfix]), evidenceInput());
    assert.equal(res.outcome, 'hotfixed');
    assert.ok(res.evidence.some((e) => e.kind === 'hotfix-commit' && e.ref === hotfix.sha));
  });

  it('fails closed (survived, scanLimited) when the chain exceeds the depth cap', async () => {
    const chain: FakeCommit[] = [CHAIN.agent!];
    let prev = AGENT_SHA;
    for (let i = 0; i < 6; i += 1) {
      const sha = `${i}`.repeat(40);
      chain.push({ sha, message: `This reverts commit ${prev}.`, date: '2026-07-17T00:00:00Z' });
      prev = sha;
    }
    const res = await findOutcomeEvidence(fakeOctokit(chain), evidenceInput());
    assert.equal(res.outcome, 'survived');
    assert.equal(res.scanLimited, true);
  });
});
