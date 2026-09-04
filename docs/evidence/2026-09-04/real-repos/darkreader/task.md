# Task: `chunk` in the array utilities

Repository `darkreader/darkreader` at `ace67ae13e`. Self-authored, of the size of one
exported function beside the ones src/utils/array.ts already has.

## The task text both arms are given, verbatim

Add an exported function `chunk<T>(items: readonly T[], size: number): T[][]` to
src/utils/array.ts. It splits the array into consecutive groups of `size` elements in their
original order, with the last group holding whatever is left, so that `chunk([1, 2, 3, 4, 5],
2)` is `[[1, 2], [3, 4], [5]]` and `chunk([], 3)` is `[]`. It throws a RangeError whose message
names the size it was given when `size` is not a positive integer, so 0, -1, 1.5, NaN and
Infinity all throw. It must not mutate its input. Add unit tests for it at
tests/unit/utils/array.tests.ts, run by `npm run test:unit`. Keep every existing test
passing.

## What the hidden test checks

`hidden/array-chunk.hidden.tests.ts`, copied to `tests/unit/utils/array-chunk.hidden.tests.ts`
and run with `npx jest --config=tests/unit/jest.config.mjs tests/unit/utils/array-chunk.hidden.tests.ts`:
the two examples above, an exact multiple, each of the five bad sizes throwing a RangeError,
and the input left unchanged.
