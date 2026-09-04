# Task: `P.object` and `P.object.empty`

Repository `gvergnaud/ts-pattern` at `c92ca435c7`, version 5.9.0. From open issue #230,
"Support P.object.empty", made concrete here so it cannot drift between runs.

## The task text both arms are given, verbatim

Add `P.object` and `P.object.empty` to ts-pattern. `P.object` is a chainable pattern, like
`P.string` and `P.number`, that matches any value whose typeof is "object" and which is not
null, including arrays, Maps and Sets. `P.object.empty` matches only a value that `P.object`
matches, is not an array, not a Map and not a Set, and has no own enumerable property keys, so
`{}` and `Object.create(null)` match it and `{ a: 1 }`, `[]`, `new Map()`, `new Set()`, `null`
and `undefined` do not. Both must work with `match(...).with(...)` and with `isMatching`, and
`P.object` must support the usual `.optional()`, `.and()`, `.or()` and `.select()`. Export
them from the `P` namespace, type them so that matching narrows to `object`, and add tests
for both in tests/objects.test.ts. Keep every existing test passing.

## What the hidden test checks

`hidden/object-empty.hidden.test.ts`, copied to `tests/object-empty.hidden.test.ts` and run
with `npx jest tests/object-empty.hidden.test.ts`: the eight values above against
`isMatching(P.object.empty, x)`, `P.object` accepting an array and rejecting null, and one
`match` chain choosing the `P.object.empty` branch for `{}`.
