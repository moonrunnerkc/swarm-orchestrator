# Every model-powered launch and probe of this work, in order

Each launch is entered here before it starts, with its purpose, build and configuration; its
duration, usage and outcome are filled in after. Readiness sequences are the runner's own, run
inside the launch command before dispatch, listed with the launch they preceded, their requests and
usage apart from the task's. The allowance is exactly two launches of at most 10 minutes, at most
two readiness sequences of at most 90 seconds and three requests each per launch, and twenty minutes
of task wall in all, with no replacement ([protocol.md](protocol.md)). The rehearsals of
[rehearsal-control/](rehearsal-control/record.json) and [rehearsal-treatment/](rehearsal-treatment/record.json)
used no model and are not launches.

| # | arm | build | started (UTC) | readiness | task wall | usage | outcome |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | control (`repair-boundary.mjs --arm control --mode live`) | `c538331f0` (`~/.cache/swarm-comparison/tools/swarm-c538331f0`) | entered before start; filled after | | | | |
| 2 | treatment (`repair-boundary.mjs --arm treatment --mode live`) | `afa2deedc` (`~/.cache/swarm-comparison/tools/swarm-afa2deedc`) | entered before start; filled after | | | | |
