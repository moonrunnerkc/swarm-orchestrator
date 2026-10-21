# Results

Rendered 2026-10-21T14:51:56.901Z from 1 record(s) of the 1 launches the manifest froze (1 completed, 0 infrastructure attempt(s)); manifest digest `sha256:d7ed23ed74f6dcfa891b6d220c3c895cecf6f7d65a2ecf409b91c5e37eae81d1`. Each count is against the number of launches started for that arm; a task not yet launched is "not run". The protocol is [protocol.md](../protocol.md) (this link repointed by hand after rendering: the publisher writes a sibling link, and launch 2's records sit one directory below the protocol).

| measure | swarm | opencode |
| --- | --- | --- |
| tasks started | 1 | 0 |
| infrastructure failures (not the arm's doing) | 0 | 0 |
| correct completion (hidden oracle passed) / started | 0 / 1 | 0 / 0 |
| correct without any scripted correction / started | 0 / 1 | 0 / 0 |
| scripted corrections used, total (runs with 0 / 1 / 2) | 0 (1 / 0 / 0) | 0 (0 / 0 / 0) |
| visible checks still failing after the protocol | 0 | 0 |
| reported success while the hidden oracle failed | 1 | 0 |
| agent wall time, all runs | 3.6 min | 0.0 min |
| agent wall time, correct runs only | 0.0 min | 0.0 min |
| preparation wall time, all runs (install, outside the agent) | 0.2 min | 0.0 min |
| tokens, all runs with known usage | 912,945 over 1 runs (0 unknown) | 0 over 0 runs (0 unknown) |
| tokens per correct task (known usage) | no correct run with known usage | no correct run with known usage |

| task | swarm | opencode |
| --- | --- | --- |
| sinon-bugfix-stub-accessor-calls-v2 | fail | not run |
