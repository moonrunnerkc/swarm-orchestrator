# Task candidates and pre-freeze exclusions

Mined on 2026-10-14 between 23:59Z and 00:27Z by four delegated search agents, one per group of
repositories, each browsing history through the GitHub API and verifying locally on Node
v24.15.0 against a bare mirror under `~/.cache/swarm-comparison/mirrors/`. Every claim of
"fails on base, passes on upstream" was then re-established with no model by
`scripts/pilot/validate.mjs`, whose output is [validation.json](validation.json); the agents'
own measurements are mining notes, not the validation. One agent-verified candidate did not
survive that re-establishment (below), which is why the validation is not delegated.

## Repository screening

Repositories were screened by `grep -rIlF <owner/name> campaign docs scripts src` printing
nothing (never mined, pooled, studied or used as a fixture here) and by a committed
`package-lock.json` at the default branch. The five repositories of the 2026-10-11 comparison
(marked, fast-xml-parser, yargs-parser, js-yaml, minimatch) and the smoke fixture were excluded
outright, as were repositories with earlier appearances (among them commander.js, dayjs,
winston, async, cheerio, markdown-it, yargs, ramda, redux, luxon, validator.js, pino, mocha,
jquery, immer, zod, axios, mathjs) and repositories without a committed lockfile (node-semver,
debug, fs-extra, node-ignore, path-to-regexp, ini, npm-package-arg, node-which, ejs, msgpackr,
date-fns, espree). Ten candidates with a lockfile and recent activity went to the mining
agents: htmlparser2, entities, mime, argparse, pako, csstree, acorn, node-lru-cache, whatwg-url
and chai; node-glob, rimraf, node-tar, minipass, json5, domhandler, domutils, css-select,
dom-serializer, sinon, undici, rollup and graceful-fs were listed but not mined for lack of
time.

## Chosen (four tasks, three repositories)

| task | type | repository | upstream commit | author | why |
| --- | --- | --- | --- | --- | --- |
| csstree-bugfix-raw-value-whitespace | bugfix | csstree/csstree | 6a1646e7aa60c518e14d4ca95aff57c813fcfe70 (2026-03-04) | the maintainer | 41 source lines in the generator, one new test fails on base, the requirement is statable from the issue it fixes, suite runs in 2 s |
| chai-feature-deep-contain-oneof | feature | chaijs/chai | 4225e809708f7ea8fef9fed2e55652f765caaf3a (2026-04-29) | contributor PR #1798 merged by a maintainer | adds a capability (deep flag for contain.oneOf) with new tests and new messages; labelled "fix" upstream |
| lru-cache-refactor-autopurge-noop-timer | refactor | isaacs/node-lru-cache | 2ec0b52433e7d77e962598e344d01e47897e87b5 (2026-03-13) | the maintainer | 49 lines, tests pass before and after, a grep-countable structure that the task text states explicitly |
| chai-upgrade-c8-v12 | upgrade | chaijs/chai | d9d00c3697c467266136103f6957524f3d6e3e8b (2026-07-17) | renovate, merged by a maintainer | a single devDependency bump with the lockfile regenerated; the pilot asks for an exact pin (12.0.0, the only 12.x published) where upstream declared ^12.0.0, as the 2026-10-11 comparison's upgrade tasks did, because Swarm's upgrade preset seals an exact target |

The chai repository carries two tasks; the three repositories are distinct and none appears in
earlier evidence here. The upgrade's "source lines changed" is the one package.json line; the
5 to 80 line rule was applied to the other three.

Known caveats of the chosen tasks, disclosed before freeze:

- chai's `npm test` also runs browser tests through Playwright (a network download), so the
  project test command both arms are told is `npm run test-node` (c8 with a 99% coverage gate
  over mocha). The coverage gate is the project's own and applies to both arms alike.
- chai's tests import the esbuild bundle, so `npm run build` precedes the visible check and the
  tests; lru-cache's tests need `npm run prepare` (tshy) first.
- The refactor's structural requirement names the exact guard spelling `!this.ttlAutopurge ?`
  once in the cache's main source file; it is stated in the task text, so it is a stated requirement rather
  than a hidden one.
- The lru-cache tap totals differ between base and upstream (17773 against 17704 assertions,
  both exit 0); the mining agent did not investigate why. The oracle reads the exit status.

## Excluded after the agents' verification

