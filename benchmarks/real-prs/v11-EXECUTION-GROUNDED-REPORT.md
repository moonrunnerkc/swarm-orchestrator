# v11 execution-grounded evaluation: running the change instead of reading it

## Top-of-file summary

The v11 benefit evaluation reached an honest negative result: the cheat
detectors and the LLM judge read the diff, and the PRs that get reverted ship
logic bugs that leave no cheat-shaped tell, so a diff-reading auditor does not
catch them (`REDUNDANCY-FINDING.md`). This layer changes the shape of the
tool: it provisions a sandboxed checkout of each PR and runs the change. Three
checks, each scoped to the lines the PR changed:

- **Mutation testing** (Stryker): a mutation that survives on a changed line a
  test executes is a line the suite runs past without constraining.
- **Issue-linked repro**: a runnable repro from a closed issue, executed
  against the pre- and post-PR code; one that still fails after the fix is a
  fix that did not deliver.
- **Coverage delta**: a changed line no test executes.

All three ship advisory (severity `warn`, or `info` for coverage), never gate,
and cost nothing external (no LLM; the GitHub API is free).

**Headline numbers (72-PR regression corpus, 232-PR clean corpus, both
sampled; see Method).**

- **M = 1** regression-corpus PR has a covered-line mutation survivor that
  lands on a line the revert/hotfix later changed (within a +/- 10 line drift
  tolerance): `trpc/trpc#6098`, 8 such survivors on the lines `trpc/trpc#6140`
  later touched.
- **R = 0** regression-corpus PRs have a linked issue repro that still fails
  after the claimed fix and is validly executable. One candidate
  (`vercel/next.js#55978`) was an extraction artifact, not a real catch (see
  Honesty caveats).
- **U = 1** regression-corpus PR carries an execution-grounded finding that
  correlates with the proof and is not caught by the cheat detectors or Semgrep
  or ESLint (the same `trpc/trpc#6098`).
- **F_clean = 3.357** execution-grounded findings per evaluated clean-corpus PR
  (47 findings across the 14 clean PRs where a check ran; 2.136 per attempted
  PR over 22). The burden is concentrated in two PRs.

Defensibility line: *Adding execution-grounded checks to the cheat-detector
layer surfaces 1 regression-corpus catch not found by the cheat detectors or
Semgrep or ESLint, at a cost of 3.357 advisory findings per evaluated clean PR
(concentrated in 2 of 14 PRs). The single catch is a class of finding no
diff-reading layer can produce. Reproduce with `npm run
execution-grounded:full`.*

This is a modest, honest result, not a silver bullet: the layer adds one
orthogonal signal class (under-tested changed lines) that diff-reading
structurally cannot emit, demonstrated on a discriminating real suite, while
carrying a real false-alarm burden and a hard viability constraint.

## What the layer demonstrably does

On a repo whose suite actually discriminates (kills mutants), the layer
surfaces a class of finding no diff-only tool here can produce: a changed line
the test suite executes but does not constrain. The proof anchor is
`trpc/trpc#6098`. Scoped to the PR's changed lines, the mutation run produced
69 mutants, **53 killed** (the suite demonstrably discriminates), **10 survived
on covered lines and 6 on lines no test covers** (15 advisory findings after
de-duplication by file and line), each backed by the stored Stryker
`mutation.json`. Of the 10 covered survivors, **8 fall on lines that the
revert/hotfix PR `trpc/trpc#6140` later changed** (the M=1 catch). Example
survivors, all on `packages/server/src/adapters/node-http/nodeHTTPRequestHandler.ts`:
a `StringLiteral` mutation on line 44, an `OptionalChaining` mutation on line
97, a `BooleanLiteral` on line 121, a `BlockStatement` on line 130, each
executed by a test that does not assert on the mutated behavior. The cheat
detectors, Semgrep, and ESLint raise nothing on those lines, because there is
nothing cheat-shaped or security-shaped there; the lines are simply
under-constrained.

This is the orthogonal signal the diff-reading layers cannot emit, and it is
evidence-backed rather than asserted.

## The viability constraint (load-bearing, honest)

Mutation testing has a hard precondition: the baseline suite must pass *and*
discriminate in the checkout, because a mutant is "killed" only by a test that
already passes and then fails on the mutant. A run that kills nothing is
non-validating: its survivors cannot be told apart from "no real test here," so
they are not trustworthy as the strong signal (the auditor suppresses the
covered-survivor category when a run kills zero mutants).

Across the 12 corpus repos, under the corrected toolchain (Node 22, see Harness
fixes), 11 run at least one check; only `withastro/astro` is fully red (the
changed package has no test runner). Mutation specifically:

