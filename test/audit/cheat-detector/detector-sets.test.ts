import { strict as assert } from 'assert';
import {
  DEFAULT_DETECTORS,
  EXPERIMENTAL_DETECTORS,
  parseDetectorSet,
  resolveDetectors,
} from '../../../src/audit/cheat-detector/detector-sets';

describe('cheat-detector / detector-sets (v10.2-advisory)', () => {
  it('default set is exactly the four advisory-grade detectors', () => {
    const names = DEFAULT_DETECTORS.map((d) => d.name).sort();
    assert.deepEqual(names, [
      'error-swallow',
      'fake-refactor',
      'mock-of-hallucination',
      'no-op-fix',
    ].sort());
  });

  it('experimental set holds the six retired detectors', () => {
    const names = EXPERIMENTAL_DETECTORS.map((d) => d.name).sort();
    assert.deepEqual(names, [
      'assertion-strip',
      'comment-only-fix',
      'coverage-erosion',
      'dead-branch-insertion',
      'exception-rethrow-lost-context',
      'test-relaxation',
    ].sort());
  });

  it('default and experimental are disjoint', () => {
    const defNames = new Set(DEFAULT_DETECTORS.map((d) => d.name));
    for (const d of EXPERIMENTAL_DETECTORS) {
      assert.ok(!defNames.has(d.name), `${d.name} appears in both sets`);
    }
  });

  it('resolveDetectors("default") returns the default four', () => {
    const out = resolveDetectors('default');
    assert.equal(out.length, 4);
  });

  it('resolveDetectors("experimental") returns all ten', () => {
    const out = resolveDetectors('experimental');
    assert.equal(out.length, 10);
  });

  it('resolveDetectors("all") is an alias for experimental', () => {
    const a = resolveDetectors('all').map((d) => d.name).sort();
    const b = resolveDetectors('experimental').map((d) => d.name).sort();
    assert.deepEqual(a, b);
  });

  it('parseDetectorSet maps recognized strings', () => {
    assert.equal(parseDetectorSet('default'), 'default');
    assert.equal(parseDetectorSet('experimental'), 'experimental');
    assert.equal(parseDetectorSet('all'), 'all');
  });

  it('parseDetectorSet(undefined) defaults to "default"', () => {
    assert.equal(parseDetectorSet(undefined), 'default');
  });

  it('parseDetectorSet throws on a bad value', () => {
    assert.throws(() => parseDetectorSet('full'), /invalid --detectors/);
  });
});
