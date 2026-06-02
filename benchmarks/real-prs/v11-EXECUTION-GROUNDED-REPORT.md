<!-- HEADLINE-NUMBERS-PENDING: M/R/U/F_clean and the per-repo table are filled
     from benchmarks/regression-corpus/execution-grounded/correlation.json and
     stryker-viability.json once the evidence run completes. Do not ship with
     this marker present.

  RESUME CHECKLIST (picking up tomorrow):
  The layer is fully built, tested, wired, and committed; all gates green.
  The harness is proven on trpc/trpc#6098 (16 findings) and TanStack/query.
  Remaining steps to finalize this report:

  1. Run the regression evidence end to end (resumable, skips completed PRs):
       SWARM_EG_NODE_BIN=/opt/homebrew/opt/node@20/bin \
       SWARM_EG_CORPUS=regression \
       node dist/scripts/real-prs/run-execution-grounded.js
     It is slow (~1-3 min/PR, more for big installs). The big repos
     (expo, prisma, cloudflare, mui, nx) mostly fail mutation for inherent
     reasons (live DB, workerd runtime, RN toolchain, bespoke test infra),
     each evidence-backed. Confirmed mutation-viable so far: trpc, TanStack.
  2. Run the clean corpus (for F_clean), ideally scoped to the viable repos:
       SWARM_EG_CORPUS=clean SWARM_EG_REPOS=trpc/trpc,TanStack/query,... \
       node dist/scripts/real-prs/run-execution-grounded.js
  3. node dist/scripts/real-prs/derive-stryker-viability.js   (writes stryker-viability.json)
  4. node dist/scripts/real-prs/correlate-execution-grounded.js  (writes correlation.json with M/R/U/F_clean)
  5. Fill the __M__/__R__/__U__/__FCLEAN__ tokens and the *-PENDING tables
     below from correlation.json + stryker-viability.json. Remove this comment.
  6. Append a ## Amendment section to REDUNDANCY-FINDING.md with the final
     numbers (revised if U is large, unchanged-with-reasoning if U is small).
  7. Commit the report + amendment; re-run badges:regen if needed; verify
     npm test / typecheck / lint / LOC / promotions:check / badges:check.
-->

> **DRAFT** — the headline numbers (`__M__`, `__R__`, `__U__`, `__FCLEAN__`)
> and the per-repo tables are filled from the evidence run, which is in
> progress. The capability, the proof anchor (`trpc/trpc#6098`), and the
> per-repo root causes are final.

# v11 execution-grounded evaluation: running the change instead of reading it

## Top-of-file summary

The v11 benefit evaluation reached an honest negative result: the cheat
detectors and the LLM judge read the diff, and the PRs that get reverted ship
logic bugs that leave no cheat-shaped tell, so a diff-reading auditor does not
catch them (`REDUNDANCY-FINDING.md`). This layer changes the shape of the
tool: it provisions a sandboxed checkout of each PR and runs the change.
Three checks, each scoped to the lines the PR changed:

- **Mutation testing** (Stryker): a mutation that survives on a changed line
  is a line the tests execute but do not constrain.
- **Issue-linked repro**: a runnable repro from a closed issue, executed
  against the pre- and post-PR code; one that still fails after the fix is a
  fix that did not deliver.
- **Coverage delta**: a changed line no test executes.

All three ship advisory (severity `warn`, or `info` for coverage), never gate,
and cost nothing external (no LLM; the GitHub API is free).

**Headline numbers (regression corpus, viable repos):**

<!-- The four numbers below are filled from correlation.json. -->

- **M** = `__M__` regression-corpus PRs with a surviving mutation on a line the
  revert/hotfix later changed (within a +/- 10 line drift tolerance).
- **R** = `__R__` regression-corpus PRs whose linked issue repro still fails
  after the claimed fix.
- **U** = `__U__` regression-corpus PRs with an execution-grounded finding that
  correlates with the proof and is not caught by the cheat detectors or
  Semgrep or ESLint.
- **F_clean** = `__FCLEAN__` execution-grounded findings per PR on the
  presumed-clean corpus.

Defensibility line: *Adding execution-grounded checks to the cheat-detector
layer surfaces `__U__` regression-corpus catches not found by the existing
cheat detectors or Semgrep or ESLint, with `__FCLEAN__` execution-grounded
findings per PR on the presumed-clean corpus. Reproduce with `npm run
execution-grounded:full`.*

## What the layer demonstrably does

