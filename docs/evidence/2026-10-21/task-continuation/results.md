# Results

Rendered 2026-10-21T16:46:06.571Z from 1 record(s) of the 1 launches the manifest froze (1 completed, 0 infrastructure attempt(s)); manifest digest `sha256:f10ddfb04f46154b219e8f94e76f5e7bcdfd10187b868d7ca32752cd446301f6`. Each count is against the number of launches started for that arm; a task not yet launched is "not run". The protocol is [protocol.md](protocol.md).

| measure | swarm | opencode |
| --- | --- | --- |
| tasks started | 1 | 0 |
| infrastructure failures (not the arm's doing) | 0 | 0 |
| correct completion (hidden oracle passed) / started | 1 / 1 | 0 / 0 |
| correct without any scripted correction / started | 1 / 1 | 0 / 0 |
| scripted corrections used, total (runs with 0 / 1 / 2) | 0 (1 / 0 / 0) | 0 (0 / 0 / 0) |
| visible checks still failing after the protocol | 0 | 0 |
| reported success while the hidden oracle failed | 0 | 0 |
| agent wall time, all runs | 4.7 min | 0.0 min |
| agent wall time, correct runs only | 4.7 min | 0.0 min |
| preparation wall time, all runs (install, outside the agent) | 0.2 min | 0.0 min |
| tokens, all runs with known usage | 1,011,623 over 1 runs (0 unknown) | 0 over 0 runs (0 unknown) |
| tokens per correct task (known usage) | 1,011,623 over 1 | no correct run with known usage |

| task | swarm | opencode |
| --- | --- | --- |
| sinon-bugfix-stub-accessor-calls-v2 | pass | not run |
