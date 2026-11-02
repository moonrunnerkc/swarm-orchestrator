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
