# Pass 2 (2026-10-12 00:01Z to 08:57Z): a failed pass, reported, not the comparison

All forty launches completed and were scored under manifest digest
`sha256:bacf8f4ddfef329c1c7fd562bd39f20c7a08f694abb76c41364b8f38495e0f69` (Swarm revision
`0dd525358f44bcce153dcb503a9d13858d9e91d3`, OpenCode 1.14.48). Eleven of the Swarm arm's twenty
launches were refused by Swarm's own preflight before any model call, and four more ended on
defects named in [protocol.md](protocol.md), amendment 1. The tables are what the records say;
the Swarm column does not measure the agent on those fifteen tasks. The records themselves are
retained under `~/.cache/swarm-comparison/runs/bacf8f4ddfef329c/` with their digests in
[records-pass2.sha256](records-pass2.sha256).

| measure | swarm | opencode |
| --- | --- | --- |
| tasks started | 20 | 20 |
| infrastructure failures (not the arm's doing) | 0 | 0 |
| correct completion (hidden oracle passed) / started | 3 / 20 | 1 / 20 |
| correct without any scripted correction / started | 3 / 20 | 1 / 20 |
| scripted corrections used, total (runs with 0 / 1 / 2) | 30 (5 / 0 / 15) | 33 (2 / 3 / 15) |
| visible checks still failing after the protocol | 17 | 19 |
| reported success while the hidden oracle failed | 0 | 1 |
| agent wall time, all runs | 209.4 min | 310.8 min |
| agent wall time, correct runs only | 67.3 min | 15.6 min |
| preparation wall time, all runs (install, outside the agent) | 0.8 min | 0.8 min |
| tokens, all runs with known usage | 3,509,226 over 8 runs (12 unknown) | 2,574,194 over 18 runs (2 unknown) |
| tokens per correct task (known usage) | 125,060 over 3 | 377,803 over 1 |

| task | swarm | opencode |
| --- | --- | --- |
| fxp-bugfix-uint8array-utf8 | fail (+2 corr.), visible unresolved | fail (+2 corr.), visible unresolved |
| fxp-feature-end-index | fail (+2 corr.), visible unresolved | fail (+1 corr.), visible unresolved |
| fxp-feature-strict-reserved-names | fail (+2 corr.), visible unresolved | fail (+2 corr.), visible unresolved |
| fxp-refactor-unpaired-set | fail (+2 corr.), visible unresolved | fail (+2 corr.), visible unresolved |
| fxp-upgrade-strnum | pass | fail (+2 corr.), visible unresolved |
| js-yaml-bugfix-flow-colon-quoting | fail (+2 corr.), visible unresolved | fail (+2 corr.), visible unresolved |
| js-yaml-bugfix-timestamp-early-years | fail (+2 corr.), visible unresolved | fail (+2 corr.), visible unresolved |
| js-yaml-feature-max-aliases | fail (+2 corr.), visible unresolved | fail (+1 corr.), visible unresolved |
| js-yaml-refactor-is-plain-object | fail (+2 corr.), visible unresolved | fail (+2 corr.), visible unresolved |
| js-yaml-upgrade-vite-workerpool | pass | fail (+1 corr.), visible unresolved |
| marked-bugfix-www-case | fail (+2 corr.), visible unresolved | fail (+2 corr.), visible unresolved |
| marked-feature-def-token | fail (+2 corr.), visible unresolved | fail (+2 corr.), visible unresolved |
| marked-refactor-strict-exec | fail (+2 corr.), visible unresolved | pass |
| marked-upgrade-cheerio | pass | fail (+2 corr.), visible unresolved |
| minimatch-bugfix-drive-letter | fail (+2 corr.), visible unresolved | fail (+2 corr.), visible unresolved |
| minimatch-bugfix-partial-globstar | fail (+2 corr.), visible unresolved | fail (+2 corr.), visible unresolved |
| minimatch-upgrade-tap-types-node | fail, visible unresolved | fail, visible unresolved |
| yargs-parser-bugfix-count-sentinel | fail (+2 corr.), visible unresolved | fail (+2 corr.), visible unresolved |
| yargs-parser-bugfix-negation-unknown | fail, visible unresolved | fail (+2 corr.), visible unresolved |
| yargs-parser-upgrade-toolchain | fail (+2 corr.), visible unresolved | fail (+2 corr.), visible unresolved |
