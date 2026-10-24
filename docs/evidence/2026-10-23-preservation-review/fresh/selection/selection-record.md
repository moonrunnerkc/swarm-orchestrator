# Fresh block 3 selection record

Prepared by the evaluator author under the registered rule
`docs/evidence/2026-10-23-preservation-review/fresh-block-selection-rule.md` (registered in
`c494db30b`), which takes block 2's conditions
(`docs/evidence/2026-10-23-controller/heldout-2-selection-rule.md`) and through them block 1's
(`docs/evidence/2026-10-22-adaptive/heldout-selection-rule.md`). No model inference of any kind
was run. The sealed registry (`sealed/registry.json`) holds the full validation outputs and stays
sealed until the block is scored.

## Repository order and exposure check

Recorded at 2026-10-23T20:46:16Z in `scan/repository-order.json`
(`sha256:0b4f80dfe55d997459113a221fc85b3d44af6db02d2e0bb789bfb2ff2d68821d`), before any
candidate repository was cloned or any history, change, test or evaluator of it was read (the first
mirror, unjs/ufo, was cloned at 20:46:24Z):

1. unjs/ufo
2. postcss/postcss
3. jprichardson/node-fs-extra
4. micromatch/picomatch
5. ljharb/qs
6. Rich-Harris/magic-string
7. unjs/pathe
8. unjs/defu
9. ai/nanoid
10. pmndrs/zustand
11. kpdecker/jsdiff
12. sindresorhus/globby
13. inikulin/parse5
14. mozilla/source-map
15. minimistjs/minimist
16. davidtheclark/cosmiconfig
17. estools/escodegen
18. micromatch/micromatch
19. lukeed/kleur
20. sindresorhus/execa
21. unjs/destr
22. unjs/scule
23. sindresorhus/ky

Entries 1-10 are block 2's unreached order (rule pool item 1). None was among the comparison's
mirrors or found in any other cache of this machine before this block. The exposure scan
(`scan/repo-exposure.json`: `owner/name` and `owner__name`, case-insensitive, over every tracked
file under `docs/evidence/` and `scripts/comparison/` at `c494db30b`, read from git, 16,532 files,
171 `.br`/`.gz` archives expanded) finds each of them in exactly three files, all order lists:
block 2's `fresh/selection-record.md`, its released `fresh/sealed/registry.json`, and this block's
rule. Entries 11-23 are additions with zero matches. Excluded by the same check before the order
was fixed: mrmlnc/fast-glob (1 file, `docs/evidence/2026-10-21/delivery-trial/candidates.json`).

A second scan (`scan/commit-exposure.json`, block 1's commit-prefix method) searched every tracked
file of the project at `c494db30b` (18,385 files, 180 archives expanded) for the first eight hex
digits of all 335 considered candidates' change and base commits. The three accepted candidates
have no match. Two rejected candidates match by coincidence inside SHA-256 digests: postcss
`58939347f` (inside a `stdoutDigest` in `docs/evidence/2026-10-16/packed-derived/gzip/archive.json.br`)
and nanoid `043a7c16d`'s base `e52d9461` (inside a `previousHash` in
`campaign/corpus/local-mlx/packed-derived/local-mlx-corpus/archive.json.br`).

## Interpretation

- Families are filled in the rule's order (1 bounded API change with preservation, 2 bug fix with
  preservation, 3 mechanical transformation that reaches configuration). For each family,
  repositories are taken in the order above and, within a repository, the default branch's
  first-parent history newest first from the head recorded at clone time (ufo `f06c800d0`,
  postcss `d1908579d`, node-fs-extra `1e223d3b1`, picomatch `9fab7bf61`, qs `234d5051f`,
  magic-string `993d27d8a`, pathe `bc7477a01`, defu `82632b66f`, nanoid `35ea7d02c`).
- Subject keywords are whole words, case-insensitive, as in block 2: family 1 feat, feature(s),
  add(s/ed/ing), support*, option*, compat*; family 2 fix(es/ed/ing), fixup; family 3
  rename(s/d/ing), move(s/d)/moving, refactor*, migrat*. A keyword match is necessary, not
  sufficient.
