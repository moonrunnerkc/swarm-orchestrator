# Every model-powered launch of this work, in order

Each launch is entered here before it starts, with its purpose, build and configuration; its
duration, usage and outcome are filled in after. Agent minutes are the arm's own process wall,
from spawn to exit or kill. Preparation and scoring are reported apart. The allowance is two
launches of at most 15 minutes and 30 agent-minutes in all, with no replacement
([protocol.md](protocol.md)). The replays of [README.md](README.md) section 2 used no model and
are not launches.

| # | configuration | build | manifest | started (UTC) | agent minutes | usage | outcome |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | ordinary Swarm, no `--plan-checks`, `marked-bugfix-www-case` | `b470b55e2` (`~/.cache/swarm-comparison/tools/swarm-b470b55e2`, `dist/` tree `sha256:783649fab763...`) | [manifest-ordinary.json](manifest-ordinary.json) (`sha256:aeae93c91141...`) | 2026-10-20 02:49:55 | 13.3 | 3,755,780 tokens (3,729,542 input, 26,238 output) | **Hidden oracle fail; product `not accepted`, exit 1.** Final verification completed: regression fail, `tests` failed on the patch and not at the base. Three repairs: 1 kept, 2 rolled back (it broke the visible check), 3 withheld (0 ms left). Read in [README.md](README.md) section 6. |
| 2 | Swarm with `--plan-checks`, `marked-bugfix-www-case` | `b470b55e2`, as launch 1 | [manifest-plan-checks.json](manifest-plan-checks.json) (`sha256:911f8c340fd2...`) | (entered before start) | | | |
