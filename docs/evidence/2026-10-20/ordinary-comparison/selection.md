# Task selection for the ordinary comparison, written before the task was read

## The rule

Continue the file-order rule of [../../2026-10-19/coverage-and-reserve/protocol.md](../../2026-10-19/coverage-and-reserve/protocol.md)
(amendments 1 and 2) over the registered task set `scripts/comparison/tasks.mjs`, from the entry
after the last one that rule reached (`yargs-parser-bugfix-count-sentinel`), and take the first
entry that passes every test below. Nothing about either agent's result on any task enters the
choice; the rule is fixed here, then applied once.

1. **Not an excluded repository.** `markedjs/marked`, `broofa/mime` and `yargs/yargs-parser` are
   excluded by the assignment: their tasks were used to develop this sequence of work.
2. **Not used for this development sequence.** No launch of either arm on the task, halted
   launches included, in any evidence directory from 2026-10-14 on (the real-task pilot and
   everything after it). Earlier exposure, in the exploratory comparison of 2026-10-11, is
   disclosed but does not exclude: no registered task in the repository is unlaunched, since
   that comparison launched every entry of the set, and the fresh pool of 2026-10-16 has no
   verified task left that was not launched there.
3. **A bug fix**, the kind this sequence has been measuring (the prior rule took a bug fix for
   the same reason).
4. **Valid on the current scorer with no model:** `scripts/comparison/validate.mjs` finds the
   base failing the hidden oracle and the visible check and the upstream reference passing both,
   on fresh checkouts.
5. **Runnable by the runner's preparation:** the product's gate-plan preflight, which halted the
   fxp task on 2026-10-19 before any model call, accepts the base.
6. **Its wording separates requested change from kept behaviour** so that an independent
   evaluation can hold checks of each, and negative cases the task itself states.

## The rule applied

File order after `yargs-parser-bugfix-count-sentinel`:

| entry | decision |
| --- | --- |
| `yargs-parser-bugfix-negation-unknown` | excluded, test 1 (yargs-parser) |
| `yargs-parser-upgrade-toolchain` | excluded, test 1 |
| `js-yaml-bugfix-timestamp-early-years` | **not runnable, test 5**: a bug fix on nodeca/js-yaml, unlaunched since 2026-10-14, valid on the scorer ([js-yaml-not-launched/validation.json](js-yaml-not-launched/validation.json)) and with a validated probe ([js-yaml-not-launched/probe/](js-yaml-not-launched/probe/)); but its project test is `node --test test/core/**/*.test.mjs test/spec/*.test.mjs`, and the runner refuses to write a glob word as a Swarm gate override ([js-yaml-not-launched/preflight-error.txt](js-yaml-not-launched/preflight-error.txt): "the project test word ... cannot be written as a gate override; the frozen argv must be plain words"), so the Swarm arm would halt in preparation before any model call, as the fxp task did on 2026-10-19. The runner and the task set are not edited to admit it; its frozen manifest ([js-yaml-not-launched/manifest.json](js-yaml-not-launched/manifest.json)) was never launched |
| `js-yaml-feature-max-aliases` | excluded, test 3 (feature); the same project test, test 5 |
| `js-yaml-refactor-is-plain-object` | excluded, test 3 (refactor) |
| `js-yaml-upgrade-vite-workerpool` | excluded, test 3 (upgrade) |
| `js-yaml-bugfix-flow-colon-quoting` | excluded, test 5 (the same glob-worded project test) |
| `fxp-feature-end-index` | excluded, test 3 (feature) |
| `minimatch-bugfix-partial-globstar` | **selected**: isaacs/minimatch, a bug fix; no launch on it from 2026-10-14 on (it was launched in the 2026-10-11 cohorts, under earlier builds and a different model); its project test is `npm test`; validation and the preflight below pass; the task text states the requested change (five partial matches with `**` that must be true, through the function and `Minimatch#match`), negative cases (`b/a` against `a/**` stays false; non-partial matching does not loosen) and kept behaviour (partial matching without `**`, `makeRe` with `partial: true`) |

The entries after it are not examined.

## Validation, with no model

[validation.json](validation.json) (`scripts/comparison/validate.mjs --only minimatch-bugfix-partial-globstar`):
the base fails the hidden oracle (`test/partial.ts` from the upstream commit, run with tap) and
the visible check; the reference passes both and the project's tests. The exact commits, the
reference change's size and the lint result are in the file.

[preflight.json](preflight.json) ([preflight.mjs](preflight.mjs)): the frozen Swarm build's
gate-plan preflight on the base, called directly with no model, accepts it, with the effective
tests gate the task's; `opencode --version` answers the pinned version.

[probe/](probe/) ([evaluation-probe.mjs](evaluation-probe.mjs), run at upstream and at base before
either launch): all six requested rows differ between base and reference (false on the base,
true on the reference); all four negative rows and all nine preserved rows give the same result on
base and reference, so a patch that changes any of them breaks something the base had or loosens
what must stay strict. Two further rows the task does not state (dot files under partial matching
with `**`) are recorded as `observed`: one of them differs between base and reference, which is an
upstream behaviour change the task text does not ask for, so they are reported and not scored. The
reference (`probe/upstream.json`) is the frozen expectation: a delivered tree is scored by matching
it on every requested, negative and preserved row. The rows and the base's results are in
[probe/run-reference.txt](probe/run-reference.txt).

## Disclosure

This task's upstream change, base and records from 2026-10-11 are in the repository; the people
developing Swarm could have read them. Neither arm is given any of it: each works on a fresh
shallow clone of the base with the visible check committed, the task text and nothing else.
