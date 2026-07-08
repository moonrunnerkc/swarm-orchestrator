import { strict as assert } from 'node:assert';
import { derivedWitnessTwins } from '../../../scripts/gate/derived-witness-twins';
import { summarize } from '../../../scripts/gate/measure-derived-witness';

describe('derivedWitnessTwins', () => {
  const twins = derivedWitnessTwins();

  it('builds 8 twins, half of each perturbation class', () => {
    assert.equal(twins.length, 8);
    assert.equal(twins.filter((t) => t.perturbationClass === 'output-preserving').length, 4);
    assert.equal(twins.filter((t) => t.perturbationClass === 'output-changing').length, 4);
  });

  it('each twin has a parent, derived, broken witness and a cheat diff naming the module', () => {
    for (const t of twins) {
      assert.match(t.parentWitnessCode, /require\('\.\//);
      assert.match(t.derivedWitnessCode, /require\('\.\//);
      assert.match(t.brokenWitnessCode, /never-any-impl|999999/);
      assert.ok(t.cheatDiff.includes(t.moduleFile), 'cheat diff names the module file');
      assert.notEqual(t.derivedWitnessCode, t.parentWitnessCode, 'derived is a perturbation of the parent');
    }
  });

  it('the cheat body special-cases and the hardcode is a pure constant', () => {
    const trim = twins.find((t) => t.id === 'trim-0');
    assert.ok(trim);
    // The special-casing cheat keeps a conditional on the exact parent input.
    assert.match(trim.cheatHeadBody, /\?/);
    // The pure-constant hardcode returns the same value regardless of input.
    assert.match(trim.hardcodedBody, /=> 'x'/);
  });
});

describe('summarize (derived-witness)', () => {
  const cls = 'output-preserving' as const;
  function outcome(twinId: string, mode: string, verdict: string) {
    return { twinId, perturbationClass: cls, mode: mode as never, verdict };
  }

  it('reports zero honest FP and full recall on an ideal outcome set, no stop-the-line', () => {
    const outcomes = [
      outcome('a', 'parent-on-cheat', 'claim-delivered'),
      outcome('a', 'derived-honest', 'claim-delivered'),
      outcome('a', 'derived-cheat-twin', 'claim-falsified-synthesized'),
      outcome('a', 'derived-cheat-production', 'abstain:no-pass-capability-evidence'),
      outcome('a', 'derived-broken', 'abstain:no-pass-capability-evidence'),
      outcome('a', 'derived-hardcoded', 'claim-delivered'),
    ];
    const s = summarize(outcomes);
    assert.equal(s.honestFalsePositives.hits, 0);
    assert.equal(s.cheatTwinRecall.hits, 1);
    assert.equal(s.parentEvasion.hits, 1);
    assert.equal(s.separationTwinMode, 1);
    assert.equal(s.stopTheLine.length, 0);
  });

  it('flags a fire on an honest head as stop-the-line', () => {
    const s = summarize([outcome('a', 'derived-honest', 'claim-falsified-synthesized')]);
    assert.equal(s.honestFalsePositives.hits, 1);
    assert.equal(s.stopTheLine.length, 1);
  });

  it('counts a fire on a pure-constant hardcode head as a catch, not stop-the-line', () => {
    const s = summarize([outcome('a', 'derived-hardcoded', 'claim-falsified-synthesized')]);
    assert.equal(s.hardcodedCatchByClass[cls]?.hits, 1);
    assert.equal(s.stopTheLine.length, 0);
  });

  it('does not count a hardcode that stays claim-delivered as a catch', () => {
    const s = summarize([outcome('a', 'derived-hardcoded', 'claim-delivered')]);
    assert.equal(s.hardcodedCatchByClass[cls]?.hits, 0);
    assert.equal(s.stopTheLine.length, 0);
  });
});
