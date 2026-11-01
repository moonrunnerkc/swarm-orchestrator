# Known issues

Defects found while working on something else, each with a reproduction, kept here instead of
fixed in an unrelated change. A fixed entry is removed in the commit that fixes it.

## A copied virtual environment runs through the original interpreter

`swarm run` copies the workspace's `.venv` into its managed worktree. Console scripts in the copy
(`.venv/bin/pytest`) keep the shebang of the original environment, and an editable install's
`.pth` file names the original source tree, so the agent's own test runs can import the user's
unchanged source. Reproduce: in a project installed with `pip install -e .`, run `swarm run` on a
task, then `cat <worktree>/.venv/bin/pytest | head -1` during the run. `.venv/bin/python -m pytest`
avoids the shebang; the editable path remains. Verification is not affected: it installs fresh in
a container.
