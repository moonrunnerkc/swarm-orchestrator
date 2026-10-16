# Task candidates, selection criteria and exclusions, 2026-10-15

Declared before either arm attempted any task. The pool is the 2026-10-14 mining
([../../2026-10-14/real-task-pilot/candidates.md](../../2026-10-14/real-task-pilot/candidates.md)):
candidates its agents verified as "fails on base, passes on upstream" that were not chosen then
and have been used by no launch, calibration, diagnosis or repair here since. No new mining was
done; the mirrors under `~/.cache/swarm-comparison/mirrors/` are the ones taken on 2026-10-14.
Historical public tasks may have appeared in model training; "fresh" means fresh to this
experiment and this repository.

## Criteria

1. A maintainer-authored or maintainer-merged change on a public repository with a committed
   `package-lock.json`, 5 to 80 source lines, whose requirement can be stated from the change
   without naming it.
2. The base installs from its lockfile with scripts off and its own suite runs on Node 24 in
   under two minutes; nothing in the task needs a browser, a container, a paid service or a
   network beyond the npm registry.
3. The upstream commit's own tests, or a task-authored hidden check, fail on the base and pass
   on the reference, and reject at least one plausible wrong or partial implementation
   (`wrongPatches` in `scripts/pilot/tasks-2026-10-15.mjs`), all shown by executing them
   ([validation.json](validation.json)).
4. One of each kind (bug fix, feature, refactor, upgrade) across at least three repositories;
   no task, commit or fixture used by the 2026-10-11 comparison, the 2026-10-14 pilot, its
   development launches, the 2026-10-15 diagnosis or any repair.
5. At least one task with security-relevant behaviour whose negative control the checks reject.
6. Fits the launch budget: fifteen minutes including two corrections and internal verification.

## Chosen

| task | kind | repository | upstream commit | author | why |
| --- | --- | --- | --- | --- | --- |
| mime-bugfix-gettype-line-terminators | bug fix | broofa/mime | d7871f3bac120df5e4776e7c395b39d0d8e7b562 (2025-04-03) | the maintainer | two regular expressions in `getType`, a file-name-driven content-type decision (criterion 5), four hidden cases of which a wrong fix passes two |
| pako-feature-inflate-push-after-end | feature | nodeca/pako | 16fb5c47d936af5c88e943178c8e6f455e067128 (2026-06-26) | the maintainer | a stated behaviour change to a public streaming method (pushes after the stream's end report the recorded outcome and keep the result), 37 lines of upstream tests, one wrong implementation the second of them rejects |
| pako-refactor-options-default-param | refactor | nodeca/pako | 1754a8b32c876f155aa816d33681db4553838123 (2026-06-25) | the maintainer | 13 lines in two files, behaviour unchanged, grep-countable structure stated in the task text |
| csstree-upgrade-esbuild-0-24 | upgrade | csstree/csstree | 7cfec03270088f42ee40db1c744e00efe2bc219e (2024-12-05) | the maintainer | one devDependency ten minor versions up, lockfile regenerated, the bundle build and bundled suites as the proof; the exact pin the task asks for is the pilot's convention, with the maintainer's range reference rewritten to it for validation |
| argparse-calibration-number-conversion (calibration only) | bug fix | nodeca/argparse | 28c7449992ea35368e29dab9add9b368f4cba7dc (2026-09-10) | the maintainer | 16 lines against a precise specification (Python's float grammar) with 83 lines of upstream tests; a fourth repository, so the calibration shares nothing with the scored set |

The pako repository carries two tasks (different commits, the feature's base after the
refactor's); csstree's one task here is a change its earlier task (the generator's raw-value
whitespace) did not touch. Four repositories in all, three in the scored set.

## Caveats, disclosed before the freeze

- mime: the project's `lint` (Prettier over the tree) fails at the base on files the task does
  not touch, including the Mime class source itself, so lint is not a rule either arm is held to there;
  the task text asks for the file's existing style instead. `npm test` builds first and then
  runs the node suite and an exports test that packs the package into `/tmp/mime_test`.
- pako feature: the upstream test file is replaced whole at scoring time, so the arm's own
  additions to it, if any, are discarded; the hidden check runs the project's node tests
  through the TypeScript sources as the project itself does.
- pako: `npm test` runs lint, build (vite and rollup), type-check and the node suite, about
  half a minute; the visible check imports the TypeScript sources the project's own tests
  import.
- csstree upgrade: esbuild 0.14 installs its binary through a postinstall script, which the
  scripts-off install skips, so the bundle does not build at the base; the hidden check
  (`npm run build-and-test`) therefore fails at the base for that reason as well as the version,
  and passes on the reference, whose esbuild carries platform packages instead. The wrong patch
  (a range declaration without a regenerated lockfile) is rejected because the lockfile no
  longer installs; that the declaration rule itself is enforced is shown by the maintainer's
  own range reference failing the oracle until rewritten.
- argparse: `npm test` runs eslint (neostandard) first, so the visible check is written in that
  style.

## Excluded

| candidate | why |
| --- | --- |
| chai-bugfix-literal-template-tags (812c57da) | the repository carried two pilot tasks and a replayed patch; its node suite runs under a 99 per cent coverage gate that an unrelated change can fail |
| chai-bugfix-unique-expected-keys (8bb3a935) | same repository; not reused |
| entities-bugfix-legacy-run-consumed (00913aa9) | the commit is in the mirror but its hidden test is a streaming decoder spec the 2026-10-14 note says cannot observe one plausible wrong fix |
| csstree-feature-parser-list-option (20f5671) | chosen first and withdrawn by validation: under `list: false` the maintainer's own change parses rule preludes and declaration values as `Raw` nodes (its sub-parsers fall back when lists are absent), so the reference does not satisfy a contract stated at every tree level and generates different CSS; the upstream tests check only the root's children. Recorded in [validation.json](validation.json)'s first runs; replaced by the pako feature |
| htmlparser2-bugfix-cdata-bogus-comment (25d49e3) | its upstream test is a snapshot file under `__snapshots__`, which both arms would need to regenerate; the pilot already excluded this repository's base for a red suite |
| acorn bug fixes | install needs the network for a git devDependency |
| mime-upgrade-typescript-5-9-3 | bumps four packages at once |
| the 2026-10-14 pilot's four tasks | used by the pilot, its development launches and the diagnosis |
| the 2026-10-11 comparison's twenty tasks and the smoke tasks | used by earlier launches or as fixtures |
