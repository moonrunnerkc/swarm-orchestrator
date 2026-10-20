# Every model-powered launch and probe of this work, in order

Each launch is entered here before it starts, with its purpose, build and configuration; its
duration, usage and outcome are filled in after. Readiness sequences are the runner's own, run
inside the launch command before dispatch; they are listed with the launch they preceded, with
their requests and usage apart from the task's. The allowance is one launch of at most 15 minutes,
at most two readiness sequences of at most 90 seconds and three requests each, and twenty minutes
of probe and task wall in all, with no replacement ([protocol.md](protocol.md)). The fixture runs
of [README.md](README.md) section 4 used no model and are not launches.

| # | configuration | build | manifest | started (UTC) | readiness | agent minutes | usage | outcome |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Swarm with `--plan-checks`, `marked-bugfix-www-case` | `826e60e83` (product source `005d5eb8d`; `~/.cache/swarm-comparison/tools/swarm-826e60e83`) | [manifest-plan-checks.json](manifest-plan-checks.json) (`sha256:a440cbd13050...`, `dist/` tree `sha256:4a7d6f655d0c...`, 862 files) | entered 2026-10-20 ~05:00 before the launch; filled in after | | | | |
