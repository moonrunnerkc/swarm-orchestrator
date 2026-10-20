# Results

Rendered 2026-10-20T23:50:33.678Z from 2 record(s) of the 2 launches the manifest froze (2 completed, 0 infrastructure attempt(s)); manifest digest `sha256:45bd0be08b4c06c6f79747133dc3ef19611abd54fbc418f151a1d007a5c6c1ed`. Each count is against the number of launches started for that arm; a task not yet launched is "not run". The protocol is [protocol.md](protocol.md).

| measure | swarm | opencode |
| --- | --- | --- |
| tasks started | 1 | 1 |
| infrastructure failures (not the arm's doing) | 0 | 0 |
| correct completion (hidden oracle passed) / started | 0 / 1 | 0 / 1 |
| correct without any scripted correction / started | 0 / 1 | 0 / 1 |
| scripted corrections used, total (runs with 0 / 1 / 2) | 0 (1 / 0 / 0) | 0 (1 / 0 / 0) |
| visible checks still failing after the protocol | 1 | 1 |
| reported success while the hidden oracle failed | 0 | 1 |
| agent wall time, all runs | 7.8 min | 3.4 min |
| agent wall time, correct runs only | 0.0 min | 0.0 min |
| preparation wall time, all runs (install, outside the agent) | 0.2 min | 0.0 min |
| tokens, all runs with known usage | 2,513,621 over 1 runs (0 unknown) | 1,149,636 over 1 runs (0 unknown) |
| tokens per correct task (known usage) | no correct run with known usage | no correct run with known usage |

| task | swarm | opencode |
| --- | --- | --- |
| minimatch-bugfix-partial-globstar | fail, visible unresolved | fail, visible unresolved |
