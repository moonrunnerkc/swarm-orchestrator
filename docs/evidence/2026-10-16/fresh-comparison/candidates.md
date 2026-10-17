# Fresh comparison candidates, selection criteria and exclusions

Declared before either tool attempted any of these tasks.

## The pool

The pool was mined on 2026-10-16 from public npm libraries. None of their repositories appears
anywhere else in this repository: no repository name matches, and `git grep` of every commit
prefix over the tree finds none. No task here was used by an earlier comparison, the pilot,
the development launches or any repair.

Every candidate was executed from a fresh clone on Node v24.15.0, installed with
`npm ci --ignore-scripts`. Historical public changes may have appeared in a model's training data,
so "fresh" means fresh to this experiment and this repository.

## Criteria

These are the 2026-10-15 criteria
([../../2026-10-15/comparison/candidates.md](../../2026-10-15/comparison/candidates.md)), with
two additions.

1. A maintainer-authored or maintainer-merged change on a public repository with a committed
   `package-lock.json`, 5 to 80 source lines, whose requirement can be stated without naming
   the change.
2. The base installs from its lockfile with scripts off. Its own suite runs on Node 24 in under
   two minutes, with no browser, container, paid service or network beyond the npm registry.
3. The upstream tests, or a task-authored hidden check, fail on the base and pass on the
   reference. They must also reject at least one plausible wrong or partial implementation. All
   of this is shown by executing them with the harness's own scorer.
4. One task of each kind, across at least three repositories.
5. At least one task with security-relevant behaviour.
6. Fits a ten-minute launch, including corrections and Swarm's internal verification.
7. **Added: at least one task whose change spans interacting files.**
8. **Added: nontrivial behavioural requirements are preferred over one-line changes.**

## Verified pool

Eleven candidates were verified, with an executed reference, base and wrong patch for each.

| id | kind | repository | lines | notes |
| --- | --- | --- | --- | --- |
| css-what-bugfix-deep-nesting | bug fix | fb55/css-what | 46 | stack-depth denial of service |
| json5-bugfix-lone-surrogates | bug fix | json5/json5 | 28 | lone surrogates; 100% coverage gate |
| sax-bugfix-xml-char-refs | bug fix | isaacs/sax-js | 20 | XML Char boundaries |
| domutils-bugfix-uniquesort-last-occurrence | bug fix | fb55/domutils | 15 | needs a task-authored extra check |
| **tar-bugfix-negative-size** | bug fix | isaacs/node-tar | 19 | **cross-file** (`header.ts`, `pax.ts`); security advisory GHSA-8x88-c5mf-7j5w |
| **css-select-feature-lang** | feature | fb55/css-select | 68 | RFC 4647 language matching, inheritance |
| sax-feature-entity-limits | feature | isaacs/sax-js | 18 | entity-expansion limits |
| **json5-refactor-parse-state-switch** | refactor | json5/json5 | 50 | structure checkable by regular expression |
| fake-timers-refactor-timers-map | refactor | sinonjs/fake-timers | 34 | a missed site hangs the suite |
| css-what-upgrade-vitest-5 | upgrade | fb55/css-what | 1 + lockfile | test runner only |
| **domutils-upgrade-htmlparser2-12** | upgrade | fb55/domutils | 1 + lockfile | effect observable through parsing |

## Chosen, with why

The four chosen tasks come from four repositories.

| task | kind | why |
| --- | --- | --- |
| tar-bugfix-negative-size | bug fix | It is the only cross-file candidate (criterion 7) and a published security fix (criterion 5). The wrong patch fixes `header.ts` only: it passes the visible check, and the hidden oracle still rejects it. |
| css-select-feature-lang | feature | It has the most behavioural requirements in the pool: comma lists, quotes, inheritance, `xml:lang` precedence, extended filtering with wildcards and singletons. |
| json5-refactor-parse-state-switch | refactor | Its structure is stated in the task and checked by rule. A missing `return` passes the structure check and the suite rejects it. It is preferred to fake-timers, whose wrong implementations hang the suite until the scorer's timeout. |
| domutils-upgrade-htmlparser2-12 | upgrade | The dependency changes parsing behaviour, and a task-authored check observes that. It is preferred to css-what's test-runner bump. |

## Caveats, disclosed before the freeze

- **tar:**
  - The base's `npm test` fails tap's 100% coverage rule on one branch of `src/pax.ts`, although
    every assertion passes. The project test, for both tools and the scorer, is therefore
    `npm test -- --allow-incomplete-coverage`, and the task text says so.
  - The tests import the built `dist`, so `npm run prepare` builds before every check.
  - The task-authored extra check covers the decoded-block and extended-header paths and the
    zero boundary, which the upstream tests do not exercise.
- **css-select:** the upstream tests do not exercise singleton subtags or empty language values,
  although the task text states both. A patch that gets them wrong can pass the frozen oracle.
  This is a known coverage limit, stated now.
- **json5:** `npm test` enforces 100% coverage of `lib`, so a default branch nothing reaches fails
  it. The structural rules are written as lookarounds, because the scorer compiles them without
  the multiline flag.
- **domutils:** the maintainer declared `~12.0.0`. The task asks for the exact pin, so the
  reference is the maintainer's change with the declaration rewritten. The wrong patch, a caret
  range, installs the right version, and only the declaration rule rejects it.

## Excluded

- **The seven verified candidates not chosen above:**
  - each repository carries at most one task;
  - the other candidate of each kind was judged weaker on criteria 7 and 8 or riskier for the
    instrument (tap suites that need stdin closed, a suite that hangs on a wrong patch).
- **Fifteen rejected by mining:**
  - node-glob's brace limit can run the base out of memory, and its message disagrees with its
    code;
  - linkify-it's upstream test passes on the base;
  - several were too thin, mixed with unrelated changes, chained on one file, or had older bases.

  The miner's full list and reasons are kept with the pool.
- **Every task of the 2026-10-11, 2026-10-14 and 2026-10-15 sets.**

## Instrument repairs found while validating, before the freeze

Each repair has its regression.

- **Comparison checkouts lived under `~/.cache`:**
  - css-select's and domutils' Biome configurations exclude every path with a dot-named
    component, so their lint, and the `npm test` that runs it, failed at the base for every arm;
  - the harness checkouts now live under `~/swarm-comparison-work`.
- **Swarm's own final-verification checkout lived under `~/.swarm`, with the same effect:** on the
  host it now uses the system temporary directory.
- **node-tar's `.gitignore` ignores every root path it does not name:**
  - the harness now commits the visible check with `--force`;
  - Swarm's inspection bonds, written at the root, were invisible to the gates they bond. They now
    move beside a changed file.
- **The scorer wrote task-authored hidden files before the project's own tests,** whose ESLint run
  then linted them. They are now written just before the extra checks they serve, as the schema
  states, and removed after.
