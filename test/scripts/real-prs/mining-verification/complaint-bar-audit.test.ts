import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { auditPr, stampDataset } from '../../../../scripts/real-prs/mining-verification/complaint-bar-audit';

function e(author: string, body: string, authorType?: string) {
  return { source: 'issue-comment', author, authorType, body };
}

describe('complaint-bar-audit auditPr', () => {
  it('assigns the strict bar when a non-author human carries a cheat phrase', () => {
    const r = auditPr('r-1', 'org/proj', 1, 'agentauthor', [e('maintainer', 'this no longer asserts')]);
    assert.equal(r.complaintBar, 'strict');
    assert.deepEqual(r.humanComplainants, ['maintainer']);
    assert.equal(r.solo, false);
  });

  it('keeps the strict bar even on a solo repo when a human also complained', () => {
    const r = auditPr('r-2', 'owner/proj', 2, 'owner', [
      e('owner', 'this is a no-op'),
      e('outsider', 'this no longer asserts'),
    ]);
    assert.equal(r.complaintBar, 'strict');
    assert.equal(r.solo, true);
  });

  it('marks a solo-maintainer self-flag as legacy, not strict', () => {
    const r = auditPr('r-3', 'owner/proj', 3, 'owner', [e('owner', 'this is a no-op')]);
    assert.equal(r.complaintBar, 'legacy');
    assert.equal(r.solo, true);
    assert.match(r.barNote, /solo-maintainer self-flag/);
  });

  it('marks a non-owner contributor self-comment as legacy self-only', () => {
    const r = auditPr('r-4', 'bigorg/proj', 4, 'contributor', [e('contributor', 'this is a no-op')]);
    assert.equal(r.complaintBar, 'legacy');
    assert.equal(r.solo, false);
    assert.match(r.barNote, /self-only/);
  });

  it('marks a bot-only complaint as legacy', () => {
    const r = auditPr('r-5', 'org/proj', 5, 'agentauthor', [e('Copilot', 'this no longer asserts the count')]);
    assert.equal(r.complaintBar, 'legacy');
    assert.match(r.barNote, /bot-only/);
  });

  it('recognizes a bot as the PR author (self-comment is a bot comment)', () => {
    const r = auditPr('r-6', 'org/proj', 6, 'Copilot', [e('Copilot', 'this no longer asserts')]);
    assert.equal(r.complaintBar, 'legacy');
    assert.match(r.barNote, /bot-self/);
  });

  it('marks an entry the live thread cannot settle as uncertain', () => {
    const r = auditPr('r-7', 'org/proj', 7, 'agentauthor', [e('maintainer', 'please rebase onto main')]);
    assert.equal(r.complaintBar, 'uncertain');
    assert.match(r.barNote, /no cheat-phrase complaint/);
  });
});

describe('complaint-bar-audit stampDataset', () => {
  it('carries prior entries byte-identical and adds only the stratification fields', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bar-stamp-'));
    const priorPath = path.join(dir, 'v2.json');
    const outPath = path.join(dir, 'v3.json');
    const priorEntry = { id: 'x', repo: 'org/proj', prNumber: 1, headSha: 'abc', complaintCategory: 'no-op-fix' };
    fs.writeFileSync(priorPath, JSON.stringify({ version: 'v2', entries: [priorEntry] }));
    const audit = [auditPr('x', 'org/proj', 1, 'author', [e('maintainer', 'this no longer asserts')])];
    stampDataset(priorPath, outPath, 'v3', audit);
    const v3 = JSON.parse(fs.readFileSync(outPath, 'utf8')) as {
      version: string;
      strata: { strict: number };
      entries: Array<Record<string, unknown>>;
    };
    const stamped = v3.entries[0]!;
    // every prior key preserved, unchanged
    for (const [k, v] of Object.entries(priorEntry)) assert.deepEqual(stamped[k], v);
    assert.equal(stamped.complaintBar, 'strict');
    assert.equal(v3.version, 'v3');
    assert.equal(v3.strata.strict, 1);
  });

  it('throws when a corpus entry has no matching audit record', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bar-stamp-'));
    const priorPath = path.join(dir, 'v2.json');
    fs.writeFileSync(priorPath, JSON.stringify({ version: 'v2', entries: [{ repo: 'org/unaudited', prNumber: 9 }] }));
    assert.throws(() => stampDataset(priorPath, path.join(dir, 'v3.json'), 'v3', []), /no complaint-bar audit/);
  });
});
