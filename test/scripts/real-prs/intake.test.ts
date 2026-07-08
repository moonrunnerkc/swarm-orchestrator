import { strict as assert } from 'node:assert';
import {
  buildFoldedDataset,
  buildIntakeRecord,
  canonicalEvidenceSha,
  intakeToWildCheatEntry,
  nextVersion,
  renderReviewMarkdown,
  reviewBucketOf,
  summarizeReview,
  type MinedCandidate,
} from '../../../scripts/real-prs/lib/intake';
import type { ViabilityRecord } from '../../../scripts/real-prs/eg-viability-screen';
import type { WildCheatEntry } from '../../../scripts/real-prs/lib/wild-cheat-corpus';

function candidate(over: Partial<MinedCandidate> = {}): MinedCandidate {
  return {
    id: 'owner-repo-pr7',
    repo: 'owner/repo',
    prNumber: 7,
    url: 'https://github.com/owner/repo/pull/7',
    vendor: 'claude-code',
    vendorConfidence: 'high',
    vendorSource: 'commit-trailer',
    complaintCategory: 'no-op-fix',
    complaints: [{ category: 'no-op-fix', phrase: 'this does not actually fix', source: 'issue-comment' }],
    arbiter: {
      mode: 'dual',
      primary: { model: 'a', verdict: 'true-cheat', confidence: 0.9 },
      secondary: { model: 'b', verdict: 'true-cheat', confidence: 0.8 },
      agreed: true,
      confirmed: true,
    },
    ...over,
  };
}

const VIABLE: ViabilityRecord = {
  id: 'owner-repo-pr7',
  repo: 'owner/repo',
  headSha: 'a'.repeat(40),
  outcome: 'unknown',
  ecosystem: 'node',
  hasPackageJson: true,
  hasLockfile: true,
  lockfile: 'package-lock.json',
  testRunner: 'mocha',
  nodeEngine: null,
  nodeSatisfiable: true,
  viable: true,
  reason: 'viable: Node + lockfile + runner + node engine OK',
};

describe('canonicalEvidenceSha', () => {
  it('is deterministic for the same fields', () => {
    const fields = {
      repo: 'owner/repo',
      prNumber: 7,
      headSha: 'a'.repeat(40),
      baseSha: 'b'.repeat(40),
      complaintCategory: 'no-op-fix',
      complaints: candidate().complaints,
    };
    assert.equal(canonicalEvidenceSha(fields), canonicalEvidenceSha(fields));
  });

  it('changes when the head sha changes', () => {
    const base = {
      repo: 'owner/repo',
      prNumber: 7,
      headSha: 'a'.repeat(40),
      baseSha: 'b'.repeat(40),
      complaintCategory: 'no-op-fix',
      complaints: candidate().complaints,
    };
    assert.notEqual(canonicalEvidenceSha(base), canonicalEvidenceSha({ ...base, headSha: 'c'.repeat(40) }));
  });
});

describe('reviewBucketOf', () => {
  it('routes confirmed, split, off, and cleared arbiter blocks', () => {
    assert.equal(reviewBucketOf({ mode: 'dual', agreed: true, confirmed: true }), 'arbiter-confirmed');
    assert.equal(reviewBucketOf({ mode: 'dual', agreed: false, confirmed: null }), 'arbiter-split');
    assert.equal(reviewBucketOf({ mode: 'off', confirmed: null }), 'arbiter-unevaluable');
    assert.equal(reviewBucketOf({ mode: 'dual', agreed: true, confirmed: false }), 'arbiter-not-cheat');
  });
});

describe('buildIntakeRecord', () => {
  it('carries the evidence id, viability, and holdout flag', () => {
    const record = buildIntakeRecord(
      candidate(),
      'closed',
      { headSha: 'a'.repeat(40), baseSha: 'b'.repeat(40) },
      VIABLE,
    );
    assert.equal(record.egViable, true);
    assert.equal(record.holdout, true);
    assert.equal(record.reviewBucket, 'arbiter-confirmed');
    assert.equal(record.state, 'closed');
    assert.equal(record.evidenceSha256.length, 64);
  });
});

