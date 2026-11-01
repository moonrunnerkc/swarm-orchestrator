# Known issues

Defects found while working on something else, each with a reproduction, kept here instead of
fixed in an unrelated change. A fixed entry is removed in the commit that fixes it.

## Path-shaped text inside a quoted script is refused as a path

The shell reader offers each path-shaped piece of a quoted multi-word argument to the path policy,
so a sed address (`sed -n '/function reproCommand/,/}/p' file`) or test source written through
`printf '...' > file` holding `/--max-budget-usd` is refused as a path outside the workspace. The
error is in the refusing direction, and a sed script can itself write files (`w path`), so the
reader is left as it is. Measured on 2026-11-01: about 8 of 39 path refusals across that day's
acceptance sessions were of this kind, each costing the model one step; the other 31 were paths
outside the workspace. Reproduce: in a `swarm run`, have the model run the sed command above.
