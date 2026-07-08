# Pipeline language census

Every point between diff intake and engine dispatch on the live `swarm audit --pr`
path, classified by whether it assumes JavaScript/TypeScript. Hunts 3, 5, and 6 each
died at one wall; this finds them all before spending Hunt 7.

Committed **before** the fix, per the run brief. The fix follows in a separate commit.

## Method

- **Static trace** of the whole path: `src/cli/v8/audit-handler.ts` (dispatch) →
  `runCheatDetectors` (structural) → `runExecutionGrounded` (execution-grounded layer) →
  `provisionPRWorkspaces` / `detectTestRunner` → `runProofRestorations` / `runTestRestoration`.
- **Two live traces** through the shipped CLI (`node dist/src/cli.js audit --pr <ref>
  --output json`, EG enabled via this repo's `.swarm/audit-config.yaml`):
  - Go: `vlebo/ctx#24` → 0 structural findings, `execution-grounded skipped: no mutable
    source lines in diff`, `enginesApplicable: 0`.
  - Python: `canvas-medical/canvas-hyperscribe#256` → identical: 0 findings, same skip,
    `enginesApplicable: 0`.

Both languages die at the **same** wall, upstream of provisioning: the execution-grounded
entry gate. This matches the reach run's Hunt 6 localization to the byte.

## The finding

The front-end has exactly **one** hard JS/TS gate. Everything downstream of it
(provisioning, runner detection, the test-restoration engine) was already generalized to
pytest and Go by the reach run. The structural detectors that feed restoration are
partially polyglot already. So the census is short and the fix is surgical, not a rewrite.

This census was cross-checked by an independent full-path trace (a second reader over
`runCheatDetectors` → `runExecutionGrounded` → `runProofRestorations`); both landed on the
same single hard wall. The independent trace's non-blocking classifier findings and the
stale-comment note are folded into sections A-note and E below.

## A. The one hard front-end wall (fix this)

| # | file:line | code | why it blocks Go/Python |
|---|---|---|---|
| A1 | `src/audit/execution-grounded/index.ts:1215-1219` | `const changed = extractChangedLineRanges(prDiff, mutableSourceFilter); if (Object.keys(changed).length === 0) { ... return bailBeforeWorkspace('no mutable source lines in diff'); }` | `mutableSourceFilter` (index.ts:81) admits only `MUTABLE_EXTENSIONS = /\.(?:[cm]?[jt]sx?)$/`. A `.go`/`.py` diff yields an empty `changed` map, so **the whole layer bails before provisioning** — including the polyglot restoration engine, which does not need `changed` at all. |

**Root cause:** `changed` is the *mutation/coverage target set* (Stryker/Istanbul are
JS/TS-only, so keeping it JS/TS is correct), but its emptiness is being reused as the
*layer-wide entry condition*. The restoration engine (T4) is finding-gated on
`candidates.test`, not on `changed`; the no-op/mock/type-suppression/fake-refactor/
dead-branch proofs are finding-gated too. The gate conflates "nothing for the mutation
engine" with "nothing for any engine."

**Fix (next commit):** proceed past the entry gate when there is a JS/TS mutable set **or**
any proof candidate; bail only when both are empty. Mutation/coverage keep
`mutableSourceFilter` unchanged (they must stay JS/TS). The TS path is byte-identical: when
`changed` is non-empty the condition is satisfied exactly as before. `candidates` is
already computed above the gate (`selectProofCandidates`, index.ts:1165), so no new fetch.

## B. Already ecosystem-aware (do not touch — reach run generalized these)

| file:line | what | Go/Python status |
|---|---|---|
| `diff-walker.ts:182` `isTestFile` | test-file classifier | recognizes `test_*.py`, `*_test.py`, `*_test.go`, `*.test.rs`, `__tests__/`, `tests?/`, `spec/` |
| `diff-walker.ts:242` `isPlausiblyTestReachable` | source-reachability filter | `TEST_REACHABLE_EXTENSIONS` includes `.py .pyi .go .rs .rb .java ...`; `.go`/`.py` pass |
| `diff-walker.ts:256` `isManifestFile` | manifest classifier | recognizes `go.mod`, `requirements.txt`, `pyproject.toml`, `Cargo.toml` |
| `test-restoration.ts:152` `changedNonTestSourceFiles` | non-test source set | language-agnostic (any non-test path) |
| `sandbox.ts:179` `detectNonNodeRunner` | runner detection | `go.mod` → `go-test`; python markers + pytest signal → `pytest` |
| `sandbox.ts:201` `provisionEcosystem` | install routing | routes node / python / go |
| `polyglot-install.ts` | non-Node dep install | Python (poetry / venv+pip), Go (`go mod download`) |
| `test-restoration.ts` `buildTestCommand` / `parseFailingTests` | runner seam | pytest (nodeid identities), go-test (`--- FAIL:` identities), validated 4/4 |
| `cheat-detector/index.ts:36` registry filter | subject-path + config exclude | `isAuditSubjectPath` blocks data extensions (`.md/.json`), includes source of any language |
| `subject-paths.ts:83` `isAuditSubjectPath` | data-file filter | `DATA_EXTENSIONS` blocklist; `.go`/`.py` are subjects, not excluded |

## C. TS-married engines (keep the documented fail-closed abstain — do NOT generalize)

Each proves a property that is intrinsically JS/TS/AST-shaped. Per the standing rule (the
full control set travels or the engine does not ship on a language), these keep their
non-TS abstain. Generalizing them is out of scope and would weaken a control.

| engine | file | why TS-married |
|---|---|---|
| no-op-fix restoration | `no-op-fix-restoration.ts` | changed-line coverage control is Istanbul-JSON only; Go has no import-graph closure |
| mock-mutation restoration | `mock-restoration.ts` | keys on `jest.mock` / `vi.mock` return-value AST |
| type-suppression restoration | `type-suppression-restoration.ts` | `tsc` diagnostics + `@ts-*` directives |
| fake-refactor restoration | `fake-refactor-restoration.ts` | TS symbol resolution over the checkout |
| dead-branch restoration | `dead-branch-restoration.ts` | JS/TS branch instrumentation |
| mutation-check (Stryker) | `mutation-check.ts` | Stryker mutates JS/TS |
| coverage-delta (Istanbul) | `coverage-delta.ts` | Istanbul JSON coverage |

These already abstain on non-TS today (the empty `changed` map / no-runner path). The
entry-gate fix does not change that: a Go/Python PR still produces null-control abstain
records for these, which is the honest, fail-closed outcome.

## D. Restoration-feeding detectors: reach and bounded gaps

The two structural detectors that supply `candidates.test` (index.ts:371) are already
substantially polyglot. They gate on the polyglot `isTestFile` and their assertion grammar
covers Go-native and Python idioms directly (verified in source):

| detector | fires on (verified) | bounded gap (recorded, routed around) |
|---|---|---|
| `test-relaxation.ts:67-80` | JS `expect(...)`; Python `assert` and `def test_`; **Go-native `t.Fatal` / `t.Error` / `t.Errorf`** | the AST matcher-grader supplement is TS-only (a bounded add-on; the regex layer fires regardless) |
| `assertion-strip.ts:12-20` | `expect(`, bare `assert\b` net-count drop, Go `t.Fatal`/`t.Error`/`t.Errorf` | subject *re-specification* matching (`assertionSubject`) is `expect(X)`-only (JS) |
| `coverage-erosion.ts:21-26` | polyglot `isTestFile` gate, emits `warn` | branch regexes are parenthesized (`if\s*\(`), so Python `if x:` is missed (Python-weak) |
| `error-swallow.ts:39-42` (not restoration-feeding) | JS empty `catch {}`, Python `except: pass` | Go `if err != nil {}` / `_ = err` swallow; logger recognizers JS-heavy |

**Consequence:** a Go-native or Python test-relaxation cheat (removing a `t.Error` /
`assert`) **does** produce a candidate finding and, once wall A1 is cleared, reaches the
polyglot restoration engine end-to-end. The residual gaps (assertion-strip's JS-only
re-specification subject match, coverage-erosion's parenthesized-branch assumption,
error-swallow's Go idiom) are detection-coverage limits, not pipeline gates; Hunt 7's reach
matrix itemizes them as out-of-reach per entry rather than counting them as misses. Fully
porting the assertion/error grammar to every Go/Python framework (testify, gocheck,
ginkgo, unittest, nose, ...) is unbounded and each idiom needs its own restoration control
to travel soundly, so it is separate bounded work, not this run's.

## E. Non-blocking JS-assuming classifiers on the path (record, do not gate on)

These sit on the path but degrade gracefully; they do not block a Go/Python restoration.
Recorded for honesty, not fixed as walls (fixing them changes no verdict):

| file:line | classifier | behavior on Go/Python | blocks restoration? |
|---|---|---|---|
| `sandbox.ts:108-113` | `detectPackageManager` (LOCKFILES `:25`) | defaults to `npm`; the value is threaded to restoration but `buildTestCommand` for pytest/go-test ignores `packageManager` (uses `python3`/`go`) | no (benign mislabel) |
| `monorepo.ts:26` | `nearestPackageDir` recognizes only `package.json` | Go/Python changed lines collapse to root scope `''`; feeds only the JS mutation/coverage per-package fallback (which skips anyway) | no |
| `mutation-check.ts` / `coverage-delta.ts` | Stryker / Istanbul | skip with a `skipReason` (index.ts:1316,1337), never throw | no |

**Stale comment corrected in the fix commit:** `sandbox.ts:437-438` still reads "The proof
tier's scoped commands stay Node-only ... nothing here runs the suite." That is now
factually wrong (the restoration `RUNNER_ARGV` includes `pytest`/`go-test`). It is doc
drift, corrected alongside the fix (a comment-only change; no behavior).

## What the fix does and does not do

- **Does:** let a Go/Python diff carrying a restoration candidate (or any proof candidate)
  reach the already-polyglot provisioning + restoration engine, instead of bailing at the
  JS/TS mutation-target gate. This closes wall A1 — the exact barrier Hunt 6 named.
- **Does not:** change any control, threshold, or bar; touch the mutation/coverage JS/TS
  target set; generalize a TS-married engine; or port Go-native assertion/error grammar
  (D, recorded and route-around). The TS path stays byte-identical, pinned by regression
  tests.
