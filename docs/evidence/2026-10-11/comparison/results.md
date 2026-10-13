# Results

Rendered 2026-10-13T18:44:16.151Z from 40 record(s) of the 40 launches the manifest froze (40 completed, 0 infrastructure attempt(s)); manifest digest `sha256:bf06dda83c15629a2067db1be6035521d7332585c5728dc45234a9c365fd6632`. Each count is against the number of launches started for that arm; a task not yet launched is "not run". The protocol is [protocol.md](protocol.md).

| measure | swarm | opencode |
| --- | --- | --- |
| tasks started | 20 | 20 |
| infrastructure failures (not the arm's doing) | 0 | 0 |
| correct completion (hidden oracle passed) / started | 5 / 20 | 4 / 20 |
| correct without any scripted correction / started | 5 / 20 | 4 / 20 |
| scripted corrections used, total (runs with 0 / 1 / 2) | 9 (14 / 3 / 3) | 1 (19 / 1 / 0) |
| visible checks still failing after the protocol | 14 | 16 |
| reported success while the hidden oracle failed | 1 | 0 |
| agent wall time, all runs | 462.0 min | 591.6 min |
| agent wall time, correct runs only | 28.4 min | 95.7 min |
| preparation wall time, all runs (install, outside the agent) | 0.8 min | 0.8 min |
| tokens, all runs with known usage | 9,666,754 over 20 runs (0 unknown) | 191,598,975 over 20 runs (0 unknown) |
| tokens per correct task (known usage) | 355,032 over 5 | 4,755,917 over 4 |

| task | swarm | opencode |
| --- | --- | --- |
| fxp-bugfix-uint8array-utf8 | fail, visible unresolved | fail, visible unresolved |
| fxp-feature-end-index | fail (+2 corr.), visible unresolved | fail, visible unresolved |
| fxp-feature-strict-reserved-names | fail, visible unresolved | fail, visible unresolved |
| fxp-refactor-unpaired-set | fail, visible unresolved | pass |
| fxp-upgrade-strnum | pass | fail, visible unresolved |
| js-yaml-bugfix-flow-colon-quoting | fail, visible unresolved | fail, visible unresolved |
| js-yaml-bugfix-timestamp-early-years | fail, visible unresolved | fail, visible unresolved |
| js-yaml-feature-max-aliases | fail (+2 corr.), visible unresolved | fail, visible unresolved |
| js-yaml-refactor-is-plain-object | pass | pass |
| js-yaml-upgrade-vite-workerpool | pass | fail, visible unresolved |
| marked-bugfix-www-case | fail, visible unresolved | fail, visible unresolved |
| marked-feature-def-token | fail (+1 corr.), visible unresolved | fail (+1 corr.), visible unresolved |
| marked-refactor-strict-exec | pass | pass |
| marked-upgrade-cheerio | pass | pass |
| minimatch-bugfix-drive-letter | fail (+1 corr.), visible unresolved | fail, visible unresolved |
| minimatch-bugfix-partial-globstar | fail (+1 corr.), visible unresolved | fail, visible unresolved |
| minimatch-upgrade-tap-types-node | fail, visible unresolved | fail, visible unresolved |
| yargs-parser-bugfix-count-sentinel | fail, visible unresolved | fail, visible unresolved |
| yargs-parser-bugfix-negation-unknown | fail (+2 corr.), visible unresolved | fail, visible unresolved |
| yargs-parser-upgrade-toolchain | fail | fail, visible unresolved |
