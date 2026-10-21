| measure | swarm | opencode |
| --- | --- | --- |
| tasks started | 3 | 3 |
| infrastructure failures (not the arm's doing) | 0 | 0 |
| correct completion (hidden oracle passed) / started | 2 / 3 | 1 / 3 |
| correct without any scripted correction / started | 2 / 3 | 1 / 3 |
| scripted corrections used, total (runs with 0 / 1 / 2) | 0 (3 / 0 / 0) | 0 (3 / 0 / 0) |
| visible checks still failing after the protocol | 1 | 2 |
| reported success while the hidden oracle failed | 0 | 1 |
| agent wall time, all runs | 22.2 min | 16.0 min |
| agent wall time, correct runs only | 14.0 min | 2.6 min |
| preparation wall time, all runs (install, outside the agent) | 0.7 min | 0.1 min |
| tokens, all runs with known usage | 4,944,908 over 3 runs (0 unknown) | 3,016,952 over 3 runs (0 unknown) |
| tokens per correct task (known usage) | 1,615,537 over 2 | 904,352 over 1 |

| task | swarm | opencode |
| --- | --- | --- |
| dotenv-bugfix-fast-parser-line-ends | fail, visible unresolved | fail, visible unresolved |
| sinon-bugfix-mock-oncall-expectations | pass | pass |
| sinon-bugfix-stub-accessor-calls | pass (supplemental scoring) | fail, visible unresolved |
