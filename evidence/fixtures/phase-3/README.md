# Phase 3 gate fixture

This fixture is the workspace each Phase 3 obligation runs against. It is
deliberately minimal: just enough scaffolding for the two obligation
types Phase 3 measures to be meaningful and contamination-free.

## Layout

```
evidence/fixtures/phase-3/
  package.json
  README.md
  src/
    math/
      sum.ts          (compute)
      product.ts      (multiply)
      clamp.ts        (clamp)
      square.ts       (square)
      negate.ts       (negate)
    format/
      greet.ts        (formatGreeting)
      upper.ts        (toUpper)
      concat.ts       (concat)
    parse/
      integer.ts      (parseInteger)
    predicate/
      positive.ts     (isPositive)
    lib1..lib5/
      a.ts, b.ts      (no-upward-imports scopes; sibling-only imports)
    pkg1..pkg5/
      a.ts, b.ts, c.ts (no-cycles scopes; acyclic chains)
```

## Why a separate fixture from Phase 1/2

The Phase 1 fixture (reused by Phase 2) was sized for property-must-hold
predicates: a tiny `src/` that grep / find can walk. Phase 3's
obligation types are AST-backed:

- `function-must-have-signature` requires a real named function with a
  declared signature in a real source file.
- `import-graph-must-satisfy` requires real source files with actual
  import statements that the AST extractor can parse.

The Phase 1 fixture has neither at meaningful scale. Adding the
scaffolding under Phase 1's tree would silently change the contamination
surface of Phase 1/2 obligations; landing the new fixture under
`evidence/fixtures/phase-3/` keeps the two obligation surfaces
independent.

## Contamination guard

`test/falsification/phase3-gate-fixture.test.ts` copies this tree into a
temp directory and runs every Phase 3 obligation's verifier against it,
asserting each is satisfied (the AST-backed analogue of the Phase
1/2 "predicate exits 0" guard). Any fixture edit that breaks an
obligation's pre-apply baseline trips this test before a Phase 3 run can
mis-classify the obligation.
