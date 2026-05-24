import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { compute, computePairKappa } from '../../../scripts/labeling/compute-kappa';

function makeRaterDir(root: string, raterId: string, rows: ReadonlyArray<{ id: string; verdict: 'clean' | 'broken' | 'ambiguous' }>): void {
  const dir = path.join(root, raterId);
  fs.mkdirSync(dir, { recursive: true });
  const lines = rows.map((r) => JSON.stringify({
    id: r.id,
    raterId,
    verdict: r.verdict,
    confidence: 'high' as const,
  }));
  fs.writeFileSync(path.join(dir, 'labels.jsonl'), lines.join('\n') + '\n');
}

describe('scripts/labeling/compute-kappa', () => {
  it('computePairKappa returns 1.0 on perfect agreement', () => {
    const a = new Map([['p1', true], ['p2', true], ['p3', false], ['p4', false]]);
    const b = new Map([['p1', true], ['p2', true], ['p3', false], ['p4', false]]);
    const out = computePairKappa(a, b);
    assert.equal(out.comparisons, 4);
    assert.equal(out.kappa, 1);
  });

  it('computePairKappa returns ~0 on chance agreement', () => {
    // Both raters mark exactly half broken, with overlap matching chance.
    const a = new Map([['p1', true], ['p2', false], ['p3', true], ['p4', false]]);
    const b = new Map([['p1', true], ['p2', true], ['p3', false], ['p4', false]]);
    const out = computePairKappa(a, b);
    assert.equal(out.comparisons, 4);
    assert.ok(out.kappa !== null);
    assert.ok(Math.abs(out.kappa!) < 0.1, `expected near zero, got ${out.kappa}`);
  });

  it('computePairKappa is negative when raters disagree systematically', () => {
    const a = new Map([['p1', true], ['p2', true], ['p3', false], ['p4', false]]);
    const b = new Map([['p1', false], ['p2', false], ['p3', true], ['p4', true]]);
    const out = computePairKappa(a, b);
    assert.ok(out.kappa !== null && out.kappa < 0);
  });

  it('compute discovers raters under <labelsDir>/rater-NNN/labels.jsonl', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-kappa-'));
    makeRaterDir(root, 'rater-001', [
      { id: 'pr-1', verdict: 'broken' },
      { id: 'pr-2', verdict: 'clean' },
      { id: 'pr-3', verdict: 'broken' },
    ]);
    makeRaterDir(root, 'rater-002', [
      { id: 'pr-1', verdict: 'broken' },
      { id: 'pr-2', verdict: 'clean' },
      { id: 'pr-3', verdict: 'broken' },
    ]);
    const out = compute({ labelsDir: root, threshold: 0.6 });
    assert.deepEqual(out.ratersIncluded, ['rater-001', 'rater-002']);
    assert.equal(out.pairs.length, 1);
    assert.equal(out.pairs[0]!.comparisons, 3);
    assert.equal(out.pairs[0]!.kappa, 1);
    assert.equal(out.passesGate, true);
  });

  it('compute reports passesGate=false when the minimum pair falls below threshold', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-kappa-'));
    makeRaterDir(root, 'rater-001', [
      { id: 'pr-1', verdict: 'broken' },
      { id: 'pr-2', verdict: 'clean' },
      { id: 'pr-3', verdict: 'broken' },
      { id: 'pr-4', verdict: 'clean' },
    ]);
    makeRaterDir(root, 'rater-002', [
      { id: 'pr-1', verdict: 'clean' },
      { id: 'pr-2', verdict: 'broken' },
      { id: 'pr-3', verdict: 'clean' },
      { id: 'pr-4', verdict: 'broken' },
    ]);
    const out = compute({ labelsDir: root, threshold: 0.6 });
    assert.equal(out.passesGate, false);
  });

  it('compute handles an empty labelsDir gracefully', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-kappa-empty-'));
    const out = compute({ labelsDir: root, threshold: 0.6 });
    assert.equal(out.ratersIncluded.length, 0);
    assert.equal(out.pairs.length, 0);
    assert.equal(out.minimumKappa, null);
    assert.equal(out.passesGate, null);
  });

  it('ambiguous verdicts collapse to "not broken" on the binary projection', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-kappa-amb-'));
    makeRaterDir(root, 'rater-001', [
      { id: 'pr-1', verdict: 'ambiguous' },
      { id: 'pr-2', verdict: 'broken' },
    ]);
    makeRaterDir(root, 'rater-002', [
      { id: 'pr-1', verdict: 'clean' }, // both raters non-broken on pr-1 → agreement
      { id: 'pr-2', verdict: 'broken' },
    ]);
    const out = compute({ labelsDir: root, threshold: 0.6 });
    assert.equal(out.pairs[0]!.agreements, 2);
  });
});
