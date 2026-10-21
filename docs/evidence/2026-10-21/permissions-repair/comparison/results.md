# Results

Rendered 2026-10-21T04:07:55.589Z from 6 record(s) of the 6 launches the manifest froze (5 completed, 1 infrastructure attempt(s)); manifest digest `sha256:914841de5a97f3aad8ab86a70f1324a12d6ae4240006e5259be228d5ce7cb9fc`. Each count is against the number of launches started for that arm; a task not yet launched is "not run". The protocol is [protocol.md](protocol.md).

| measure | swarm | opencode |
| --- | --- | --- |
| tasks started | 3 | 3 |
| infrastructure failures (not the arm's doing) | 1 | 0 |
| correct completion (hidden oracle passed) / started | 1 / 3 | 1 / 3 |
| correct without any scripted correction / started | 1 / 3 | 1 / 3 |
| scripted corrections used, total (runs with 0 / 1 / 2) | 0 (3 / 0 / 0) | 0 (3 / 0 / 0) |
| visible checks still failing after the protocol | 2 | 2 |
| reported success while the hidden oracle failed | 0 | 1 |
| agent wall time, all runs | 22.2 min | 16.0 min |
| agent wall time, correct runs only | 8.2 min | 2.6 min |
| preparation wall time, all runs (install, outside the agent) | 0.7 min | 0.1 min |
| tokens, all runs with known usage | 4,944,908 over 3 runs (0 unknown) | 3,016,952 over 3 runs (0 unknown) |
| tokens per correct task (known usage) | 1,773,288 over 1 | 904,352 over 1 |

| task | swarm | opencode |
| --- | --- | --- |
| dotenv-bugfix-fast-parser-line-ends | fail, visible unresolved | fail, visible unresolved |
| sinon-bugfix-mock-oncall-expectations | pass | pass |
| sinon-bugfix-stub-accessor-calls | infrastructure | fail, visible unresolved |