| grade | repos | evidence |
|---|---|---|
| ran and discriminates (killed >= 1) | trpc, getsentry, prisma, tldraw | trpc 53/69 killed; getsentry 43/61; prisma 24/36; tldraw 10/78 |
| ran but killed nothing (no signal) | expo, TanStack | expo 0/113 killed across 3 packages; TanStack 0/1 |
| did not run (coverage only) | cloudflare, mui, nx, next.js, vite | Stryker initial-test-run failure under the generic sandbox |
| no test runner in changed package | astro | unsupported runner: none |

Where the suite needs the repo's own environment, mutation cannot run in a
generic sandbox. Those are properties of the repo, not bugs in this harness:
cloudflare's suite runs in the workerd pool, mui resolves a module only under
its bespoke config, nx hangs its daemon under Stryker instrumentation,
next.js's coverage suite exceeds a 15-minute budget, vite's vitest imports
unbuilt `vite/dist`. Coverage and issue-repro still run on most of these; only
mutation is gated. This is the inherent cost of mutation testing on arbitrary
real-world monorepos, measured rather than asserted.

## Per-check breakdown

Regression corpus (23 PRs evaluated, 18 ran a check):

| check | finding category | regression PRs firing | example |
|---|---|---|---|
| mutation (covered) | mutation-survives-on-changed-line | trpc#6098 (9), getsentry#17539 (4) | trpc nodeHTTPRequestHandler.ts:97 |
| mutation (uncovered) | mutation-survives-on-uncovered-changed-line | trpc#6098 (6), getsentry#17539 (1), expo#35036 (54, non-discriminating) | trpc standalone.ts |
| issue-repro | issue-repro-still-fails | 0 valid (1 artifact, see caveats) | next.js#55978 (artifact) |
| coverage | uncovered-changed-line | 0 (mutation path subsumed them on the viable repos) | n/a |

Clean corpus (22 PRs evaluated, 14 ran a check, 47 findings total):

| clean PR | findings | breakdown |
|---|---|---|
| tldraw/tldraw#8070 | 38 | 6 covered-survivor + 32 uncovered |
| prisma/prisma#29512 | 9 | 5 covered-survivor + 4 uncovered |
| other 12 evaluated PRs | 0 | clean |

F_clean = 47 / 14 = **3.357 per evaluated PR**, but it is not uniform: 2 of 14
evaluated PRs carry all 47 findings, and the other 12 are clean. The two are
not false in the cheat sense; they are real under-tested changed lines on
merged PRs (an advisory observation, severity `warn`/`info`, never a gate).

## The highest-confidence catch

- **`trpc/trpc#6098`** (proof: revert/hotfix `trpc/trpc#6140`). Eight covered
  mutation survivors on lines #6140 later changed, plus six uncovered survivors
  and one more covered survivor off the proof lines. The suite kills 53 of 69
  mutants, so the survivors are genuine under-constraint, not a measurement
  artifact. Merge cost to a reviewer: 15 advisory `warn` lines, each naming a
  file, line, and mutator. Not caught by the cheat detectors, Semgrep, or
  ESLint.

This is the only proof-correlated catch in the sampled corpus. The layer's
value here is real but narrow: it points at under-tested changed lines, and on
this PR those overlapped the lines that needed the hotfix. It did not, on this
corpus, pinpoint the reverted logic bug on any other PR.

## The worst false-alarms on the clean corpus

- **`tldraw/tldraw#8070`**: 38 advisory findings (6 covered-survivor, 32
  uncovered) on a merged, presumed-good PR. The suite discriminates (kills 10),
  so the 6 covered survivors are real under-constraint; the 32 uncovered are
  changed lines with no test. A reviewer who only wants regressions flagged
  would read all 38 as noise.
- **`prisma/prisma#29512`**: 9 advisory findings (5 covered-survivor, 4
  uncovered) on a merged PR, same character.

These set the F_clean burden. A consumer who only wants the strong signal can
filter to `mutation-survives-on-changed-line` on a discriminating run, which
drops the uncovered noise.

## Repo viability table

Derived from `benchmarks/regression-corpus/stryker-viability.json` (any-check
status from the regression PRs) plus the per-PR mutation kill stats above.

| repo | any check ran | mutation ran + discriminates | note |
|---|---|---|---|
| trpc/trpc | green | yes (53/69 killed) | proof anchor |
| getsentry/sentry-javascript | green | yes (43/61 killed) | |
| prisma/prisma | green | yes, on a clean PR (24/36) | regression PRs: no DB |
| tldraw/tldraw | green | yes, on a clean PR (10/78) | regression PRs: no tests executed |
| TanStack/query | green | ran, zero-kill (no signal) | tiny mutant set |
| expo/expo | green | ran, zero-kill (no signal) | tests do not assert on changed pkgs |
| cloudflare/workers-sdk | green | no (workerd pool) | coverage runs |
| mui/material-ui | green | no (bespoke config) | coverage runs |
| nrwl/nx | green | no (daemon hang -> budget cap) | coverage runs |
| vercel/next.js | green | no (coverage > 15m budget) | repro runs |
| vitejs/vite | green | no (unbuilt vite/dist) | coverage runs |
| withastro/astro | red | no | no runner in changed package |

