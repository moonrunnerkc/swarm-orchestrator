# Task: `List.partition`

Repository `gigobyte/purify` at `d440252d40`, version 2.1.4. Self-authored, of the size of
one exported function beside the ones `List` already has.

## The task text both arms are given, verbatim

Add `List.partition` to src/List.ts and export it through the `List` object. It takes a
predicate `(x: T, index: number, arr: T[]) => boolean` and a list, and returns a `Tuple` whose
first element is the array of elements the predicate accepted and whose second is the array
of elements it rejected, both in their original order, so that `List.partition(x => x > 1,
[1, 2, 3])` equals `Tuple([2, 3], [1])` and `List.partition(x => x > 1, [])` equals
`Tuple([], [])`. It is curried the same way `List.find` is: called with the predicate alone
it returns a function of the list. Give it the same two overloads and a doc comment in the
style of the file, and add tests for it in src/List.test.ts. Keep every existing test passing.

## What the hidden test checks

`hidden/List.partition.hidden.test.ts`, copied beside purify's `List.ts` under its source
directory as `List.partition.hidden.test.ts` and run with vitest on that one file: the two
examples above, order kept within both halves, the curried form, and that the predicate is
handed the index.
