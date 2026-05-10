# Phase 1 dev-gate fixture

Minimal scaffolding the Phase 1 dev-gate runner copies into a workspace
before invoking codex against each obligation. Every locked predicate in
`evidence/phase1-dev-gate/sample-obligations.json` exits 0 against this
fixture before any candidate is applied — so codex is the only thing
that can flip them.

## Why a fixture instead of a git snapshot

Run-1 of the dev gate was contaminated by `git archive HEAD` re-entering
the repo against its own `evidence/` subtree: four predicates already
exited 1 against the snapshot before any candidate ran, because earlier
aborted-run evidence directories contained the literal marker tokens the
predicates searched for. See run-1 inspection at
`evidence/phase1-dev-gate/run-1/inspection.md` and the close-out entry
in `DECISIONS.md`.

Pinning the snapshot to v8.0.1 (`a7e5455`) sidestepped that single
contamination cycle but kept the gate dependent on git history. A
purpose-built fixture is contamination-free by construction — the
predicates' "no offending content/path exists" property holds because
this directory was designed to satisfy each one. The contamination-free
property is enforced by `test/falsification/phase1-gate-fixture.test.ts`,
which runs every locked predicate against the fixture and asserts each
exits 0.

## What's here

The fixture is intentionally tiny — just enough scaffolding for the
locked predicates to be meaningful. None of these files exercise
production code; they exist only to give the predicates a workspace
shaped like a project.

- `package.json`, `tsconfig.json` — minimal Node/TS metadata at root.
- `src/index.ts`, `src/falsification/placeholder.ts` — clean TypeScript
  source under `src/` and `src/falsification/` so predicates that scope
  to those subtrees have something to scan and find nothing.
- `templates/basic.html` — clean HTML template under `templates/`.
- `test/falsification/placeholder.test.ts` — clean test file under
  `test/falsification/`.

## Hard rule on edits

Editing this fixture changes the dev-gate's pre-apply baseline. The
fixture-contamination test will catch any edit that breaks the "every
predicate exits 0" invariant; the gate runner will refuse to run if the
test is failing. Do not bypass either gate to land an unverified
fixture change.
