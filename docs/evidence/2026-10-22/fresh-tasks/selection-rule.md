# Fresh task eligibility, written 2026-10-22 before any candidate commit was read

Fixed before scanning: no commit list, diff, test or upstream solution of these repositories was
opened for this stage before this file was written. The scan that applies it is
[scan.mjs](scan.mjs); its output is [scan.json](scan.json).

## Repositories

The npm repositories already mirrored on this host (`~/.cache/swarm-comparison/mirrors`) that no
launch of this project has used: none appears as a task's repository in any manifest under
`docs/evidence` or in `scripts/comparison/tasks.mjs`. On 2026-10-22 that is, in alphabetical
order: `acornjs/acorn`, `fb55/entities`, `fb55/htmlparser2`, `jsdom/whatwg-url`. (The 2026-10-14
pilot browsed all four and launched none; `htmlparser2` appears elsewhere only as a dependency
name.) Different repositories are preferred, so at most one task is taken from each.

## A candidate commit

On the default branch, newest first, committed on or after 2024-01-01, with one parent:

1. its subject begins with "fix" (any case: `fix:`, `fix(scope):`, `Fix ...`);
2. it changes at least one test file (a path under `test/`, `tests/`, `__tests__/`, or named
   `*.test.*` / `*.spec.*`) and one to three other source files (`.js`, `.mjs`, `.cjs`, `.ts`,
   `.mts`, `.cts`), with 4 to 80 changed lines in those source files together;
3. it changes nothing else but Markdown files;
4. its parent (the base) has a committed `package-lock.json`.

## Validated on this host (Node v24.15.0), in the scan's order

5. `npm ci --ignore-scripts` succeeds at the base and at the commit;
6. the base passes the project test command: the manifest's `test` script, or where that script
   also runs a linter, a build of another package, a browser or a network fetch, the narrowest
   script it runs that runs only the Node test suite;
7. the commit's own test files overlaid on the base fail under the hidden argv (the project's
   runner given those files), and the commit passes both that and the project test command.

## Which are used

The first candidate per repository that meets 1 to 7, repositories in the order above; the
first two repositories that yield one give the two tasks. A repository that yields none is
recorded with the reason. Nothing about either product's likely result enters the rule.

## Then, before any inference

Each task text is written from the base's observed behaviour and the commit's change, without
naming the commit or quoting its code, with the required behaviour, examples, what must not
change, the source location, the project test command and the deliverable "Add regression tests
for this behaviour to the project's existing test suite". The visible check is one assertion. The
hidden material is the commit's test files and a behaviour check covering every stated example
and representative preservation cases beyond them. The reference (the commit) must pass every
hidden reading and the allowed-change policy; the base must fail the hidden reading.
