# Verifying a project that is its own test runner, and what verification costs

Part B of the 2026-10-22 stage ([README.md](README.md)). Everything here ran with no model except
the live launches, whose ledgers are cited.

## 1. The false refusal, reproduced through the real verification path

The 2026-10-21 unparse launch (session `20261021T213030-b3dabd`) delivered a correct, complete tree
and exited 4 ("the final verification could not measure the change"). Reproduced before any edit
with `swarm ci` from the starting commit `53c2e6b06` over the same base, the same patch
(`sha256:1bbb7ccb...`, the kept workspace's), the launch's sealed goal contract and its tests-gate
configuration (`[gates.tests] command = "npm run test-node:unit"`): regression `unmeasured`, tests
`not-applicable` ("this change altered the instrument that measured it (lib/cli/unparse-args.js)").

Two defects decided that reading, and a third appeared while measuring:

1. **The project is its own runner.** `npm run test-node:unit` runs `node bin/mocha.js`, which
   imports the package's own `lib/`. The instrument closure (`instrument-identity.ts`) followed
   those imports, so 62 `lib/` files were the instrument of the tests check. Restoring the base's
   `lib/cli/unparse-args.js` to measure the instrument also restored the implementation under test:
   the new tests then failed by construction, and the pass was withheld. Every change to mocha's
   `lib/` met this. Running the base's runner as a second copy beside the candidate's source does
   not work either: mocha's test files `require("../..")` for the runner's own `describe`, and a
   second copy has no current context (`TypeError: Cannot read properties of undefined (reading
   'describe')`, observed).
2. **Rereadings were not scoped.** The base-configuration reading reran every check with every
   changed instrument file restored, and judged each check on it. lint's own instrument did not
   include `unparse-args.js`, but its rereading failed, so its pass was withheld as "resting on" a
   file it never loads.
3. **Rereadings started from a dirty environment.** mocha's `lint:knip-docs` runs `npm install` in
   `docs/` and then `knip --cache`: the first run in a tree passes and every later run fails (three
   consecutive runs on the untouched base: exit 0, 1, 1). The base-commit reading settles the
   environment first; the base-configuration and base-test rereadings did not, so they failed where
   nothing the change did could have made them fail. Separately, `lint` runs `eslint .` in
   parallel with that install (`run-p`), and eslint can read a half-written
   `docs/node_modules/*/package.json`: a race the project carries, recorded and not fixed here.

A pre-existing false **pass** surfaced in the controls (section 2): a change that edits the test
script (`node bin/run.mjs || true`) and breaks the shared runner source passed, because the
base-configuration reading restored both and measured the base's own implementation.

## 2. The correction

Commits `5fc92a51f` and `f93d9bf62`:

- Each check is reread under the base's instrument only for the files its own reading found
  changed, and only that check is rerun.
- The instrument observation records `programCode` (tree files reached only as code a run program
  loads) and `programSubjects` (the changed ones a test file also loads, by static import; an
  unfinished walk names all of them).
- A base-instrument pass that put back code the tests load no longer stands on its own.
- **runner-source-v1** (`src/gates/runner-witness.ts`): where every instrument change is such
  runner source, a failing test whose message is assembled at run time from a random marker (so a
  code frame of the file cannot show it whole) is appended to every JavaScript or TypeScript test
  file, and the check runs under the change's runner and with the changed runner files put back.
  The pass stands only where both runs fail, neither output was cut, the base's runner reported at
  least one added test, and the change's runner reported exactly the same ones. The offline verifier
  (`src/evidence/verifier/status.mjs`) re-derives this from the record.
- Every rereading starts from the prepared environment: what earlier readings left in the ignored
  tree is moved aside, the rereading runs, what it added is removed and the moved entries return,
  so the oracle and goal checks still read the tree as the patched reading left it.

Not done, deliberately: no project source is exempted from integrity checks, no arbitrary runner
change is accepted, nothing restores the implementation under test and calls it verified, and no
test, required check or final-tree binding was relaxed.

**The residual, named in the code:** a runner change that tells the added tests apart from its own
and hides only the latter is not excluded, as it is not for any source under test that runs in the
runner's process.

**Controls** (`src/cli-ci-self-hosted-runner.integration.test.ts`, a fixture project whose
`bin/run.mjs` imports its own `lib/report.mjs` to collect, tally and print, while its tests test
that file; every case also asserts that the offline verifier re-derives the same regression):

| change | tests check | regression |
| --- | --- | --- |
| legitimate change to the shared source, with a test | passed, runner-source-v1 | pass; lint (untouched instrument) not reread |
| incorrect change | failed | fail |
| change that also makes the runner swallow failures | withheld (witness: change's runner exits 0) | not pass |
| change that also makes the runner skip a test file | withheld (witness: one added test unreported) | not pass |
| changed test script (`|| true`) plus a broken implementation | withheld; base-configuration rule only, no witness | not pass (passed before the correction) |

On the starting commit ([regressions-before.txt](regressions-before.txt), seven of these and the
other new cases fail): the legitimate change reads `not-applicable` (the false refusal), and the
changed-script case reads `passed` (the false pass). The swallowing and skipping runners were
already withheld there, for the coarser reason; their tests fail only on the absent witness
record. The rereading-environment case and both repair-brief cases fail as well.

## 3. On real mocha, before and after

`swarm ci --install` over each patch, the starting build `53c2e6b06` against the frozen build
`06531fb5e`, same base, same configuration; per-check readings and times in the pack
(`payloads/verification-matrix`). "Commands" counts every check command run (the patched reading
and each rereading). lint's time is network-bound (its docs `npm install` reached a 300 s timeout
twice before the correction).

| patch | regression before → after | tests check after | commands before → after | wall before → after | lint time before → after |
| --- | --- | --- | --- | --- | --- |
| alias reference (upstream `12279398f`, legitimate, changes runner source) | unmeasured → **pass** | passed (runner-source-v1, 136 test files witnessed, 42 reported by both runners) | 17 → 14 | 62.8 → 68.2 s | 9.0 → 6.1 s |
| OpenCode alias patch (unreachable code) | fail → **fail** (lint: `no-unreachable`) | passed (runner-source-v1) | 17 → 15 | 198.2 → 84.1 s | 144.3 → 9.2 s |
| Swarm alias patch (incorrect) | fail → **fail** (tests) | failed | 12 → 8 | 510.7 → 48.3 s | 468.9 → 3.2 s |
| Swarm unparse patch (legitimate, rewrites three existing expectations) | unmeasured → unmeasured | withheld by the base-test reading (below) | 17 → 15 | 373.3 → 98.4 s | 306.3 → 6.0 s |

The unparse patch remains unmeasured for a different, intended reason: the task changes behaviour
that three existing tests assert, so the base's versions of those tests fail against the patch's
source, and Swarm has no requirement-contract mechanism that authorizes an expectation change. The
upstream reference is in the same position. That policy is not weakened here; it is the remaining
blocker for this kind of task.

The witness readings cost two test runs (about 17 s on mocha) where they apply; the scoping and the
settled environment remove the lint and format rereads that a runner-source change never needed.

## 4. The three unparse verification passes, and what is necessary

Records 105–110, 128–133 and 151–156 of session `20261021T213030-b3dabd`, 76.9 s, 78.3 s and
76.2 s from install to record (231.4 s), each over the same applied patch
(`sha256:5cfd0171...`):

| pass | started by | what it ran | necessary? |
| --- | --- | --- | --- |
| 105–110 | the worker's own `run_check` call (record 104, no arguments) | the whole independent verification: clone, install, five checks, base-configuration rereading of all five, base-test rereading of all five, goal checks, base-commit attribution | no: the worker asked for the sealed checks' result; the suite and its rereadings answered nothing it asked |
| 128–133 | gate cycle 0's sealed acceptance gate | the same | yes: it decides whether to repair |
| 151–156 | the final verification for the run assessment | the same | yes: it binds the verdict to the exact delivered tree, and the offline verifier requires it after the worker assessment |

Reusing pass 2 for pass 3 was not done: their checks run with unrestricted network (mocha's lint
installs from the registry), so their inputs are not identified, and invariant 6 requires a rerun.

**The correction (`3196a0818`):** `run_check` without a program now runs the sealed acceptance
checks on a fresh checkout and not the repository's suite and its rereadings (the acceptance gate
and the final verification still run everything). Measured live in launch 0 of this stage
(session `20261022T081213-bbf324`): two `run_check` calls took 8.8 s and 8.7 s, against 76.9 s for
the 2026-10-21 call; the gate and final verifications kept their full readings (68.0, 107.5 and
63.9 s). That is one live measurement on one project, not a general speedup.

Per-launch verification time in this stage (ledger intervals, install to record): launch 0
256.9 s in five passes (two of them `run_check`), launch 1 226.7 s in three, launch 2 101.9 s in
two, launch 3 76.0 s in two, launch 7 45.9 s in three.

## 5. Reproduction

    node src/cli.ts ci --workspace <mocha base checkout with the run's swarm.toml committed> \
      --patch <patch> --base HEAD --install --json
    npx vitest run src/cli-ci-self-hosted-runner.integration.test.ts src/gates/runner-witness.test.ts \
      src/gates/independent-verification.test.ts
    sh regressions-before.sh <a checkout of 53c2e6b06 with npm ci>

The matrix driver and summaries are in the pack (`node scripts/evidence-pack.mjs restore
docs/evidence/2026-10-22/payloads/packed-derived/payloads`).
