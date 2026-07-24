import { strict as assert } from 'assert';
import {
  VENDOR_QUERIES,
  THIN_REVIEW_QUERIES,
  THIN_REVIEW_QUALIFIERS,
  isDependencyBot,
  buildContextFeatures,
  confirmsThinReview,
  interleaveArms,
} from '../../../scripts/real-prs/fetch-agent-prs';
import { countFromLinkHeader } from '../../../scripts/real-prs/lib/github';
import { tally, type AuditFunnel } from '../../../scripts/real-prs/capability-hunt-backfill';
import type {
  AgentSourcePr,
  FetchArm,
  PrContextFeatures,
} from '../../../scripts/real-prs/lib/agent-types';

function features(overrides: Partial<PrContextFeatures> = {}): PrContextFeatures {
  return {
    repoStars: 12,
    contributorCount: 3,
    reviewCount: 0,
    reviewCommentCount: 0,
    openToMergeHours: 1.5,
    mergedByAuthor: true,
    ...overrides,
  };
}

function sourcePr(repo: string, prNumber: number, arm: FetchArm): AgentSourcePr {
  return {
    repo,
    prNumber,
    headSha: 'a'.repeat(40),
    title: 'fix: something',
    bodyExcerpt: '',
    url: `https://github.com/${repo}/pull/${prNumber}`,
    mergedAt: '2026-07-01T00:00:00Z',
    additions: 20,
    deletions: 5,
    files: 2,
    diffPath: `diffs/${repo.replace('/', '-')}/${prNumber}.diff`,
    agent: { vendor: 'claude-code', confidence: 'high', source: 'body-marker' },
    searchVendor: 'claude-code',
    arm,
    context: features(),
  };
}

describe('scripts/real-prs/fetch-agent-prs thin-review arm', () => {
  it('derives one thin-review query per vendor with the thinness qualifiers appended', () => {
    assert.equal(THIN_REVIEW_QUERIES.length, VENDOR_QUERIES.length);
    for (let i = 0; i < VENDOR_QUERIES.length; i += 1) {
      const control = VENDOR_QUERIES[i]!;
      const thin = THIN_REVIEW_QUERIES[i]!;
      assert.equal(thin.vendor, control.vendor);
      assert.equal(thin.q, `${control.q} ${THIN_REVIEW_QUALIFIERS}`);
    }
  });

  it('keeps the control queries free of review-thinness qualifiers', () => {
    for (const { q } of VENDOR_QUERIES) {
      assert.ok(!q.includes('review:'), `control query carries a review qualifier: ${q}`);
      assert.ok(!q.includes('comments:'), `control query carries a comments qualifier: ${q}`);
    }
  });

  it('excludes dependency-bot authors with and without the [bot] suffix', () => {
    assert.equal(isDependencyBot('dependabot[bot]'), true);
    assert.equal(isDependencyBot('renovate[bot]'), true);
    assert.equal(isDependencyBot('renovate'), true);
    assert.equal(isDependencyBot('snyk-bot'), true);
    assert.equal(isDependencyBot('scala-steward'), true);
  });

  it('does not exclude agent bots or human authors as dependency bots', () => {
    assert.equal(isDependencyBot('devin-ai-integration[bot]'), false);
    assert.equal(isDependencyBot('copilot-swe-agent[bot]'), false);
    assert.equal(isDependencyBot('openhands-agent[bot]'), false);
    assert.equal(isDependencyBot('bradkinnard'), false);
  });
});

describe('scripts/real-prs/fetch-agent-prs buildContextFeatures', () => {
  it('computes open-to-merge hours from the created and merged timestamps', () => {
    const ctx = buildContextFeatures({
      repoStars: 5,
      contributorCount: 2,
      reviewCount: 1,
      reviewCommentCount: 4,
      createdAt: '2026-07-01T00:00:00Z',
      mergedAt: '2026-07-01T06:30:00Z',
      mergedByLogin: 'maintainer',
      authorLogin: 'agent-user',
    });
    assert.equal(ctx.openToMergeHours, 6.5);
    assert.equal(ctx.mergedByAuthor, false);
  });

  it('compares merging login to author case-insensitively', () => {
    const ctx = buildContextFeatures({
      repoStars: 0,
      contributorCount: null,
      reviewCount: 0,
      reviewCommentCount: 0,
      createdAt: '2026-07-01T00:00:00Z',
      mergedAt: '2026-07-01T01:00:00Z',
      mergedByLogin: 'SomeUser',
      authorLogin: 'someuser',
    });
    assert.equal(ctx.mergedByAuthor, true);
  });

  it('returns null duration and merged-by when the source fields are missing', () => {
    const ctx = buildContextFeatures({
      repoStars: 0,
      contributorCount: null,
      reviewCount: null,
      reviewCommentCount: 0,
      createdAt: '2026-07-01T00:00:00Z',
      mergedAt: null,
      mergedByLogin: null,
      authorLogin: 'someone',
    });
    assert.equal(ctx.openToMergeHours, null);
    assert.equal(ctx.mergedByAuthor, null);
  });
});

