# Results

Rendered 2026-10-21T21:49:46.529Z from 4 record(s) of the 4 launches the manifest froze (3 completed, 1 infrastructure attempt(s)); manifest digest `sha256:36d8d71b8418639b79bcc2fc7268466e91e26cf126d09c4088557bea134f155b`. Each count is against the number of launches started for that arm; a task not yet launched is "not run". The protocol is [protocol.md](protocol.md).

| measure | swarm | opencode |
| --- | --- | --- |
| tasks started | 2 | 2 |
| infrastructure failures (not the arm's doing) | 1 | 0 |
| correct completion (hidden oracle passed) / started | 0 / 2 | 2 / 2 |
| correct without any scripted correction / started | 0 / 2 | 2 / 2 |
| scripted corrections used, total (runs with 0 / 1 / 2) | 0 (2 / 0 / 0) | 0 (2 / 0 / 0) |
| visible checks still failing after the protocol | 2 | 0 |
| reported success while the hidden oracle failed | 0 | 0 |
| agent wall time, all runs | 13.2 min | 2.9 min |
| agent wall time, correct runs only | 0.0 min | 2.9 min |
| preparation wall time, all runs (install, outside the agent) | 1.1 min | 0.1 min |
| tokens, all runs with known usage | 1,565,780 over 2 runs (0 unknown) | 850,041 over 2 runs (0 unknown) |
| tokens per correct task (known usage) | no correct run with known usage | 425,021 over 2 |

| task | swarm | opencode |
| --- | --- | --- |
| mocha-bugfix-long-prefix-short-alias | fail, visible unresolved | pass |
| mocha-bugfix-unparse-attached-values | infrastructure | pass |
