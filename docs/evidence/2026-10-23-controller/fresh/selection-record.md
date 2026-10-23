# Fresh block 2 selection record

Prepared by the evaluator author under
the registered rule `docs/evidence/2026-10-23-controller/heldout-2-selection-rule.md` (registered
in `aba45f0d1`), which takes block 1's feasibility conditions, with no model inference of any kind.
The sealed registry (`sealed/registry.json`) holds the full validation outputs and stays sealed
until the block is scored.

## Repository order and exposure check

Recorded at 2026-10-23T12:59:35Z in `scan/repository-order.json`
(`sha256:c5ab44c467a19b2c2a20b62cc45561249979d4996d60a5ce2adac49ae5a43c0f`), before any
candidate repository was cloned or any history, change, test or evaluator was read (the
markdown-it and svgo mirrors were created at 13:00:09Z and 13:05:27Z):

1. markdown-it/markdown-it
2. svg/svgo
3. unjs/ufo
4. postcss/postcss
5. jprichardson/node-fs-extra
6. micromatch/picomatch
7. ljharb/qs
8. Rich-Harris/magic-string
9. unjs/pathe
10. unjs/defu
11. ai/nanoid
12. pmndrs/zustand

Exposure check (`scan/repo-exposure.json`): `owner/name` and the mirror spelling `owner__name`,
case-insensitive, over every tracked file under `docs/evidence/` and `scripts/comparison/` at
`aba45f0d1b39d6c27629c86962092b067e7d41ae`, read from git (16,355 files, 169 `.br`/`.gz`
archives expanded). Each of the twelve has zero matches. Repositories excluded by the same check
before the order was fixed: tj/commander.js (20 files), eemeli/yaml (5), pillarjs/path-to-regexp (1),
jshttp/cookie (1), chalk/chalk (4), validatorjs/validator.js (3), moment/luxon (1),
cheeriojs/cheerio (8), koajs/koa (16), expressjs/express (2).

A second scan (`scan/commit-exposure.json`, block 1's commit-prefix method) searched every tracked
file of the project at the same commit (18,192 files, 178 archives expanded) for the first eight
hex digits of every considered candidate's change and base commits: no match.

## Interpretation

- Families are filled in the rule's order (1 bounded API change, 2 mechanical multi-file
  transformation, 3 bug fix). For each family, repositories are taken in the order above and,
  within a repository, the default branch's first-parent history newest first from the head
  recorded at clone time (markdown-it `a8c00d474`, svgo `e4cb29beb`).
- Subject keywords are whole words, case-insensitive: family 1 feat, feature(s), add(s/ed/ing),
  support*, option*, compat*; family 2 rename(s/d/ing), move(s/d)/moving, refactor*, migrat*;
  family 3 fix(es/ed/ing). A keyword match is necessary, not sufficient. (A first listing used
  `add\w*`, which also matched "address"; the corrected whole-word list was used for every
  decision, and the one extra commit it surfaced, a fix, is not a family-1 candidate.)
- Span guard: a candidate is not taken where the families still open could no longer bring the
  block to two repositories.

## Accepted

All validated with the comparison's own scorers (`scripts/comparison/checks.mjs`,
`change-policy.mjs`, `workspace.mjs` read from the registration worktree): the base fails the
visible check and the executed hidden evaluator; the reference (the upstream commit's whole diff)
passes the visible check, the project tests, the hidden evaluator and the allowed-change policy;
the visible check passes the project's lint; every faulty control fails the hidden evaluator; the
alternative and the absence-assertion control pass it.

| Task | Family | Faulty controls failing | Alternative | Absence-assertion | Base install + project tests |
| --- | --- | --- | --- | --- | --- |
| markdown-it `5915b84a6` | 1 API change | 5/5 | passes | passes | 1.2 s + 4.4 s |
| markdown-it `2b49966fa` | 2 mechanical transformation | 4/4 | passes | passes | 1.1 s + 3.7 s |
| svgo `3db3ef33e` | 3 bug fix | 6/6 | passes | passes | 19.0 s + 3.3 s |

Installs: markdown-it commits `package-lock.json` (`npm ci --ignore-scripts`); svgo commits only
a pnpm lockfile, so `npm install --ignore-scripts --no-audit --no-fund
--before=2026-10-23T00:00:00.000Z`. svgo's pnpm patch to its sax dependency (it removes sax's
stream API, unused by svgo) is not applied by npm; the base's tests pass without it.

## Candidates considered (17: 3 accepted, 14 rejected)

Family 1, markdown-it/markdown-it:

- `1e8ab89ca` doc: add changelog to menu: documentation only.
- `3bc8e2dc5` Add TS types: a packaging and build change (declaration files generated from the
  existing sources, package.json exports, a new build dependency); it adds no option, method or
  signature and changes no behaviour.
- `5915b84a6`: accepted.

Family 2, markdown-it/markdown-it:

- `f73cb76a2` doc: rename files: documentation only.
- `7d365fe3b` doc: migration info: documentation only.
- `35cc740d2` doc: refactor navigation: documentation only.
- `76dc0e6ff` Rename package doc/demo publish scripts: one authored file.
- `b0520a860`, `7f0139ce0`, `206651508`, `003b77a42`, `1f4eb333c`, `2958874ca` (TypeScript
  migration passes 7 to 2): type annotations; none renames or moves files, identifiers or import
  paths (`003b77a42` is one systematic edit over 32 files, but of annotations, not a rename).
- `b46631d17` Move `callable` wrapper to upper level: not behaviour-unchanged and not a rename:
  one module's default export changes from the callable wrapper to the bare class, and the
  five-file part replaces a type alias with a type-only import whose path is unchanged.
- `2b49966fa`: accepted.

Family 3:

- markdown-it/markdown-it: the whole pool refused by the span guard (families 1 and 2 are both
  markdown-it); its candidates were not read.
- svg/svgo `38e8a6f47` fix: publish releases from detached tags: a CI workflow change only, no
  non-test source.
- svg/svgo `3db3ef33e`: accepted.

Not reached: svg/svgo for families 1 and 2, and the ten later repositories.

## Correction before registration

The first validation run of the API-change task (kept in `sealed/validation-log.jsonl`) failed
its alternative control: the upstream test requires the new token's `meta` to be a
null-prototype object, which is how the project's link and image tokens already build theirs,
and the task text had not said so. The task text now states it, the hidden evaluator checks it,
and the alternative was rebuilt accordingly; the second run met every expectation. Nothing else
changed between the runs.

## Notes for the implementer

- The hidden evaluators of the first and third tasks overlay the upstream commit's own test file
  (displacing a candidate's edit to that path) and then run a written behaviour check; the second
  task overlays nothing and runs the candidate's own suite plus the behaviour check. Checks that
  read source judge imports, exports-from and `require` calls, never a name inside a string or an
  assertion.
- The API-change task's base (`6c60e2157`) postdates the rename task's upstream commit, so that
  task's base tree contains the `.ts` layout the rename task asks for. The rename task's text
  states its full rule, and launches are denied each other's workspaces, so this gives no task
  material it lacks.
- Reference commits are in `~/.cache/swarm-comparison/mirrors` (`markdown-it__markdown-it.git`,
  `svg__svgo.git`), which `launch-config.mjs` already denies to every launch. The sealed
  directory `~/.cache/swarm-heldout-2026-10-23` is not yet in any manifest and must be added to
  the block's `isolation.protectedRoots` before the first launch.