describe('summarizeReview', () => {
  it('counts by triage bucket and viability', () => {
    const mk = (arb: MinedCandidate['arbiter']): ReturnType<typeof buildIntakeRecord> =>
      buildIntakeRecord(candidate({ arbiter: arb }), 'closed', { headSha: 'a'.repeat(40), baseSha: 'b'.repeat(40) }, VIABLE);
    const records = [
      mk({ mode: 'dual', agreed: true, confirmed: true }),
      mk({ mode: 'dual', agreed: false, confirmed: null }),
      mk({ mode: 'dual', agreed: true, confirmed: false }),
    ];
    const counts = summarizeReview(records);
    assert.equal(counts.total, 3);
    assert.equal(counts.arbiterConfirmed, 1);
    assert.equal(counts.arbiterSplit, 1);
    assert.equal(counts.arbiterNotCheat, 1);
    assert.equal(counts.egViable, 3);
  });
});

describe('renderReviewMarkdown', () => {
  it('leads with the fold command, the complaint quote, and both arbiter verdicts', () => {
    const record = buildIntakeRecord(candidate(), 'closed', { headSha: 'a'.repeat(40), baseSha: 'b'.repeat(40) }, VIABLE);
    const md = renderReviewMarkdown(
      {
        generatedBy: 'x',
        minedFrom: 'y',
        funnel: { examined: 100 },
        counts: summarizeReview([record]),
        records: [record],
      },
      'node fold --approved-ids <id>',
    );
    assert.match(md, /node fold --approved-ids <id>/);
    assert.match(md, /this does not actually fix/);
    assert.match(md, /arbiter: CONFIRMED cheat/);
    assert.match(md, /owner\/repo\/pull\/7/);
  });
});

describe('nextVersion', () => {
  it('bumps the highest present version', () => {
    assert.equal(nextVersion(['v1']), 'v2');
    assert.equal(nextVersion(['v1', 'v2', 'v3']), 'v4');
    assert.equal(nextVersion([]), 'v1');
  });
});

describe('buildFoldedDataset', () => {
  const existing: WildCheatEntry[] = [
    {
      id: 'old-1',
      repo: 'o/r',
      prNumber: 1,
      url: 'u',
      state: 'closed',
      vendor: 'claude-code',
      vendorConfidence: 'high',
      headSha: 'h',
      baseSha: 'b',
      complaintCategory: 'no-op-fix',
      complaints: [],
      outcome: 'unknown',
      egViable: false,
      crossTaxonomy: 'x',
      holdout: true,
    },
  ];

  it('appends approved entries and recomputes counts', () => {
    const approved = [intakeToWildCheatEntry(buildIntakeRecord(candidate({ id: 'new-1' }), 'merged', { headSha: 'a'.repeat(40), baseSha: 'b'.repeat(40) }, VIABLE))];
    const folded = buildFoldedDataset(existing, approved, 'v2');
    assert.equal(folded.version, 'v2');
    assert.equal(folded.entries.length, 2);
    assert.equal(folded.counts.entries, 2);
    assert.equal(folded.counts.merged, 1);
    assert.equal(folded.counts.egViable, 1);
    assert.equal(folded.counts.foldedThisVersion, 1);
  });

  it('drops an approved entry whose id already exists', () => {
    const approved = [intakeToWildCheatEntry(buildIntakeRecord(candidate({ id: 'old-1' }), 'merged', { headSha: 'a'.repeat(40), baseSha: 'b'.repeat(40) }, VIABLE))];
    const folded = buildFoldedDataset(existing, approved, 'v2');
    assert.equal(folded.entries.length, 1);
    assert.equal(folded.counts.foldedThisVersion, 0);
  });
});