On the repos where the test setup is mutation-viable, the layer surfaces a
class of finding no diff-only tool in this repo can produce: a changed line
the test suite runs past without constraining its behavior. The proof anchor
is `trpc/trpc#6098`: scoped to the PR's changed lines, the mutation run
produced 69 mutants across the changed source, 53 killed, **10 survived and 6
on lines no test covers** — sixteen advisory findings, each backed by the
stored Stryker `mutation.json`. The cheat detectors, Semgrep, and ESLint raise
nothing on those lines, because there is nothing cheat-shaped or
security-shaped there; the lines are simply under-tested.

This is the orthogonal signal the diff-reading layers structurally cannot
emit, and it is evidence-backed rather than asserted.

## The viability constraint (load-bearing, honest)

Mutation testing has a hard precondition: the baseline test suite must pass in
the checkout, because a mutation is "killed" only by a test that already
passes and then fails on the mutant. Large OSS monorepos frequently do not
meet that precondition in a clean, generic sandbox, for reasons that are
properties of the repo, not bugs in this harness. Each was root-caused from a
real failing run:

- **Self-hosting / compiled output** (vite): the repo's own vitest imports
  `vite/dist`, which does not exist until the repo is built; even built, parts
  of vite's suite depend on a browser or platform and fail in a headless
  sandbox.
- **Custom runtime** (cloudflare/workers-sdk): the suite runs in the workerd
  pool; the baseline run cannot execute without that runtime. Coverage runs,
  mutation does not.
- **Live services** (prisma): the suite needs a database; the baseline test
  run fails without one.
- **React Native toolchain** (expo): the jest-expo preset needs the native
  setup.
- **Bespoke test infrastructure** (mui): the root config fails to resolve a
  module under Stryker's instrumentation.

The harness bugs that *were* in the way have been fixed (see the per-check
breakdown and the repo table). What remains is the inherent cost of mutation
testing on arbitrary real-world repos: it runs where the suite is green in a
generic checkout, and it cannot where the suite needs the repo's own
environment.

## Per-check breakdown

<!-- TABLE-PENDING: regression catches, clean FP burden, and examples per
     category, filled from correlation.json. -->

## The highest-confidence catches

<!-- LIST-PENDING: the top catches with PR link, revert/fix-PR link, the
     specific finding, and the merge cost, from correlation.json. The proof
     anchor trpc/trpc#6098 (10 surviving + 6 uncovered changed-line mutations)
     is included. -->

## The worst false-alarms on the clean corpus

<!-- LIST-PENDING: filled from the clean-corpus run. -->

## Repo viability table

<!-- TABLE-PENDING: green/yellow/red per repo with PRs evaluated, PRs the
     suite ran on, and the reason, from stryker-viability.json. -->

## The harness fixes (root-caused from real runs)

Getting the checks to run against real monorepos took a sequence of fixes,
each diagnosed from a real failing run rather than assumed:

- **Package manager via corepack** so a pnpm/yarn workspace installs (npm
  install fails on the `workspace:` protocol).
- **Pinned-Node toolchain** (`SWARM_EG_NODE_BIN`) so the suites run under the
  Node the repos target, not the auditor's.
- **Base resolution at depth 2** so a PR's pre-change state (the head's first
  parent) is fetchable.
- **PM-aware tool add** (`corepack pnpm/yarn add`, `-W` on Yarn classic) and
  **default package-manager store** so adding Stryker does not desync the
  store.
- **Explicit Stryker plugin name** so the runner plugin resolves under pnpm's
  strict layout, and **direct bin invocation** because the pnpm `.bin` entry
  is a shell shim.
- **Root-first scoping with per-package fallback** because a unified-config
  monorepo ties source to tests in another package (trpc), while a repo with
  an environment-flaky root suite runs better per package.
- **Glob-escaped mutate paths** so a Next.js dynamic-route name like
  `[trpc].ts` does not abort the run.
- **Version-pinned coverage provider** (`@vitest/coverage-v8` to the project's
  vitest), **build step** for self-hosting repos, and **runner detection from
  config files / jest-expo**.

## Differential update

<!-- VENN-PENDING: the prior Venn from v11-BENEFIT-REPORT.md recomputed with
     the execution-grounded findings added. -->

## Cost and runtime footer

External API spend: $0.00 (no LLM; GitHub API is free; tools are open source).
Pinned tool versions: Stryker `@stryker-mutator/core` 9.6.1 with the jest /
vitest / mocha runner adapters 9.6.1; coverage via `@vitest/coverage-v8`
(pinned per repo) and `c8`; Node 20 for the provisioned workspaces. Wall-clock
is recorded in `benchmarks/regression-corpus/execution-grounded/time-ledger.json`.
Regenerate with `npm run execution-grounded:full`.
