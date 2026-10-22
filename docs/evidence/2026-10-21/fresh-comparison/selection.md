# Fresh task selection for the next comparison, 2026-10-21, with no model

No model inference of any kind was used for anything here: git, `npm ci`, the project's own
tests, Node probes of the library functions, and the harness's validator and
reference-feasibility reader, on this host (darwin arm64, Node v24.15.0, npm 11.12.1).

## The rule, fixed before this work

Take the `validated` entries of
[../delivery-trial/candidates.json](../delivery-trial/candidates.json) in their listed order. An
entry is used only if it still satisfies that file's own `rule` today on this host (the base
fails the hidden argv with the upstream test file overlaid, the base passes the project test
command, the upstream passes both) and passes the exposure audit
([exposure-audit.md](exposure-audit.md)). The first two entries that pass are the two tasks; the
third is used only if one of the first two fails, with the reason recorded.

## How each candidate fared

Re-validated by hand in shallow checkouts of each base fetched from the mirror
(`git fetch --depth 1 file://<mirror> <base sha>`), installed with
`npm ci --ignore-scripts` under the harness's install environment (shared npm cache
`~/.cache/swarm-comparison/npm-cache`, `PUPPETEER_SKIP_DOWNLOAD=true`). Hidden reading: the
upstream test file written over the base and `node bin/mocha.js <test file>`; project reading:
`npm run test-node:unit`; upstream reading: the upstream commit's whole diff applied to the base.
Mocha's exit code is its failure count.

| order | candidate | base hidden | base project | upstream hidden | upstream project | rule today | exposure | used |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `12279398f` | exit 1: 38 passing, 1 failing | exit 0: 1245 passing, 3 pending (10 s) | exit 0: 39 passing | exit 0: 1246 passing, 3 pending (8 s) | holds | passes | yes |
| 2 | `15aa7d155` | exit 4: 3 passing, 4 failing | exit 0: 1234 passing, 3 pending (10 s) | exit 0: 7 passing | exit 0: 1235 passing, 3 pending (9 s) | holds | passes | yes |
| 3 | `35413b661` | not run | not run | not run | not run | not re-examined | passes | no: the first two passed |

The hidden exit codes match those `candidates.json` recorded (1 and 4). The rule's static parts
also hold: each commit changes one source file and one test file
(`lib/cli/parse-args.js` +5 -1 with `test/node-unit/cli/parse-args.spec.js` +9;
`lib/cli/unparse-args.js` +1 -4 with `test/node-unit/cli/unparse-args.spec.js` +16 -10), and
each base has a committed `package-lock.json`. Candidate 3 was not re-validated because the rule
does not reach it.

## The two tasks

Drafted in `scripts/comparison/tasks.mjs` (a `mocha` repository object and two entries at the end
of the list), with `projectTest` `npm run test-node:unit` and the install `npm ci --ignore-scripts`.

| id | base | upstream | hidden test file and argv |
| --- | --- | --- | --- |
| `mocha-bugfix-long-prefix-short-alias` | `bb2e69a95` | `12279398f` | `test/node-unit/cli/parse-args.spec.js`, `node bin/mocha.js test/node-unit/cli/parse-args.spec.js` |
| `mocha-bugfix-unparse-attached-values` | `e5a779eb4` | `15aa7d155` | `test/node-unit/cli/unparse-args.spec.js`, `node bin/mocha.js test/node-unit/cli/unparse-args.spec.js` |

Each task text was written from the base's observed behaviour and the upstream change, without
naming the commit or quoting its code. Every example in it was evaluated on the base and on the
upstream checkout: every "must give" example differs from the stated value on the base and
equals it on the upstream, except two that already hold on the first base (`["--t=0"]`, which
the text says already works, and the absence of the alias keys after `--t`, `--R` and `--r`;
after `--j` the base throws); every "must not
change" example equals its stated value on both. The end-to-end symptoms quoted were reproduced:
on the first base `node bin/mocha.js --t 0 a.spec.cjs` exits 1 with
`TypeError: Mocha flag '--t' given invalid option: '0'` and `--R dot` exits 1 with
`ERR_MOCHA_INVALID_REPORTER`, both pass on the upstream; on the second base, with a
`.mocharc.json` holding `$schema` and `spec`, `node bin/mocha.js --enable-source-maps` prints
`Warning: Cannot find any files matching pattern "https://json.schemastore.org/mocharc.json"`,
without the Node flag it does not, and on the upstream it does not. Both texts end with the
explicit deliverable "Add regression tests for this behaviour to the project's existing test
suite". The second text also says that the existing cases expecting the two-argument form must
have their expected arguments updated without removing any case: the upstream source change alone
fails three existing tests (below), so this is part of the work for either arm.

