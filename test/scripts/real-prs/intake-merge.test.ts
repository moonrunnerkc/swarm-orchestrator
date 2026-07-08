import { strict as assert } from 'node:assert';
import { candidateKey, mergeMinedCandidates, type MinedFile } from '../../../scripts/real-prs/lib/intake-merge';
import type { MinedCandidate } from '../../../scripts/real-prs/lib/intake';

/** id `<repo>-<num>` -> repo `<repo>`, prNumber `<num>`, so the dedup key is repo#num. */
function cand(id: string): MinedCandidate {
  const dash = id.lastIndexOf('-');
  const repo = id.slice(0, dash);
  const prNumber = Number(id.slice(dash + 1));
  return {
    id,
    repo,
    prNumber,
    url: `https://github.com/${repo}/pull/${prNumber}`,
    vendor: 'claude-code',
    vendorConfidence: 'high',
    vendorSource: 'pr-body-marker',
    complaintCategory: 'no-op-fix',
    complaints: [{ category: 'no-op-fix', phrase: 'not a real fix', source: 'issue-comment' }],
    arbiter: { mode: 'off', confirmed: null },
  };
}

function file(funnel: Record<string, number>, ids: string[]): MinedFile {
  return { funnel, candidates: ids.map(cand) };
}

describe('mergeMinedCandidates', () => {
  it('unions candidates across files and sums funnel fields', () => {
    const r = mergeMinedCandidates(
      [file({ examined: 100 }, ['orgA-1', 'orgB-2']), file({ examined: 40 }, ['orgC-3'])],
      new Set(),
    );
    assert.deepEqual(
      r.candidates.map((c) => c.id),
      ['orgA-1', 'orgB-2', 'orgC-3'],
    );
    assert.equal(r.funnel.examined, 140);
  });

  it('drops a PR already frozen in the corpus by repo#number, not by raw id', () => {
    // Corpus id is vendor-prefixed; the key is repo#number, so it still matches.
    const r = mergeMinedCandidates([file({}, ['orgA-1', 'orgB-2'])], new Set([candidateKey('orgA', 1)]));
    assert.deepEqual(
      r.candidates.map((c) => c.id),
      ['orgB-2'],
    );
    assert.equal(r.droppedInCorpus, 1);
  });

  it('keeps the first occurrence of a duplicate PR and counts the drop', () => {
    const r = mergeMinedCandidates([file({}, ['orgA-1']), file({}, ['orgA-1', 'orgB-2'])], new Set());
    assert.deepEqual(
      r.candidates.map((c) => c.id),
      ['orgA-1', 'orgB-2'],
    );
    assert.equal(r.droppedDuplicate, 1);
  });

  it('never lets an arbiter verdict gate entry: an off-arbiter candidate still enters', () => {
    const r = mergeMinedCandidates([file({}, ['orgA-1'])], new Set());
    assert.equal(r.candidates.length, 1);
    assert.equal(r.candidates[0]?.arbiter.confirmed, null);
  });
});
