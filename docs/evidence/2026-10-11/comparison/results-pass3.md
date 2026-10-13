# Pass 3 (2026-10-12 09:54Z to 23:19Z): a failed pass, reported, not the comparison

All forty launches completed and were scored under manifest digest
`sha256:7c4da52ed949e5085ea16e1baa9ebc20a8f7c961b9662d0f6cda4b43f5d619fd` (Swarm revision
`7bd3e1aa67a8aafc2f5af9341a9aa5b14f3df5ae`, OpenCode 1.14.48). Reading the records afterwards
showed that every one of the OpenCode arm's twenty launches lost the model endpoint at least
once: 44 of its 58 invocations end on OpenCode's "Unable to connect" error, each within about
two minutes of starting, and the server's own log shows it dying of GPU memory exhaustion while
two sequences were running at once, the arm's first turn and the session-title call OpenCode
issues beside it. The Swarm arm, which sends one request at a time, lost the endpoint in none of
its invocations. The cause and the fixes are in [protocol.md](protocol.md), amendment 2. The
tables are what the records say; the OpenCode column measures a server that kept dying under
that arm, not the agent. Pass 2's OpenCode launches carried the same failure (41 of 53
invocations), which was not seen before pass 3 was launched. The records themselves are
retained under `~/.cache/swarm-comparison/runs/7c4da52ed949e508/` with their digests in
[records-pass3.sha256](records-pass3.sha256).

| measure | swarm | opencode |
| --- | --- | --- |
| tasks started | 20 | 20 |
| infrastructure failures (not the arm's doing) | 0 | 0 |
| correct completion (hidden oracle passed) / started | 11 / 20 | 0 / 20 |
| correct without any scripted correction / started | 10 / 20 | 0 / 20 |
| scripted corrections used, total (runs with 0 / 1 / 2) | 10 (14 / 2 / 4) | 38 (0 / 2 / 18) |
| visible checks still failing after the protocol | 10 | 20 |
| reported success while the hidden oracle failed | 0 | 5 |
| agent wall time, all runs | 410.4 min | 339.6 min |
| agent wall time, correct runs only | 150.3 min | 0.0 min |
| preparation wall time, all runs (install, outside the agent) | 0.8 min | 0.8 min |
| tokens, all runs with known usage | 10,908,197 over 20 runs (0 unknown) | 2,250,720 over 20 runs (0 unknown) |
| tokens per correct task (known usage) | 400,369 over 11 | no correct run with known usage |

| task | swarm | opencode |
| --- | --- | --- |
| fxp-bugfix-uint8array-utf8 | fail, visible unresolved | fail (+2 corr.), visible unresolved |
| fxp-feature-end-index | fail, visible unresolved | fail (+2 corr.), visible unresolved |
| fxp-feature-strict-reserved-names | fail (+2 corr.), visible unresolved | fail (+2 corr.), visible unresolved |
| fxp-refactor-unpaired-set | pass | fail (+1 corr.), visible unresolved |
| fxp-upgrade-strnum | pass | fail (+2 corr.), visible unresolved |
| js-yaml-bugfix-flow-colon-quoting | fail (+2 corr.), visible unresolved | fail (+2 corr.), visible unresolved |
| js-yaml-bugfix-timestamp-early-years | fail, visible unresolved | fail (+1 corr.), visible unresolved |
| js-yaml-feature-max-aliases | fail (+2 corr.), visible unresolved | fail (+2 corr.), visible unresolved |
| js-yaml-refactor-is-plain-object | pass | fail (+2 corr.), visible unresolved |
| js-yaml-upgrade-vite-workerpool | pass | fail (+2 corr.), visible unresolved |
| marked-bugfix-www-case | fail (+1 corr.), visible unresolved | fail (+2 corr.), visible unresolved |
| marked-feature-def-token | fail, visible unresolved | fail (+2 corr.), visible unresolved |
| marked-refactor-strict-exec | pass | fail (+2 corr.), visible unresolved |
| marked-upgrade-cheerio | pass | fail (+2 corr.), visible unresolved |
| minimatch-bugfix-drive-letter | pass | fail (+2 corr.), visible unresolved |
| minimatch-bugfix-partial-globstar | pass (+2 corr.), visible unresolved | fail (+2 corr.), visible unresolved |
| minimatch-upgrade-tap-types-node | pass | fail (+2 corr.), visible unresolved |
| yargs-parser-bugfix-count-sentinel | pass | fail (+2 corr.), visible unresolved |
| yargs-parser-bugfix-negation-unknown | pass | fail (+2 corr.), visible unresolved |
| yargs-parser-upgrade-toolchain | fail (+1 corr.), visible unresolved | fail (+2 corr.), visible unresolved |