### Visible checks and evaluator sensitivity

Each visible check is one assertion, weaker than the hidden test file: the first checks only
`parseMochaArgs(["--t", "0"], { timeout: 1000 }).timeout === "0"` (the hidden file also checks
`_` and the `=` form, and keeps its 38 other cases); the second checks only the `$schema` example
(the hidden file also checks the attached form for `require`, `reporter` and `timeout` and keeps
its other cases). Both pass `npx eslint --max-warnings 0` and `npx prettier --check` in the base.

A partial fix for each was written by hand and read the same way (visible: `node
acceptance/visible/check.mjs`; hidden: the upstream test file overlaid, `node bin/mocha.js <file>`):

| task | tree | visible | hidden |
| --- | --- | --- | --- |
| long-prefix alias | base | exit 1 (TypeError) | exit 1: 38 passing, 1 failing |
| long-prefix alias | partial: `--X` rewritten to `-X` before the existing check | exit 0 | exit 1: 38 passing, 1 failing (`--t=0` gives timeout `"=0"`) |
| long-prefix alias | upstream | exit 0 | exit 0: 39 passing |
| attached values | base | exit 1 (AssertionError) | exit 4: 3 passing, 4 failing |
| attached values | partial: `=` form only for dotted names and names starting with `$` | exit 0 | exit 3: 4 passing, 3 failing |
| attached values | upstream | exit 0 | exit 0: 7 passing |

So each visible check fails on the base and passes on the upstream, and in each task a tree that
passes the visible check while leaving the stated behaviour incomplete is refused by the hidden
reading.

## The harness's own validation of the drafted entries

Both entries parse under `taskSchema`, the visible sources in `tasks.mjs` are byte-identical to
the files run above, and `npx vitest run scripts/comparison` passes with them (13 files, 117
tests, exit 0).

`node scripts/comparison/validate.mjs --only <id> --out <file>`, one task at a time, exit 0 each,
merged verbatim into [validation.json](validation.json):

| id | verdict | base visible | base hidden (executed) | reference visible | reference hidden | policy | lint | wall |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `mocha-bugfix-long-prefix-short-alias` | VALID | false | fail, exit 1 (yes) | true | pass | ok: 1 assertion added, 0 removed | passes with the visible check | 47 s |
| `mocha-bugfix-unparse-attached-values` | VALID | false | fail, exit 4 (yes) | true | pass | ok: 1 assertion added, 0 removed | passes with the visible check | 46 s |

`node scripts/comparison/reference-feasibility.mjs --only <id> --out <file>`, exit 0 each, merged
verbatim into [reference-feasibility.json](reference-feasibility.json) (project test is
`npm run test-node:unit`; hidden is the task's argv over the overlay):

| condition | long-prefix alias | attached values |
| --- | --- | --- |
| a. base with the visible check | project exit 0 | project exit 0 |
| b. reference source only | project exit 0 | project exit 3 (three existing unparse cases expect the old form) |
| c. complete reference | project exit 0 | project exit 0 |
| d. overlay on source only | project exit 0, hidden exit 0 (39 passing) | project exit 0, hidden exit 0 (7 passing) |
| d. overlay on complete reference | project exit 0, hidden exit 0 (39 passing; overlay displaced the reference's own file) | project exit 0, hidden exit 0 (7 passing; displaced) |

The `coverage` field of every row is null: the reader parses tap-style tables, and mocha's nyc
prints a JSON report and a text summary. The project's `.nycrc` sets no coverage threshold, so
coverage cannot fail `npm run test-node:unit`.