- **htmlparser2-bugfix-finish-resume-once** (649a2414, 2026-10-03, the maintainer): the agent
  reported 196 passing tests at the base and a verified wrong patch. The validator's clean clone
  of the base from the mirror (tag at 729780cd17d6924f1467a1c653c259e05ec13fb3) fails five of
  the project's existing tests (`should back out of numeric entities`, four `should reset after
  an unclosed ... tag` cases) and a full `vitest run` never exits; the agent's working clone,
  which passed, still had its wrong patch (the `finished` flag) applied when it measured the
  base. A base whose own suite fails and hangs is not a usable task under this protocol (the
  project's own test command is part of the visible verdict and both arms would run it), so the
  task was dropped before freeze. Nothing in this says the upstream change is wrong; it says the
  base's suite is red for the same defect.

## Verified but not chosen

- chai-bugfix-literal-template-tags (812c57da, 2026-09-14) and chai-bugfix-unique-expected-keys
  (8bb3a935, 2026-01-03): valid bugfixes; one bugfix slot, filled by the csstree task to keep
  the set over three repositories.
- entities-bugfix-legacy-run-consumed (00913aa9, 2026-07-01): valid; not chosen for the same
  reason. Its mining note records that the suite cannot observe one plausible wrong fix.
- mime-bugfix-gettype-line-terminators, argparse-bugfix-python-number-literals,
  acorn-bugfix-member-lhs-shorthand, acorn-bugfix-use-strict-operator: valid bugfixes by the
  agents' runs; one bugfix slot. acorn's install needs the network for a git devDependency.
- pako-feature-inflate-push-after-end and csstree-feature-parser-list-option: valid features;
  one feature slot, filled by chai's because its requirement adds visible behavior and messages.
- pako-refactor-wrapper-default-options: a valid refactor by the agent's runs; the lru-cache one
  was chosen first because its author is the maintainer and its suite was already measured.
- mime-upgrade-typescript-5-9-3 and csstree-upgrade-esbuild-0-24: valid upgrades; the mime one
  bumps four packages at once, the csstree one is a 0.14 to 0.24 esbuild jump; chai's single
  tool bump was the cleaner upgrade shape.

## Excluded, by the mining agents' logs

Reasons per commit are in the agents' logs, retained with the session's working files and
summarized here:

- fb55/htmlparser2: 100 single-parent commits browsed; excluded for being below the 5-line
  floor (cbf4b190, e0814740), over the 80-line cap (eb85803c, 88 lines), tooling churn (ESM-only,
  eslint 9, vitest migration), lint-only dependabot bumps, or outside the 3-year window; a
  feature (ecdb071c, xmp tag), a refactor (3954c555), an upgrade (38d818a1) and two bugfixes
  (25d49e35, 21dedfa0) were identified but not verified within the box.
- fb55/entities: 92 commits browsed; excluded as too large (decoder rewrites, 22b4592d at 110
  lines), tooling churn, test-only or lint-only; a bugfix (05af0b37), a small export restoration
  (c257e6c6) and a typescript upgrade (3731aef3) were identified but not verified.
- chaijs/chai: 22 excluded: two-line fixes below the floor, type-only and JSDoc changes, docs,
  CI, lockfile-only dependabot bumps, multi-package renovate bumps; no refactor with a
  mechanical property in the last 100 commits.
- isaacs/node-lru-cache: 15 excluded or not inspected: a refactor that also rewrote its
  snapshots (879f8b11), packaging and export-condition changes without behavioral tests,
  multi-dependency updates, version bumps, features over the cap; two plausible candidates
  (0b0a77e9, 47081532) were not run.
- jsdom/whatwg-url: skipped whole; its pretest downloads the web-platform-tests and the suite
  reads them, so it does not run offline.
- broofa/mime: 42 considered, 40 excluded (a 3-line fix below the floor, a types-only change,
  lock-only dependabot bumps); its full `npm test` also packs and installs into /tmp, so the
  candidates named `node --test` instead.
- nodeca/argparse: 40 considered, 39 excluded (a 4-line change without a test; a 26-commit
  "port:" series not sized within the box).
- nodeca/pako: 60 considered, 58 excluded (two 2-line fixes; a deflate-error fix whose hidden
  test hangs forever on the base).
- csstree/csstree: 28 considered; its two refactors are 152 and 234 lines.
- acornjs/acorn: 27 considered; mid-2025 bases fail `npm ci` on macOS (a lockfile missing
  fsevents), which excluded its small refactor and a feature.

Historical public tasks may have appeared in model training; "fresh" here means fresh to this
experiment and to this repository, not unseen by the model.
