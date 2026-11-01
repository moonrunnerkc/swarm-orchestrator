# Known issues

Defects found while working on something else, each with a reproduction, kept here instead of
fixed in an unrelated change. A fixed entry is removed in the commit that fixes it.

## A relative path after `cd` is resolved against the workspace root

The shell reader checks every path against the workspace root and does not follow a `cd` earlier
in the same command, so `cd src/tracemantle && grep -rn x ../../tests` is refused because
`../../tests` resolves above the workspace, though after the `cd` it names the workspace's own
`tests`. The error is in the refusing direction: a `cd` target is itself checked, and resolving
from the root climbs no less than resolving from below it. Four of the 46 path refusals in the
2026-11-01 acceptance sessions were of this kind (20261101T053630-ed48ab record 37,
20261101T144722-d7f096 records 11, 14 and 17). Reproduce: in a `swarm run`, have the model run
`cd src && cat ../package.json`.

## An option's attached value is not checked for a program with no argument table

For a program with no table in `src/tools/argument-grammars.ts`, the shell reader offers a word
like `--git-dir=/elsewhere/.git` whole and in pieces split on whitespace and after a colon, never
after the `=`. The whole word resolves as a relative name inside the workspace, so the guard
allows a path it would refuse given alone. This is in the allowing direction. Reproduce:
`readShellCommand("git --git-dir=/elsewhere/.git log")` offers `--git-dir=/elsewhere/.git` and
`log`, both allowed under a workspace of `/work/repo`, while `cat /elsewhere/.git` is refused. The
same holds for `node --require=/tmp/x.js`. Offering the text after `=` would close it, at the cost
of refusals on option values that only look like paths.