- Span guard (block 2's): a candidate is not taken where the families still open could no longer
  bring the block to two repositories. Families 1 and 2 were both taken from ufo, so ufo's
  family-3 pool was refused as a whole and not read.
- Family 3 needs files moved or renamed (or a path or identifier renamed throughout) with
  behaviour unchanged, and the reference itself must edit a configuration, build or script file
  that names a moved path. Each family-3 candidate was first screened from its diff
  (`scripts/screen3.mjs`: renames, files touched, configuration files touched); every candidate
  with a rename, or with a configuration edit, was then read individually.
- Project test commands. ufo's npm test runs `pnpm lint` (eslint, then `prettier -c src test`)
  before vitest; under the pinned `--before` resolution prettier reports `src/punycode.ts` on both
  unchanged bases, so the project test argv is npm test's own vitest step,
  `npx vitest run --typecheck`. nanoid's npm test is `jest-ci --coverage && eslint-ci . &&
  size-limit && yarn spell`; Jest's 100% statement threshold is missed at the unchanged base under
  Node 24 (99.66%), and the spelling step needs yarn and a network service, so its argv is
  `npx jest`. Both task texts say so.
- Installs. Neither repository commits an npm lockfile at these bases, so each task installs with
  `npm install --ignore-scripts --no-audit --no-fund --before=2026-10-23T00:00:00.000Z`, and the
  harness lockfile for each launch workspace is frozen under
  `~/.cache/swarm-study-2026-10-23c/heldout-inputs/<task-id>/package-lock.json` (resolved by that
  command; two independent resolutions per task were byte-identical). nanoid's base tracks a
  `yarn.lock` that npm 11 rewrites on `npm install` and on `npm ci`; its install therefore restores
  the file with `git checkout --quiet -- yarn.lock` after the pinned install.
- ufo declares pnpm in `packageManager`; the comparison's `taskEnvironment` requires that release,
  so pnpm 10.7.1 and 10.28.0 were provisioned under `~/.cache/swarm-capability-tools/` (10.33.2
  as well, while checking the rejected `5cd9e6767`).
- Each hidden evaluator runs a behaviour check and a separate kept-behaviour check. Validation
  runs the kept-behaviour check alone over the base, where it passes for all three tasks.

## Accepted

All validated with the comparison's own scorers (`scripts/comparison/checks.mjs`,
`change-policy.mjs`, `workspace.mjs`, read from the review worktree; `checks.mjs`,
`change-policy.mjs`, `schema.mjs` and `validate.mjs` are unchanged from `c494db30b` to `3f3881bd0`,
and `workspace.mjs` gained, at `028ef2e20` during validation, only an `.aider*` patch exclusion
and a snapshot helper, neither used by these readings):
the base fails the visible check and the executed hidden evaluator, while the kept-behaviour check
passes on the base; the reference (the upstream commit's whole diff) passes the visible check, the
project tests, the hidden evaluator and the allowed-change policy, and introduces no lint failure;
every faulty control fails the hidden evaluator; the alternative and the absence-assertion
control pass it. One validation run per task (`sealed/validation-log.jsonl`); no correction was
needed.

| Task | Family | Faulty fail | of which break kept behaviour | Configuration-hiding fail | Alternative | Absence-assertion | Base install + project tests |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ufo `3c4b43de1` (base `7959de5b4`) | 1 API change | 6/6 | 3/3 | n/a | passes | passes | 7.8 s + 1.6 s |
| ufo `eb2994547` (base `5fb179d51`) | 2 bug fix | 5/5 | 2/2 | n/a | passes | passes | 8.4 s + 1.7 s |
| nanoid `a069b8f22` (base `a58703bd9`) | 3 transformation | 5/5 | 1/1 | 5/5 | passes | passes | 23.1 s + 4.6 s |

The five configuration-hiding controls of the transformation task are the rule's list: a test
glob narrowed, a lint file ignored, a failure swallowed, a success printed, and a build output
left unwritten, each hiding real damage behind a package.json edit.

## Candidates considered (335: 3 accepted, 332 rejected)

The full list with every reason is `scan/considered.json` and the registry's `candidates`.

Family 1, unjs/ufo: `8515b2439` (documentation only: README and JSDoc comment lines), then
`3c4b43de1` accepted.

Family 2, unjs/ufo: `5cd9e6767` rejected: its base does not install with the rule's command
(`npm install --before=...` fails with ERESOLVE: devDependency typescript ^6.0.3 against unbuild
3.6.1's peerOptional typescript ^5.9.2; the repository commits only pnpm-lock.yaml); then
`eb2994547` accepted.

Family 3 (ufo refused by the span guard):

- postcss/postcss, 110 candidates: none moves a project file with a configuration edit that
  follows it. The ones with renames: `89a6b7440` and `2524fd7ba` move documentation only;
  `b869683ef` moves tests while replacing the test runner (changes how checks run, which the
  allowed-change policy rejects); `4d74d4a4c` moves code out of the repository; `a6c575f55` moves
  fixtures with no configuration edit; `9bb85af7b` rewrites code (not mechanical). The rest rename
  no file (tooling, formatter, CI, dependency or API-member renames).
- jprichardson/node-fs-extra, 115: `8f79dcd22` moves lib/ folders but edits no configuration,
  build or script file; `32a5daf7b` is a declared partial move of two test files after which the
  project's own npm test no longer runs them (the reference itself narrows the test run); the
  other moves (2014-2015) edit no configuration file; the rest move nothing.
- micromatch/picomatch, 4: `2dcf16f3c` moves three modules with substantial rewrites and no
  configuration edit; the others move nothing.
- ljharb/qs, 40: no file is moved in any.
- Rich-Harris/magic-string, 27: `669218be4` moves and splits tests but edits vitest.config.ts, a
  policy-protected runner configuration; `2fbf3b4db` replaces the test runner; the others move
  nothing or change the module interface.
- unjs/pathe 3, unjs/defu 4: no file is moved in any.
- ai/nanoid: 27 newer candidates move no file (tooling, CI, publishing, export-format changes);
  then `a069b8f22` accepted.

Not reached: every repository after ufo for families 1 and 2; for family 3 every repository after
nanoid, and nanoid's candidates older than `a069b8f22`.

## Notes for the implementer

- Task ids: `ufo-feature-filter-query`, `ufo-bugfix-base-prefix-boundary`,
  `nanoid-refactor-module-subdirectories`. Bases, task text, visible checks, install and test
  argv, deliverables and digests are in `public-summary.json`.
- The two ufo evaluators overlay the upstream commit's own test file (displacing a candidate's
  edit to that path) before their written checks; the nanoid evaluator overlays nothing and runs
  the candidate's own suite.
- The harness lockfiles must be registered as the block's `harnessLockfiles` under the input root
  `~/.cache/swarm-study-2026-10-23c/heldout-inputs`.
- Reference commits are in `~/.cache/swarm-comparison/mirrors` (`unjs__ufo.git`,
  `ai__nanoid.git`, and the considered repositories' mirrors), which `launch-config.mjs` already
  denies to every launch. The sealed directory `~/.cache/swarm-heldout-2026-10-23c` is not yet in
  any manifest and must be added to the block's `isolation.protectedRoots` before the first launch.
- Hazard: nanoid's tracked `yarn.lock` is rewritten by any npm install. The task's own install
  restores it, but an install an arm runs itself during its launch (for example Swarm's
  `--install`) leaves it modified, and the change would appear in that arm's patch. The scorer is
  unaffected (its install restores the file), but patch-size accounting would not be.
- The harness's deliverable lines ask every task for a new regression test that fails on the
  current code; for the transformation task the upstream change adds none (it only follows the
  moved paths in one test file), and the task text asks for none.
