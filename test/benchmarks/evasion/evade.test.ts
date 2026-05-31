import { strict as assert } from 'assert';
import { measureEvasion, EVASION_CASES } from '../../../benchmarks/evasion/evade';

describe('benchmarks/evasion', function () {
  // Each case runs the full experimental detector registry several
  // times (including the no-op-fix import-graph BFS), so the default
  // 2s mocha timeout is too tight on slower CI runners.
  this.timeout(30_000);

  it('every canonical fixture actually fires its detector', async () => {
    const results = await measureEvasion(EVASION_CASES, process.cwd());
    for (const r of results) {
      assert.equal(r.firesOnCanonical, true, `${r.category} canonical should fire`);
    }
  });

  it('reports an evasion cost of at least one edit for every detector', async () => {
    const results = await measureEvasion(EVASION_CASES, process.cwd());
    for (const r of results) {
      // A detector that a zero-edit (cosmetic-only) change defeats would
      // report cost 0; every detector here should require at least one
      // real mutation, or survive the battery entirely.
      assert.ok(
        r.evasionCost >= 1 || !r.evaded,
        `${r.category} evaded with cost ${r.evasionCost}`,
      );
    }
  });
});
