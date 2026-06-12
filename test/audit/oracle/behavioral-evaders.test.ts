import { strict as assert } from 'assert';
import parseDiff from 'parse-diff';
import {
  aliasMockReturnMethod,
  decoyMock,
  applyBehavioralStack,
  BEHAVIORAL_MAX_DEPTH,
  EVADERS,
} from '../../../src/audit/oracle/evade/evaders';
import { extractMockMutationFocus } from '../../../src/audit/cheat-detector/mock-delta';

const MOCK_DIFF = [
  'diff --git a/test/totals.test.ts b/test/totals.test.ts',
  '--- a/test/totals.test.ts',
  '+++ b/test/totals.test.ts',
  '@@ -3,4 +3,5 @@',
  "   it('totals', () => {",
  '-    const out = compute(input);',
  '+    const compute = jest.fn().mockReturnValue(expected);',
  '+    const out = compute(input);',
  '     expect(out).toEqual(expected);',
  '   });',
  '',
].join('\n');

describe('aliasMockReturnMethod', () => {
  it('rewrites mockReturnValue to an arrow mockImplementation', () => {
    const out = aliasMockReturnMethod.apply(MOCK_DIFF);
    assert.match(out, /\.mockImplementation\(\(\) => expected\)/);
    assert.doesNotMatch(out, /mockReturnValue/);
  });

  it('keeps the focus firing (the family is covered, not one spelling)', () => {
    const out = aliasMockReturnMethod.apply(MOCK_DIFF);
    assert.ok(extractMockMutationFocus(out).focusedDiff !== null);
  });
});

describe('decoyMock', () => {
  it('injects a benign decoy mock and keeps the hunk parseable', () => {
    const out = decoyMock.apply(MOCK_DIFF);
    assert.match(out, /_decoy = jest\.fn\(\)\.mockReturnValue\(0\)/);
    // The mutated diff still parses and the cheating mock still focuses.
    const files = parseDiff(out);
    assert.equal(files.length, 1);
    assert.ok(extractMockMutationFocus(out).focusedDiff !== null);
  });

  it('bumps the new-count so parse-diff accepts the extra added line', () => {
    const out = decoyMock.apply(MOCK_DIFF);
    const header = out.split('\n').find((l) => l.startsWith('@@ '));
    assert.match(header!, /\+3,6 @@/);
  });
});

describe('applyBehavioralStack', () => {
  it('is identity at depth 0', () => {
    assert.equal(applyBehavioralStack(MOCK_DIFF, 0), MOCK_DIFF);
  });

  it('layers cosmetic then behavioral evaders without breaking the focus', () => {
    for (let depth = 0; depth <= BEHAVIORAL_MAX_DEPTH; depth += 1) {
      const out = applyBehavioralStack(MOCK_DIFF, depth);
      assert.ok(
        extractMockMutationFocus(out).focusedDiff !== null,
        `focus must still fire at evasion depth ${depth}`,
      );
    }
  });

  it('only applies cosmetic evaders within the cosmetic depth range', () => {
    const cosmeticOnly = applyBehavioralStack(MOCK_DIFF, EVADERS.length);
    assert.match(cosmeticOnly, /mockReturnValue/, 'no behavioral evader yet at cosmetic max depth');
  });
});
