import { strict as assert } from 'assert';
import {
  DEFAULT_DETECTORS,
  EXPERIMENTAL_DETECTORS,
  parseDetectorSet,
  resolveDetectors,
} from '../../../src/audit/cheat-detector/detector-sets';

describe('cheat-detector / detector-sets', () => {
  it('default set is the seven detectors with real-world signal', () => {
    const names = DEFAULT_DETECTORS.map((d) => d.name).sort();
    assert.deepEqual(names, [
      'assertion-strip',
      'coverage-erosion',
      'error-swallow',
      'fake-refactor',
      'mock-of-hallucination',
      'no-op-fix',
      'test-relaxation',
    ].sort());
  });

  it('experimental set holds the three detectors with no real-world signal yet', () => {
    const names = EXPERIMENTAL_DETECTORS.map((d) => d.name).sort();
    assert.deepEqual(names, [
      'comment-only-fix',
      'dead-branch-insertion',
      'exception-rethrow-lost-context',
    ].sort());
  });

  it('default and experimental are disjoint', () => {
    const defNames = new Set(DEFAULT_DETECTORS.map((d) => d.name));
    for (const d of EXPERIMENTAL_DETECTORS) {
      assert.ok(!defNames.has(d.name), `${d.name} appears in both sets`);
    }
  });

  it('resolveDetectors("default") returns the seven default detectors', () => {
    const out = resolveDetectors('default');
    assert.equal(out.length, 7);
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
