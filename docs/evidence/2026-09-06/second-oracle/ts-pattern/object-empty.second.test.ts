// Second hidden oracle for the P.object task. Written from task.md alone, blind to every
// produced patch, and never handed to the tool: `swarm ci` is run with the first oracle and its
// verdict is then scored against this one. Different values from the first oracle throughout,
// plus the three parts of the task text the first oracle never exercised at all: the chainable
// .optional(), .and(), .or() and .select().
import { isMatching, match, P } from '../src';

describe('P.object (second hidden oracle)', () => {
  it('matches non-null objects the first oracle never names', () => {
    expect(isMatching(P.object, new Date(0))).toBe(true);
    expect(isMatching(P.object, /re/)).toBe(true);
    expect(isMatching(P.object, new Error('x'))).toBe(true);
    expect(isMatching(P.object, new Map([['k', 1]]))).toBe(true);
    expect(isMatching(P.object, new Set([1]))).toBe(true);
  });

  it('refuses every value whose typeof is not object', () => {
    expect(isMatching(P.object, () => 0)).toBe(false);
    expect(isMatching(P.object, Symbol('s'))).toBe(false);
    expect(isMatching(P.object, 0)).toBe(false);
    expect(isMatching(P.object, false)).toBe(false);
    expect(isMatching(P.object, 10n)).toBe(false);
  });
});

describe('P.object.empty (second hidden oracle)', () => {
  // Own enumerable keys, which is what the task says, rather than any of the shapes that happen
  // to agree with it on the first oracle's values: `{ b: undefined }` serializes to `{}` and is
  // not empty, and a non-enumerable own key is not an enumerable one.
  it('reads own enumerable keys rather than a stand-in for them', () => {
    expect(isMatching(P.object.empty, Object.create({ inherited: 1 }))).toBe(true);
    const nonEnumerable = {};
    Object.defineProperty(nonEnumerable, 'a', { value: 1, enumerable: false });
    expect(isMatching(P.object.empty, nonEnumerable)).toBe(true);

    expect(isMatching(P.object.empty, { b: undefined })).toBe(false);
    expect(isMatching(P.object.empty, new Map([['k', 1]]))).toBe(false);
    expect(isMatching(P.object.empty, new Set([1]))).toBe(false);
    expect(isMatching(P.object.empty, [1])).toBe(false);
  });

  it('supports the chainable combinators the task names', () => {
    expect(isMatching({ x: P.object.optional() }, {})).toBe(true);
    expect(isMatching({ x: P.object.optional() }, { x: {} })).toBe(true);
    expect(isMatching({ x: P.object.optional() }, { x: 3 })).toBe(false);

    expect(isMatching(P.object.and(P.object.empty), {})).toBe(true);
    expect(isMatching(P.object.and(P.object.empty), { a: 1 })).toBe(false);

    expect(isMatching(P.object.or(P.string), 'text')).toBe(true);
    expect(isMatching(P.object.or(P.string), { a: 1 })).toBe(true);
    expect(isMatching(P.object.or(P.string), 3)).toBe(false);
  });

  it('selects the object it matched', () => {
    const picked = match<unknown, unknown>({ a: 1 })
      .with(P.object.select(), (o) => o)
      .otherwise(() => null);
    expect(picked).toEqual({ a: 1 });
  });
});