## The harness fixes (root-caused from real runs)

Getting the checks to run against real monorepos took a sequence of fixes, each
diagnosed from a real failing run rather than assumed:

- **Node 22 toolchain** (`SWARM_EG_NODE_BIN`): the corpus repos pin pnpm >= 11
  via their `packageManager` field, and pnpm 11 requires Node >= 22.13
  (`node:sqlite`); Node 20 crashed their installs while Node 26 broke coverage
  tooling. Node 22 LTS satisfies both, verified byte-for-byte identical on
  `trpc#6098` (69 mutants, 53 killed). This single change rescued mui, nx,
  prisma, expo, TanStack, and astro installs that had read as inherent failures
  under Node 20.
- **Non-frozen install fallback**: a frozen-lockfile install that fails (a real
  PR's lockfile drifted at that commit) retries once non-frozen.
- **Headless, fail-closed browsers**: `CI=true` plus `PLAYWRIGHT_BROWSERS_PATH`
  and `PUPPETEER_EXECUTABLE_PATH` pointed at non-existent binaries, plus
  `--browser.enabled=false` on the vitest coverage run, so a repo's own test
  code (tldraw vitest browser mode, next.js Playwright) can never open a window
  on the auditor's desktop.
- **Orphan reaping**: dev servers (next-server), native-binary build steps
  (profiling-node prune), jest workers, and test-spawned browsers are killed by
  their unique workspace path on teardown, so they cannot accumulate and starve
  the host.
- **Stryker coverage is authoritative**: a `Survived` mutant is covered by
  definition (Stryker executed it); a separate istanbul run that disagrees no
  longer overrides it (that bug had erased the covered-survivor signal
  entirely).
- **Zero-kill guard**: a mutation run that kills nothing emits no
  covered-survivor findings (its survivors are non-validating).
- **Repro setup-failure guard**: a repro that cannot compile, parse, or resolve
  imports is unevaluable, not a failing repro.
- Plus the earlier fixes: package manager via corepack, base resolution at
  depth 2, PM-aware tool add (`-W` on Yarn classic), explicit Stryker plugin
  name and direct bin invocation, root-first scoping with per-package fallback,
  glob-escaped mutate paths, version-pinned coverage provider, build step for
  self-hosting repos, runner detection from config files and jest-expo.

## Method and honesty caveats

- **Sampling.** Both corpora are sampled per-repo, not run as a census
  (regression up to 2 PRs/repo, clean up to 2-3/repo), so each repo is
  attempted and the heavy repos do not dominate wall-clock. M, R, U, and the
  per-PR detail are reported over the PRs actually evaluated, not the full 72
  and 232. The proof-correlation set is small; the headline is a single catch.
- **next.js#55978 is not a catch.** Its issue repro "still failed" with an
  esbuild `TransformError` (the extracted code block is not valid standalone
  TypeScript), so it failed to compile both before and after rather than
  exhibiting the bug. The classifier now marks compile/parse/module-resolution
  failures unevaluable, and this PR no longer produces a finding. It is recorded
  here as the reason R fell from a naive 1 to a true 0.
- **expo#35036 is not a strong catch.** Its mutation runs killed 0 of 113
  mutants across three packages: the changed packages' tests pass but assert
  nothing about the changed code, so its 54 surviving-mutant findings are the
  uncovered (coverage-grade) flavor, not the strong covered-survivor signal,
  and none correlate as M.
- **F_clean denominator.** Computed over the 14 clean PRs where a check ran; a
  PR whose install failed cannot raise a false alarm and is excluded from the
  rate (reported separately as F_clean_attempted = 2.136 over 22).
- **"Presumed clean" is load-bearing.** The clean corpus is hand-labeled clean;
  the two PRs that drew findings are merged, presumed-good PRs whose changed
  lines are genuinely under-tested, which is an advisory observation, not a
  defect claim.

## Cost and runtime footer

External API spend: $0.00 (no LLM; GitHub API is free; tools are open source).
Pinned tool versions: Stryker `@stryker-mutator/core` 9.6.1 with the jest /
vitest / mocha runner adapters 9.6.1; coverage via `@vitest/coverage-v8`
(pinned per repo) and `c8`; **Node 22** for the provisioned workspaces. The
evidence run is heavy (install plus suite per PR, minutes to tens of minutes on
the big repos). Regenerate with `npm run execution-grounded:full` (set
`SWARM_EG_NODE_BIN` to a Node 22 bin dir).
