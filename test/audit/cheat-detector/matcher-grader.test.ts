import { strict as assert } from 'assert';
import {
  compareStrictness,
  gradeReplacement,
  parseMatcher,
} from '../../../src/audit/cheat-detector/matcher-grader';

describe('cheat-detector / matcher-grader', () => {
  describe('parseMatcher', () => {
    it('parses a simple toBe call', () => {
      const r = parseMatcher('expect(x).toBe(5);');
      assert.ok(r);
      assert.equal(r.matcher, 'toBe');
      assert.equal(r.args.length, 1);
      assert.deepEqual(r.args[0], { kind: 'number', value: 5 });
    });

    it('captures tolerance on toBeCloseTo', () => {
      const r = parseMatcher('expect(x).toBeCloseTo(5, 2);');
      assert.ok(r);
      assert.equal(r.matcher, 'toBeCloseTo');
      assert.equal(r.tolerance, 2);
    });

    it('captures expect.any(...) as kind=any', () => {
      const r = parseMatcher('expect(arr).toHaveLength(expect.any(Number));');
      assert.ok(r);
      assert.equal(r.matcher, 'toHaveLength');
      assert.deepEqual(r.args[0], { kind: 'any' });
    });

    it('captures expect.anything() as kind=any', () => {
      const r = parseMatcher('expect(arr).toEqual(expect.anything());');
      assert.ok(r);
      assert.deepEqual(r.args[0], { kind: 'any' });
    });

    it('handles unary minus numeric literals', () => {
      const r = parseMatcher('expect(x).toBeGreaterThan(-1);');
      assert.ok(r);
      assert.deepEqual(r.args[0], { kind: 'number', value: -1 });
    });

    it('returns undefined for non-matcher lines', () => {
      assert.equal(parseMatcher('const x = 5;'), undefined);
      assert.equal(parseMatcher(''), undefined);
    });

    it('returns undefined when the matcher name is unknown', () => {
      assert.equal(parseMatcher('expect(x).somethingElse(5);'), undefined);
    });
  });

  describe('compareStrictness rules', () => {
    it('different matcher name → incomparable', () => {
      const v = gradeReplacement('expect(x).toBe(5);', 'expect(x).toEqual(5);');
      assert.equal(v, 'incomparable');
    });

    it('toBeCloseTo tolerance grew ≥ 2× → weakened', () => {
      const v = gradeReplacement('expect(x).toBeCloseTo(5, 2);', 'expect(x).toBeCloseTo(5, 100);');
      assert.equal(v, 'weakened');
    });

    it('toBeCloseTo tolerance shrank → strengthened', () => {
      const v = gradeReplacement('expect(x).toBeCloseTo(5, 4);', 'expect(x).toBeCloseTo(5, 2);');
      assert.equal(v, 'strengthened');
    });

    it('toBeCloseTo same tolerance, same value → unchanged', () => {
      const v = gradeReplacement('expect(x).toBeCloseTo(5, 2);', 'expect(x).toBeCloseTo(5, 2);');
      assert.equal(v, 'unchanged');
    });

    it('literal arg replaced by expect.any(...) → weakened', () => {
      const v = gradeReplacement(
        'expect(arr).toHaveLength(5);',
        'expect(arr).toHaveLength(expect.any(Number));',
      );
      assert.equal(v, 'weakened');
    });

    it('expect.any(...) replaced by literal → strengthened', () => {
      const v = gradeReplacement(
        'expect(arr).toHaveLength(expect.any(Number));',
        'expect(arr).toHaveLength(5);',
      );
      assert.equal(v, 'strengthened');
    });

    it('toBeWithin range widened ≥ 2× → weakened', () => {
      const v = gradeReplacement(
        'expect(x).toBeWithin(0, 10);',
        'expect(x).toBeWithin(-1000, 1000);',
      );
      assert.equal(v, 'weakened');
    });

    it('toBeWithin range shrank → strengthened', () => {
      const v = gradeReplacement(
        'expect(x).toBeWithin(0, 100);',
        'expect(x).toBeWithin(40, 60);',
      );
      assert.equal(v, 'strengthened');
    });

    it('identical args → unchanged', () => {
      const v = gradeReplacement('expect(x).toBe(5);', 'expect(x).toBe(5);');
      assert.equal(v, 'unchanged');
    });

    it('different literal values (same kind) → incomparable', () => {
      // Different expected value is a behavior change, not a strictness change.
      const v = gradeReplacement('expect(x).toBe(5);', 'expect(x).toBe(6);');
      assert.equal(v, 'incomparable');
    });

    it('parse failure on either side → incomparable', () => {
      assert.equal(gradeReplacement('not a real expression @#$', 'expect(x).toBe(5);'), 'incomparable');
      assert.equal(gradeReplacement('expect(x).toBe(5);', '???'), 'incomparable');
      assert.equal(gradeReplacement('', 'expect(x).toBe(5);'), 'incomparable');
    });

    it('compareStrictness directly: toBeCloseTo tolerance doubled exactly → weakened', () => {
      const before = parseMatcher('expect(x).toBeCloseTo(0, 2);');
      const after = parseMatcher('expect(x).toBeCloseTo(0, 4);');
      assert.ok(before && after);
      assert.equal(compareStrictness(before, after), 'weakened');
    });

    it('toBeCloseTo tolerance grew but less than 2× → incomparable (literal differs, not enough to call weakened)', () => {
      // Tolerance arg shifted but did not double; we will not call this
      // weakened, but the arg literals also differ so we cannot say
      // unchanged either. incomparable is the safe verdict.
      const v = gradeReplacement('expect(x).toBeCloseTo(5, 4);', 'expect(x).toBeCloseTo(5, 5);');
      assert.equal(v, 'incomparable');
    });
  });
});
