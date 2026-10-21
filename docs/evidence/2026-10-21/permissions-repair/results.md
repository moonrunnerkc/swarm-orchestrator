# Results

Rendered 2026-10-21T03:17:15.856Z from 1 record(s) of the 1 launches the manifest froze (1 completed, 0 infrastructure attempt(s)); manifest digest `sha256:186041e5bbaae33e3286287f4080e506800cdb649f69144538347cc1397f15a4`. Each count is against the number of launches started for that arm; a task not yet launched is "not run". The protocol is [protocol.md](protocol.md).

| measure | swarm | opencode |
| --- | --- | --- |
| tasks started | 1 | 0 |
| infrastructure failures (not the arm's doing) | 0 | 0 |
| correct completion (hidden oracle passed) / started | 0 / 1 | 0 / 0 |
| correct without any scripted correction / started | 0 / 1 | 0 / 0 |
| scripted corrections used, total (runs with 0 / 1 / 2) | 0 (1 / 0 / 0) | 0 (0 / 0 / 0) |
| visible checks still failing after the protocol | 1 | 0 |
| reported success while the hidden oracle failed | 0 | 0 |
| agent wall time, all runs | 8.2 min | 0.0 min |
| agent wall time, correct runs only | 0.0 min | 0.0 min |
| preparation wall time, all runs (install, outside the agent) | 0.2 min | 0.0 min |
| tokens, all runs with known usage | 1,992,179 over 1 runs (0 unknown) | 0 over 0 runs (0 unknown) |
| tokens per correct task (known usage) | no correct run with known usage | no correct run with known usage |

| task | swarm | opencode |
| --- | --- | --- |
| minimatch-bugfix-partial-globstar | fail, visible unresolved | not run |
