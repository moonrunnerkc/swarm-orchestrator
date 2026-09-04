// Copied to tests/object-empty.hidden.test.ts in a scratch copy of the produced tree.
import { isMatching, match, P } from '../src';

describe('P.object.empty (hidden acceptance)', () => {
  it('matches only an object with no own enumerable keys that is not an array, Map or Set', () => {
    expect(isMatching(P.object.empty, {})).toBe(true);
    expect(isMatching(P.object.empty, Object.create(null))).toBe(true);
    expect(isMatching(P.object.empty, { a: 1 })).toBe(false);
    expect(isMatching(P.object.empty, [])).toBe(false);
    expect(isMatching(P.object.empty, new Map())).toBe(false);
    expect(isMatching(P.object.empty, new Set())).toBe(false);
    expect(isMatching(P.object.empty, null)).toBe(false);
    expect(isMatching(P.object.empty, undefined)).toBe(false);
  });

  it('P.object matches any non-null object, arrays included', () => {
    expect(isMatching(P.object, { a: 1 })).toBe(true);
    expect(isMatching(P.object, [])).toBe(true);
    expect(isMatching(P.object, null)).toBe(false);
    expect(isMatching(P.object, 'text')).toBe(false);
  });

  it('chooses the empty branch in a match chain', () => {
    const describe = (x: unknown) =>
      match(x)
        .with(P.object.empty, () => 'empty')
        .with(P.object, () => 'object')
        .otherwise(() => 'other');
    expect(describe({})).toBe('empty');
    expect(describe({ a: 1 })).toBe('object');
    expect(describe([])).toBe('object');
    expect(describe(3)).toBe('other');
  });
});
