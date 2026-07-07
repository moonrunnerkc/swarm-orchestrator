import { strict as assert } from 'assert';
import { mcNemarExact, pairedSeparation } from '../../../src/audit/gate/mcnemar';

describe('mcNemarExact', () => {
  it('tallies the paired 2x2 table correctly', () => {
    const r = mcNemarExact([
      { cheat: true, honest: false },
      { cheat: true, honest: false },
      { cheat: true, honest: true },
      { cheat: false, honest: false },
      { cheat: false, honest: true },
    ]);
    assert.equal(r.cheatOnly, 2);
    assert.equal(r.honestOnly, 1);
    assert.equal(r.bothFired, 1);
    assert.equal(r.neitherFired, 1);
    assert.equal(r.discordant, 3);
  });

  it('returns p=1 with no discordant pairs (nothing to distinguish), never NaN', () => {
    const r = mcNemarExact([
      { cheat: true, honest: true },
      { cheat: false, honest: false },
    ]);
    assert.equal(r.discordant, 0);
    assert.equal(r.pValueExact, 1);
  });

  it('gives a small exact p-value when all discordant pairs favor the cheat direction', () => {
    const pairs = Array.from({ length: 6 }, () => ({ cheat: true, honest: false }));
    const r = mcNemarExact(pairs);
    // b=6, c=0 -> exact two-sided p = 2 * C(6,0) * 0.5^6 = 2/64 = 0.03125
    assert.ok(Math.abs(r.pValueExact - 0.03125) < 1e-9, `expected 0.03125, got ${r.pValueExact}`);
  });

  it('is symmetric in magnitude: an all-honest-direction set gives the same p', () => {
    const cheatDir = mcNemarExact(Array.from({ length: 5 }, () => ({ cheat: true, honest: false })));
    const honestDir = mcNemarExact(Array.from({ length: 5 }, () => ({ cheat: false, honest: true })));
    assert.ok(Math.abs(cheatDir.pValueExact - honestDir.pValueExact) < 1e-12);
  });
});

describe('pairedSeparation', () => {
  it('computes the cheat-minus-honest fire-rate difference', () => {
    const s = pairedSeparation([
      { cheat: true, honest: false },
      { cheat: true, honest: false },
      { cheat: true, honest: false },
      { cheat: false, honest: false },
    ]);
    assert.equal(s.n, 4);
    assert.equal(s.cheatFireRate, 0.75);
    assert.equal(s.honestFireRate, 0);
    assert.equal(s.separation, 0.75);
  });

  it('is zero for an empty set, never a divide-by-zero', () => {
    assert.deepEqual(pairedSeparation([]), { n: 0, cheatFireRate: 0, honestFireRate: 0, separation: 0 });
  });
});