describe('scripts/real-prs/fetch-agent-prs confirmsThinReview', () => {
  it('confirms only zero reviews, zero review comments, and an author merge', () => {
    assert.equal(confirmsThinReview(features()), true);
    assert.equal(confirmsThinReview(features({ reviewCount: 1 })), false);
    assert.equal(confirmsThinReview(features({ reviewCommentCount: 2 })), false);
    assert.equal(confirmsThinReview(features({ mergedByAuthor: false })), false);
  });

  it('rejects when the review count or merged-by could not be fetched', () => {
    assert.equal(confirmsThinReview(features({ reviewCount: null })), false);
    assert.equal(confirmsThinReview(features({ mergedByAuthor: null })), false);
  });
});

describe('scripts/real-prs/fetch-agent-prs interleaveArms', () => {
  it('alternates the two arms so any contiguous slice samples both', () => {
    const control = [sourcePr('a/x', 1, 'per-vendor-control'), sourcePr('a/x', 2, 'per-vendor-control')];
    const thin = [sourcePr('b/y', 3, 'thin-review'), sourcePr('b/y', 4, 'thin-review')];
    const arms = interleaveArms(control, thin).map((p) => p.arm);
    assert.deepEqual(arms, ['per-vendor-control', 'thin-review', 'per-vendor-control', 'thin-review']);
  });

  it('appends the longer arm without losing entries', () => {
    const control = [sourcePr('a/x', 1, 'per-vendor-control')];
    const thin = [
      sourcePr('b/y', 2, 'thin-review'),
      sourcePr('b/y', 3, 'thin-review'),
      sourcePr('b/y', 4, 'thin-review'),
    ];
    const merged = interleaveArms(control, thin);
    assert.equal(merged.length, 4);
    assert.deepEqual(
      merged.map((p) => p.prNumber),
      [1, 2, 3, 4],
    );
  });
});

describe('scripts/real-prs/lib/github countFromLinkHeader', () => {
  it('reads the total from the rel=last page number at per_page=1', () => {
    const link =
      '<https://api.github.com/repositories/1/contributors?per_page=1&page=2>; rel="next", ' +
      '<https://api.github.com/repositories/1/contributors?per_page=1&page=57>; rel="last"';
    assert.equal(countFromLinkHeader(link, 1), 57);
  });

  it('falls back to the first page length when there is no Link header', () => {
    assert.equal(countFromLinkHeader(undefined, 1), 1);
    assert.equal(countFromLinkHeader(undefined, 0), 0);
  });
});

describe('scripts/real-prs/capability-hunt-backfill tally arm labels', () => {
  function funnel(overrides: Partial<AuditFunnel>): AuditFunnel {
    return {
      ref: 'a/x#1',
      agent: 'claude-code',
      status: 'audited',
      pass: true,
      gateTriggers: [],
      advisoryFindings: [],
      provisioning: null,
      enginesApplicable: 0,
      enginesExecuted: 0,
      disputed: 0,
      abstainVerdicts: [],
      elapsedMs: 100,
      ...overrides,
    };
  }

  it('counts audited PRs per fetch arm, with unlabeled records under their own key', () => {
    const metrics = tally(
      [
        funnel({ ref: 'a/x#1', arm: 'per-vendor-control' }),
        funnel({ ref: 'a/x#2', arm: 'thin-review' }),
        funnel({ ref: 'a/x#3', arm: 'thin-review' }),
        funnel({ ref: 'a/x#4' }),
      ],
      { batchId: 'b', population: 'pop.json', offset: 0, batchSize: 4 },
      0,
    );
    assert.deepEqual(metrics.arms, {
      'per-vendor-control': 1,
      'thin-review': 2,
      unlabeled: 1,
    });
  });
});
