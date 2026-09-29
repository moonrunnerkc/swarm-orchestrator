# Verifier-first: completion index

Campaign identity: `verifier-first-2026-09-27`. This index is the one place every requirement of
the verifier-first assignment is bound to its implementation, its tests and its executed
evidence. It is kept current as work lands; a row that says "not started" or "open" is the
truth of the tree at the commit that carries it, not a promise.

The product decision is [ADR 0012](../adr/0012-verifier-first-product.md). Prior campaigns,
frozen protocols, launch records and published results are preserved unchanged; nothing here
is appended to an older pilot.

## Gates

| Gate | Required result | Status | Evidence |
| --- | --- | --- | --- |
| G0 repaired foundation | reliability fixes confirmed; execution and evidence boundaries work | met at the baseline, each prerequisite held by a regression test; two false passes were later reported against 1.0.5 and fixed at the root in 1.0.6 (attack-control families 2 and 13) | [baseline.md](baseline.md), [attack-controls.md](attack-controls.md) |
| G1 verifier release | R1 to R6 and R9 implemented, installed, published, exercised; package, CI and security checks clean | met: stable `swarm-verify` on npm (`latest` = 1.0.7), Action `moonrunnerkc/swarm-verify@v1` (= `v1.0.7`), every release tagged only after remote gates, the verifier platform matrix and action-controls passed. Open within it: the fork route is documented, not exercised on a real fork (R1); the Aftermath site repository is not in the rollout (R4); Python mutation challenges | R1 to R6 and R9 below |
| G2 public evidence and launch | R7 study complete; R8 permitted posts published; 48-hour response period elapsed; R10 loop active | R7 complete through a final replay on 1.0.7; R8 posted (GitHub releases 1.0.0 to 1.0.7 and a discussion issue), the 48-hour window runs to about 03:30 UTC 2026-09-30 with no outside response so far, and the Hacker News post is left to the person, as the assignment requires; R10 active with a named owner and an hourly triage workflow, exercised on an internal report only | R7, R8, R10 below; [response-log.md](../launch/response-log.md) |
| G3 comparative advantage | Comparisons A and B and the ablations complete under the frozen decision rule | complete, with no difference established: Comparison A on 1.0.2 and three replays, Comparison B over 79 paired tasks, the ablations, prior art; no arm produced a false green and no pair was discordant, so the hypothesis is neither supported nor refuted at this population (see the effectiveness row) | [comparison-protocol.md](comparison-protocol.md), Research scope below |

Completing G1 is not completing the assignment. G3 stays in this table until it is either
established or explicitly handed off with its remaining manifest.

## Tracker SV-01 to SV-30 (from 2026-09-29)

One row per tracker item of the finish-all assignment, superseding nothing above: earlier rows
stay as the record of their date. States are **verified closed** (the finish condition is met and
its evidence is linked), **in progress**, **open**, or **blocked** by a named external dependency.
"Source" means tested from the repository; "installed" means tested through the packed or
published package; "published" means on npm or in the Action distribution; "adopted" means merged
into a repository's default branch; "established" means a completed, frozen experiment says so.
Delivered at `e3563fa26` as `swarm-verify@1.1.0` (npm `latest`, run 36521357162, provenance) and
Action `moonrunnerkc/swarm-verify@v1` = `v1.1.0` = `5abe0fd26`; remote gates 36520568325, verifier
matrix 36520568322 and action-controls 36520568341 green on that commit.

| ID | State | Source | Reproduction | Fix | Regression and controls | Installed / published | Remaining |
| --- | --- | --- | --- | --- | --- | --- | --- |
| SV-01 | verified closed | `src/gates/instrument-identity.ts`, `instrument-dependencies.ts`, `gate-runner.ts`, `independent-checks.ts`, `verifier/status.mjs`; pre-commit base `src/integrations/pre-commit.ts` | forged `vitest.config.mjs` read `pass` exit 0 with the marker absent on published 1.0.7; a `test` script replaced by `echo` read `pass` from `check` and a regression pass from `ci` | `ba1f9f058`, `c7dc15f16`, `05f4f7ca8` | `instrument-identity.integration.test.ts` (7 real-Vitest cases incl. changed helper, unlisted setup file, path-sourced runner, clean counterparts), `instrument-identity.test.ts` (TS and offline rule parity), `attack-families.integration.test.ts`, pre-commit staged-script case | matrix smoke on every row; public 1.1.0 rerun 2026-09-29: forged config `incomplete` exit 4, marker absent; clean control `fail` exit 1, marker present | none |
| SV-24 | verified closed | `src/gates/failure-attribution.ts`, `runner-results.ts`, `verifier/status.mjs` (failure-identity-v2) | two node tests `works`, patch `n * 3`: `inherited`, `regression: pass`, Action `regression-only` on 1.0.7 | `ba1f9f058`, `a7d906138` (spec reporter) | `duplicate-titles.integration.test.ts` (real node: new, harmless inherited, changed cause), `failure-attribution.test.ts` (nesting, reorder, counts, cancelled, truncated, legacy v1 records) | matrix smoke rows; public 1.1.0: broken `regression: fail` naming `b.test.mjs:4:1 › 0:works`, harmless `pass` inherited; Action decision `not-verified` in the test | none |
| SV-03 | in progress | `attack-controls.md`, `attack-families.integration.test.ts` | a skipped, deleted or rewritten test hiding a broken change read `regression: pass` from `ci` on 1.0.7; an all-skipped node suite read passed | `222d22995`, `6b112e2aa`, `05f4f7ca8`, `1a4d6d262`, `e857059c0` | real controls for families 1 to 7, 9 and 13 with valid counterparts | families 2 and 13 in the installed matrix | real controls for family 10 (concurrent substitution) and 11 (killed-process resume); installed-artifact coverage for more families |
| SV-02 | in progress | `src/gates/check-admission.ts`, `src/cli-strengthen.ts`, `verifier/strengthening.mjs`, contract `references` | none existed | `86be76c6c`, `910445b70`, `76e5cc140`, `7f780b170`, `d3e66e8d1`, `febf31df6` | `check-strengthening.integration.test.ts` (admit, repair, final verification, offline re-derivation; no reference admits nothing; unsafe proposal refused), `cli-strengthen.test.ts`, `cli-task-goal.integration.test.ts`; first development run with a local model found two preset-path defects, fixed | orchestrator only (`swarm "<task>" --preset ... --challenges ... --strengthen`); the verifier package carries the offline rule | a development run in which a local model's proposal is admitted and repaired end to end; end-to-end resume; documentation |
| SV-20 | verified closed | `src/workers/worktree.ts` | issue #75: collision test and clean-merge repair test failed under load | `a20947b10`, `e3563fa26` (timing test fixed in `a740c89d6`, not `ea419b4a5`) | `worktree.test.ts` overlap detector fails before, passes after; amplified 21/40 and 19/40 failures before, 0/80 after | n/a (beta agent) | none; #75 reopened, corrected and closed with the CI runs |
| SV-21 | verified closed | 18 semgrep findings | weekly scan failing since 2026-09-14 | `e840cf4ba`, `80ea86dd3`, `3b418fff2`, `3b5f74e42`, `4d8c1d14a`, `d397786a0`, `2c70df56e` | [scan-triage-2026-09-28.md](../security/scan-triage-2026-09-28.md); local scan 0 findings on tracked files; a crafted workspace pattern took exponential time before the fix | n/a | the next scheduled scan's run confirms it on the default branch |
| SV-28 | verified closed | `src/gates/patch-paths.ts`, `change-source.ts`, `unified-diff.ts` | quoted and space-bearing paths refused | `e0fb28e1d` | real git-generated patches (spaces, quoting, renames, copies, both quotePath settings), unsafe paths still refused, `spaced-patch-path.integration.test.ts` | in 1.1.0 | none |
| SV-16 | verified closed | fork route `docs/examples/swarm-verification-forks.yml`; lab `moonrunnerkc/swarm-verify-fork-lab` forked to `Aftermath-Technologies-Ltd` | never run on a real fork | `f35c92fc6` (every documented workflow sets `install: true`; without it all four lab runs read incomplete) | real fork PRs: valid #2 regression-only pass, broken #3 not verified, hostile #4 found no token variables, no network, none of the runner's paths; changed head: the older run reported `stale-head` and posted nothing, the newer one updated the single comment; Dependabot PR #1 regression-only pass; signed verdict trusted by `gh attestation verify` and refused for another head | published v1.1.0 | none |
| SV-17 | in progress | `src/integrations/*` | scripted clients only | `2de4f27c9` (a piped test command in a live session was not routed) | live Claude Code 2.1.284 sessions: hook routed `npm test` and the agent read the verifier's `fail`; MCP client connected, `swarm_verify_check` returned `pass`, `/etc` refused as outside the root; real pre-commit: good commit accepted, bad staged refused, partially staged handled, uninstall clean | public 1.1.0 | Cursor: not installed on this machine and needs the owner's account; the hook recorded a path inside npx's cache |
| SV-18 | in progress | `scripts/triage/policy.mjs`, `.github/workflows/triage.yml` | the daily reminder SUPPORT.md promised did not exist | `7eca3e5e2`, `753169e83`, `a00ba4f38` | `policy.test.mjs`; live controlled exercise #76 on short windows: `overdue`, reminders 03:34, 03:50, 04:06 UTC as mentions (a `mention` notification reached the maintainer), escalation labelled and assigned, maintainer reply removed both labels and no reminder followed; #78 report to released fix in 1.1.0 | n/a | #77 on real windows: 24-hour reminder and 72-hour escalation still to elapse |
| SV-22 | verified closed | release notes | 1.0.0 said the basic command runs in a container | correction on the 1.0.0 release with the original text struck | 1.1.0 release notes and changelog state the host default | n/a | none |
| SV-29 | in progress | `README.md`, package README, `docs/claims.md`, `verify-only.md` | "nothing is written into the repository" was false (bond fixtures); container claim | `8f650dd64`, `f35c92fc6` | observed writes during `check`; snippet corrected after the lab showed `install` was missing | README on npm for 1.1.0 predates the `install` line | republish the package README with the `install` line in the next release; integrations doc review |
| SV-30 | verified closed | repository metadata | older About and topics | set 2026-09-29 | rendered page shows the description and exactly the ten topics | n/a | none |
| SV-25 | in progress | study rows | 1.0.5 and 1.0.6 partial rows reported lost; rows rewritten in place | `41255bf1d` (recovered and tracked) | | | immutable attempt storage (study repair in progress) |
| SV-07 | verified closed | `scripts/ai-pr-study/containment.mjs`, `reviewer-tools.mjs` | prefix-collision reads, symlinked reads and writes, archive names escaping | `3fb8ff614`, `efd20d5f4` | 31 tests with real directories, mutation to a prefix check fails 2 | n/a | none |
| SV-04, SV-05, SV-06, SV-08, SV-26 | in progress | `scripts/ai-pr-study/*` | audited 2026-09-29: suite-green derived from the verifier; base crashes counted as detection; one reviewer that saw candidate code; a regex split 13/9 misclassifying rows 7, 14, 20, 26 | study repair in progress | | | corrected machinery with controls, then SV-09 |
| SV-09 | open | study | | | | | the version-pinned 50-row run on the corrected machinery |
| SV-10, SV-11, SV-12, SV-13 | open | comparisons | | | capability check of VERA, Ranex, Critique in progress | | frozen protocol and manifest; launches within local resources; any hosted arm needs the owner |
| SV-14 | in progress | `scripts/onboarding/observer.mjs` (Lima VM backend `2d3b7a752`) | earlier runs used a reused container | | fresh Ubuntu 24.04 VM per attempt, running against 1.1.0 | | results of the three VM attempts |
| SV-15 | in progress | rollout PRs | 7 of 16 regression-only passes on 1.0.7 | | re-pin to v1.1.0, fixes and red controls in progress | | Aftermath site: served by a SiteGround PHP host with no GitHub source found; needs the owner to name the source; swarm-orchestrator-rules needs a second account's approval |
| SV-19 | blocked | launch | no dev.to or Reddit post exists | drafts in [posts-2026-09-29.md](../launch/posts-2026-09-29.md) | | | the owner posts on dev.to, r/ClaudeAI, r/cursor and writes the Hacker News post; each 48-hour window starts then |
| SV-23 | in progress | this index | rows said "not started" and "unpublished" after the fact | this section | | | kept current until every row closes |
| SV-27 | verified closed (watch) | package install | intermittent dependency 404 earlier | none needed | matrix rows green on 22.0.0, 22, 24 for the candidate; packed install on Node 22.0.0, 22.22, 24.15 locally | public 1.1.0 installed and run on Node 24 | rerun at each release |

## Requirements R1 to R10

| Req | What it asks | Implementation | Tests | Executed evidence | Status |
| --- | --- | --- | --- | --- | --- |
| R1 | `moonrunnerkc/swarm-verify@v1` Action with a signed, idempotent PR comment and an independent verification command | `src/action/*`, `action.yml`, `swarm-verify action verify\|comment\|retain`; `scripts/build-action-distribution.mjs` | `src/action/*.test.ts` (real producer runs, comment head binding, escaping) | remote action-controls run 36344708065 on 93ce4f140: good and bad candidates, verdicts signed as GitHub attestations 50593328 and 50593327 | distribution repository `moonrunnerkc/swarm-verify`, first stable at `v1.0.0` (`5dedd6d41`, generated from `afa09c290`); `v1` has since moved, each time after validation, through the patches listed below and is now `v1.0.7` (`9b7d32a2c`); sixteen real pull requests carry its comment and attestation (see R4); the fork route is documented in `docs/examples/swarm-verification-forks.yml` and not exercised on a real fork |
| R2 | `npx swarm-verify` useful with zero configuration: deterministic discovery, noninteractive run, scoped result, stable exit codes | `src/cli-check.ts`, `src/gates/check-plan.ts`, `src/gates/noninteractive-runner.ts`; no subcommand runs `check` | `src/cli-check.test.ts` (ten real invocations), `src/gates/check-plan.test.ts`, `src/gates/noninteractive-runner.test.ts` | the published package run from outside this repository throughout the study (`npx --yes swarm-verify@<version> ci ...`, 50 rows per replay) and against the reported repros on 1.0.5, 1.0.6 and 1.0.7; the onboarding simulations (R3) start from `npx swarm-verify` | published and exercised |
| R3 | README-only stranger simulations on three independently maintained repositories from fresh VMs | `scripts/onboarding/select-repositories.mjs` (seeded rule), `observer.mjs` (fresh pinned Ubuntu container, local-model observer given only the two READMEs), `run.mjs` | the observer's every command, belief, output and report are the record | [selection frame](../evidence/2026-09-27/onboarding/frame.json); first run [vite-rc4](../evidence/2026-09-27/onboarding/vite-rc4/summary.json) against rc.4: first result in 20 s (incomplete: pnpm absent, named with its remedy), a result after the observer installed pnpm and dependencies, the broken copy failed with the test named, 16 commands; two confusions fixed in the product and README (the failure-versus-refusal wording, the package manager remedy); [express-rc4](../evidence/2026-09-27/onboarding/express-rc4/summary.json): first result in 29 s (incomplete: no node_modules, remedy named), a regression-only pass after `npm ci`, the broken copy failed with the test named, 14 commands, one README gap fixed (install dependencies first); [python-rc4](../evidence/2026-09-27/onboarding/python-rc4/summary.json): first result in 32 s (incomplete: uv absent), then a uv project without a synced environment was reported as four checks failing in no time instead of a missing-dependencies prerequisite, fixed at the root (`uv sync --locked` is now named, with a test), 10 commands; reruns against rc.7: [vite-rc7](../evidence/2026-09-27/onboarding/vite-rc7/summary.json) (14 commands, the broken copy failed with the test named; the clean repository fails its own `wrangler deploy --dry-run` test command offline, so both runs read `fail` and the observer had to read the details), [express-rc7](../evidence/2026-09-27/onboarding/express-rc7/summary.json) (18 commands, regression-only pass, broken copy refused; two messages found confusing and reworded for the next candidate), [python-rc7](../evidence/2026-09-27/onboarding/python-rc7/summary.json) (16 commands, a result after `uv sync`, broken copy failed with the test named; the clean repository's mypy is configured but not in its environment, which read as a failed typecheck and is now an unavailable check naming the tool, and its `ruff format --check` fails on four files, now shown with ruff's own lines); a [python-rc6](../evidence/2026-09-27/onboarding/python-rc6/summary.json) run before that found the scratch-index staging defect. Reruns against rc.8: [vite-rc8](../evidence/2026-09-27/onboarding/vite-rc8/summary.json) (12 commands, first result in 71 s, the broken copy failed with the test named; the clean repository's own test still fails offline) and [express-rc8](../evidence/2026-09-27/onboarding/express-rc8/summary.json) (14 commands, regression-only pass at 138 s, broken copy refused, no confusion about the product left); [python-rc8](../evidence/2026-09-27/onboarding/python-rc8/summary.json) (17 commands, first result in 53 s, broken copy refused; the clean repository's own `ruff format --check` still fails, shown with ruff's lines, and the typecheck reads as not run with the missing tool named; one jargon suffix on the tests line reworded for the stable release) Final runs against the published `1.0.0`, with no candidate prerequisite: [vite-1.0.0](../evidence/2026-09-27/onboarding/vite-1.0.0/summary.json) (7 commands, first result at 26 s naming the missing pnpm and its install command, the broken copy refused), [express-1.0.0](../evidence/2026-09-27/onboarding/express-1.0.0/summary.json) (18 commands, first result at 24 s naming `npm ci`, a regression-only pass, the broken copy refused; the observer had to install a client subpackage's dependencies as well, which the remedy names only for the root), [python-1.0.0](../evidence/2026-09-27/onboarding/python-1.0.0/summary.json) (11 commands, first result at 28 s naming uv, the broken copy refused with the test named). Each observer reached a first result on its first or fourth command and refused the broken copy | three of three run against rc.4, rc.7, rc.8 and 1.0.0; six product fixes and three wording fixes came out of them; AI simulation, not a human tester |
| R4 | Dogfood across owned repositories, including the Aftermath site repository | [dogfood-manifest.md](dogfood-manifest.md), `scripts/rollout-action.mjs` | | first rollout [quantproof PR 1](https://github.com/moonrunnerkc/quantproof/pull/1): the Action pinned to distribution `9aad5633` (rc.4) ran, signed attestation 50608245 and posted one bound comment, but the verdict was incomplete: the runner had no image and the container backend let `create` pull it inside a 15-second probe deadline. Fixed at the root for rc.5 (the backend pulls an absent image once, before any container), which then refused with isolation unknown because the pull still ran inside a probe's 15-second deadline; fixed again at the root for rc.6 (the pull precedes the deadline, and a timed-out probe is named as such). Each run signed its attestation (50608245, 50610726) and updated the one comment in place. rc.6 across all sixteen: one regression-only pass (crossfire), two honest inherited reds (quantproof, depose), and thirteen incomplete verdicts that exposed four defects, each fixed at the root for rc.7 (vitest reports mixed with suite output; `pnpm run` in an image without pnpm; containment probes needing node; advice text contradicting the verdict). rc.7 across all sixteen: pubprep passed; the vitest fix was itself cut at the pipe's 64 KiB buffer (fixed for rc.8, with the `ci` gate set now composed through npm too); the four Python repositories are refused honestly for carrying no `uv.lock`; Rust, Java and no-toolchain repositories read unmeasured. The table in the manifest carries every row and link | sixteen repositories exercised through four candidates and four patches; seven defects found and fixed through 1.0.4; on 1.0.7 seven of sixteen pass as regression-only, each on an inheritance the verdict now proves |
| R5 | Stable published `swarm-verify` on Node 22 with a frozen contract and platform matrix | coverage arm on Node 22.8+ ([node-22.md](node-22.md)); the 1.x contract in [contract.md](contract.md); the platform matrix workflow | `src/node-floor.test.ts`, `src/gates/node-test-command.test.ts`, `src/gates/default-gates.test.ts` | `swarm-verify@1.0.0` published to npm under `latest` by workflow run 36361929119 from tag `swarm-verify-v1.0.0` at `afa09c290`, with npm provenance, after nine prerelease candidates; on that commit the remote gates, the verifier matrix (Linux, macOS, Windows; Node 22.0.0, 22, 24) and the action-controls run were green before the tag was cut | published |
| R6 | Verifier-first README with a real tamper GIF and tested commands | `README.md` front door; agent moved to `docs/agent.md` | the README's commands are the ones the onboarding simulations and the client sessions ran | [tamper-demo.gif](../evidence/2026-09-27/verifier-first/tamper-demo.gif) re-recorded with the published `1.0.0` over the committed 2026-08-18 bundle ([transcript](../evidence/2026-09-27/verifier-first/tamper-demo-transcript.txt), [script](../evidence/2026-09-27/verifier-first/tamper-demo.sh), [byte flip](../evidence/2026-09-27/verifier-first/flip-one-byte.mjs)): verified with 42 links, one byte of record 28's timestamp changed, refused naming record 29's broken link, exit 1 | done |
| R7 | Registered, reproducible study of 50 recent AI-authored PRs | [ai-pr-study-protocol.md](ai-pr-study-protocol.md) (registered before any run), `scripts/ai-pr-study/frame.mjs` | | [frame](../evidence/2026-09-27/ai-pr-study/window-90/frame.json): 5000 merged pull requests from five agent accounts (the Codex account authors none), 1284 repositories read, 178 eligible, 50 selected across 15 repositories by seeded order; the first draw is kept as an instrument defect and amended in the protocol | executed on the frozen `1.0.2` and adjudicated: [ai-pr-study-50.md](../results/ai-pr-study-50.md). All 50 rows executed in fresh containers (median 29 s each); 47 installs from the lockfile succeeded and 3 were refused honestly (a case-colliding checkout, a monorepo needing package selection, an install past the memory cap); 6 of 50 original suites green in the fresh execution; task truth established by an executed held-back check on 13 of 50 (9 more only inspected text and are reported apart; 28 unjudged, each with its reason); 0 observed false greens in a denominator of 0 suite-green adjudicated rows, so no false-green fraction is claimed; the verifier accepted 0, refused 1 and left unmeasured 12 of the 13 adjudicated-correct rows on 1.0.2 (read as the verifier decides; the first coding, which counted any failed check as a refusal, read 0, 4 and 9), which is what led to the 1.0.3 change of verdict semantics for inherited failures, replayed and labelled separately. The rows are the tracked archive `rows.json.br`; the reviewer transcripts are packed beside it. Replay on 1.0.3, labelled apart: [ai-pr-study-50-replay-1.0.3.md](../results/ai-pr-study-50-replay-1.0.3.md) from `rows-replay-1.0.3.json.br`. All 50 executed, three of them after one infrastructure rerun named in the report; the verifier accepted 1, refused 1 and left unmeasured 11 of the 13 adjudicated-correct rows (first coding: 1, 3 and 9). The replay exposed a third install gap: projects that keep pytest in a `dev` extra read "no test ran". Fixed in the source for the next patch; on one such row the source build ran 983 tests where 1.0.3 ran none. Replay on 1.0.4 ([ai-pr-study-50-replay-1.0.4.md](../results/ai-pr-study-50-replay-1.0.4.md)), which installs extras: all 50 executed, twelve of them after infrastructure reruns named in the report (four needed two, once the runtime was measured healthy); original suites green on 16 of 50 (6 on 1.0.2); the verifier accepted 9, refused 1 and left unmeasured 3 of the 13 adjudicated-correct rows (first coding: 9, 3 and 1), though those passes rested on inheritances 1.0.4 did not show; still 0 false greens. Final replay on 1.0.7 ([ai-pr-study-50-replay-1.0.7.md](../results/ai-pr-study-50-replay-1.0.7.md)), after the 1.0.6 and 1.0.7 fixes: all 50 executed with none blocked; original suites green on 16 of 50; of the 13 adjudicated-correct pull requests, the verifier accepted 3, refused 3 on a check that fails with the patch and not at the base, and left 7 unmeasured where a failure the base shared could not be shown to be only the base's; 0 false greens. The 1.0.5 and 1.0.6 replays were stopped part-way because each fix changed what they measure | executed, adjudicated, reported; replayed on 1.0.3, 1.0.4 and 1.0.7 |
| R8 | Launch posts where users discuss the problem, with a real 48-hour response log | [release-announcement.md](../launch/release-announcement.md); GitHub releases `swarm-verify-v1.0.0` to `swarm-verify-v1.0.7`; discussion issue #74 | | [response-log.md](../launch/response-log.md): every post and release logged with its time; no outside comment on #74 or any release so far | posted; window open to about 03:30 UTC 2026-09-30; the Hacker News submission is left to the person, as the assignment requires |
| R9 | Claude Code hook, MCP server and pre-commit hook over the released verifier | `src/integrations/claude-hook.ts`, `mcp-server.ts`, `pre-commit.ts`; `swarm-verify hook\|mcp\|pre-commit`; [integrations.md](../integrations.md) | `src/integrations/*.test.ts`: hook decisions and settings edits, a real MCP session over stdio (negotiation, check, evidence, refusals, cancellation), staged-tree runs including a real blocked commit | [client session](../evidence/2026-09-27/verifier-first/clients-rc6/transcript.md) against the published `1.0.0-rc.6` in a fresh repository, scripted and recorded: `mcp --describe`, one stdio session (initialize, tools/list, `swarm_verify_check` returning a pass, `swarm_verify_status`), `hook install` writing the two settings entries, `hook run` rewriting `npm test` through the verifier and leaving a pipeline alone, `hook uninstall`, `pre-commit install`, a passing commit accepted and a breaking commit refused (exit 1). A live Claude Code or Cursor session was not driven autonomously (it would spend the person's plan); the scripted client speaks the same protocol and payloads | exercised against the published `1.0.0` too ([clients-1.0.0](../evidence/2026-09-27/verifier-first/clients-1.0.0/transcript.md), same steps, same outcomes); live-editor session left to the person |
| R10 | Working issue-to-fix loop with a named owner and tested notifications | issue forms (`.github/ISSUE_TEMPLATE`), [SUPPORT.md](../../SUPPORT.md) naming the maintainer, [SECURITY.md](../../SECURITY.md), `.github/workflows/triage.yml` (hourly; labels an issue unanswered after 24 hours `overdue`) | the triage workflow's scheduled runs succeed | issue #75, reported from inside this campaign, was root-caused and one of its two flakes fixed at the source (`ea419b4a5`), with the finding posted on the issue; two false passes reported by the owner were reproduced, fixed and released within the same day (1.0.6, 1.0.7) | active; the overdue path has not been exercised by an outside report |

## Technical scope (sections 3 to 7 and 16)

| Item | Implementation | Tests | Executed evidence | Status |
| --- | --- | --- | --- | --- |
| Requirement-level check challenges, four families | `src/gates/goal-challenges.ts`, `src/gates/goal-challenge-runner.ts`; base control, mutations, sealed fixtures, missing obligations; Python by fixture only | `src/gates/goal-challenges.test.ts`, `src/gates/goal-challenges.integration.test.ts` (real ci runs: detected, gap, report, off) | local runs in the integration test | implemented for Node; Python mutations open |
| Precise evidence and adequacy decisions, offline re-derivation | `challenge-plan-v1`, `challenge-run-v1`, `challenge-verdict-v1` records; `src/evidence/verifier/challenges.mjs` embedded in every bundle | `src/evidence/verifier/challenges.test.ts` (parity over 270 cases), integration test reads the bundle's own verifier | bundle re-derivation in the integration test | implemented |
| Twelve attack families with clean counterparts | bound to executed controls in [attack-controls.md](attack-controls.md), with a thirteenth (a new failure behind one the base had) added after it was reported | each family's controls are named tests, graded real, in-proc or pure | the real-Vitest controls in `src/gates/vitest-forgery.integration.test.ts` for families 2 and 13 | implemented; residuals named per family |
| Bounded check strengthening and implementation repair | | | | not started |
| Three policies: disabled, report-only, required | `--challenges off\|report\|required` on `ci`; Action input `challenges` (default `report`); `challenges-unmet` refusal in `src/gates/certification.ts` mirrored in `rederive.mjs` | integration test covers all three | | implemented |
| Readable report agreeing across JSON, terminal, CI summary and bundle | | | | not started |

## Research scope (sections 8 to 15)

| Item | Status | Evidence |
| --- | --- | --- |
| Independent evaluation boundary and reviewer records | the study's truth comes from a reviewer role that never sees the verifier's verdict (`scripts/ai-pr-study/adjudicate.mjs`, a local Qwen3.6 reviewer with list, read and finish tools only), writes one held-back check per row, and is counted only where that check executed and separated base from head; every reviewer transcript is packed losslessly under `docs/evidence/2026-09-27/ai-pr-study/packed-derived/adjudication-transcripts-2026-09`. The reviewer is a model, not an independent human; no human judgment was collected, by design | recorded |
| Frozen campaign protocol with content digest | [comparison-protocol.md](comparison-protocol.md) registered at `fb86e104b` (sha256 of the registered text `145c191d060a4810ca379a7c3d07546d565089cd2ae0609504a62add6ce72d61`) and [ai-pr-study-protocol.md](ai-pr-study-protocol.md) at `a853b037f` (sha256 `8d182477515e17ec794ac2c6b35c566b6eba2878d646cda96e2d003f39ec40b4`), both before any run; every later change is a dated amendment appended below the registered text, never an edit of it | registered |
| Comparison A: identical-patch verifier decisions | Final numbers are on 1.0.7 ([comparison-a-replay-1.0.7.md](../results/comparison-a-replay-1.0.7.md)), over the 22 rows with adjudicated truth, one of them a violated requirement. A0, the suite alone: 11 agree, 5 false red, 6 unmeasured. A1, the regression-only verdict: 5 agree, 3 false red, 14 unmeasured. A2, with the held-back check as oracle: 6 agree, 0 false red, 16 unmeasured. No arm has a false green and no row is discordant, so no difference is called. A1's three false reds are each a check the pull request's run fails in a way its base's run does not (a newly failing test in two, a new lint error in one) on pull requests that meet their requirement; whether each is a genuine regression or a flaky test is not established here. A2's oracle accepts the task on 20 of 21 executed rows and rejects the violated one; one A2 row stays blocked because its own run hung the container runtime twice. A1 is read as the verifier decides, under an amendment written after seeing the 1.0.7 data it changes. The first coding, which counted any failed check as a refusal, gives 16 false reds on 1.0.7 and appears beside it on every page. Earlier replays under both readings: [1.0.2](../results/comparison-a.md), [1.0.3](../results/comparison-a-replay-1.0.3.md), [1.0.4](../results/comparison-a-replay-1.0.4.md) | run on 1.0.2; replayed on 1.0.3, 1.0.4 and 1.0.7 |
| Comparison B: complete coding workflows | [comparison-b.md](../results/comparison-b.md), `scripts/comparison-b.mjs`, over the frozen `mined-pr-viable-79` cohort with the reach-pressure experiment's recorded prefixes (Qwen3.8-27B, local), under an amendment registered before any B run. 14 of 79 tasks reach a fork. B0 and B1 pass the held-back half on the same 12 tasks: 0 help, 0 harm, 79 concordant pairs, below the ten discordant pairs the frozen rule needs. The released 1.0.4 verdict failed five fork patches that the prefix's older judge had passed, each for a real reason: dayjs#2330's own lint error, the three koa patches breaking the repository's ESM export test, and a commander test file that exits the process. One repair fixed its lint error; in the other four the model changed nothing across two invocations each. The feedback named counts and not failing tests, which 1.0.5 now names. B2 is not applicable: no task carries a requirement contract | run; no difference |
| Ablations S0, S1, S2 | On 1.0.7 ([ablations-replay-1.0.7.md](../results/ablations-replay-1.0.7.md)): S0 agrees on 11, S1 (the base control and refusals) on 5 with 14 unmeasured, S2 (adding the held-back oracle) on 6 with 0 false reds. No rung has a false green. S1 is the verifier's own decision, as registered; an earlier script defect that read S1 differently is recorded as an amendment. Read as what each addition changed, not as a ranking | derived on 1.0.2 and on each replay |
| Prior-art and differentiation table | [prior-art.md](prior-art.md): a capability table registered with the comparison protocol; it makes no measured claim about any tool that was not run | written |
| Effectiveness hypothesis verdict | Not established, by the frozen rule. The hypothesis is that challenging checks catch what ordinary CI passes (ADR 0012). Across 1.0.2 and three replays, and in Comparison B over 79 paired coding tasks, no arm produced a false green and no pair was discordant. The study population holds one judged requirement violation among 22, and ordinary CI already refuses it, so it cannot show a false-green difference. What it does show: on 1.0.7 the held-back oracle refuses no correct pull request and rejects the violated one; the regression-only verdict refuses three correct pull requests on checks that fail with the patch and not at the base; and two false passes reported against 1.0.5 were closed. A population with more violations is needed before any advantage is claimed | tested; no difference at this population |

## Facts established at registration (2026-09-27)

- Repaired baseline: `270811a4474284d9be2d07765eb26c35bc0c5453` on `v13-main`, which is the
  repository's default branch. The audited commit `a6a83eeb9201957d505824b135f0bc9c83ee9944` is
  an ancestor; the ten commits after it are the audit corrections recorded in
  [upgrade-audit-corrections.md](../upgrade-audit-corrections.md).
- Registry state: `swarm-orchestrator@14.2.0` is `latest`; `swarm-verify@0.2.0` is the only
  published version of the standalone package, published 2026-09-27T17:21Z with SLSA provenance
  from tag `swarm-verify-v0.2.0`. No `moonrunnerkc/swarm-verify` repository exists yet, so the
  requested Action address does not resolve.
- Delivery route: ruleset 15229475 on this repository blocks creation, update, deletion and
  non-fast-forward on every branch for everyone except the repository admin role, which
  bypasses always. Every push by the owner therefore goes through that ruleset's own configured
  route; no rule is disabled and no force push is used.
- The earlier "four of eighteen" finding is
  [false-green-measurement.md](../evidence/2026-09-05/false-green-measurement.md): eighteen
  patches produced by this project's own agent and a baseline arm over three public TypeScript
  repositories and three tasks, re-scored against hidden acceptance tests written by the same
  authors. Four passed their project's whole suite and failed the hidden test. It is a
  measurement of that population only. It is not a study of AI-authored public pull requests,
  not independently reproduced, and not a general false-green rate; the R7 study is registered
  separately and does not inherit it.
- Prerelease published: `swarm-verify@1.0.0-rc.1` under dist-tag `next`, by workflow run
  36346312358 from tag `swarm-verify-v1.0.0-rc.1` at `eced3116c`, with npm provenance.
  `npx -y swarm-verify@next` from an empty cache ran a regression-only pass over the node test
  fixture on 2026-09-27 20:06 UTC.
- Prereleases that published nothing: `swarm-verify-v1.0.0-rc.2` (run 36348351561) failed the
  gates on the runner because the container-install test created its fixture under a
  `.swarm` directory the checkout does not carry; `swarm-verify-v1.0.0-rc.3` (run 36350407042)
  failed because the pnpm fixture built its lockfile with a host `pnpm` the runner does not
  have. Both tags stay; each defect was fixed at its root (the test creates the directory,
  and the lockfile is built through the same `npx --package pnpm@9.15.0` vector the install
  under test uses) and the next candidate carries the fix.
- Prereleases published under `next` after those: `1.0.0-rc.4` (run 36351423905, tag at
  `852380613`), `1.0.0-rc.5` (run 36352734529, tag at `c1607e02d`) and `1.0.0-rc.6` (run
  36353969245, tag at `e475438d7`), each with npm provenance. The distribution repository
  carries tags `v1.0.0-rc.4` (`9aad56338`), `v1.0.0-rc.5` (`7e9bad39a`) and `v1.0.0-rc.6`
  (`635e14a2a`), each generated from the canonical source at the named commit.
- Stable releases: `swarm-verify@1.0.0` (run 36361929119, tag at `afa09c290`) and the patch
  `1.0.1` (tag at `ce7b2db36`), both published under `latest` with npm provenance after the
  remote gates, the verifier matrix and the action-controls run were green on the tagged
  commit. The distribution repository carries `v1.0.0` (`5dedd6d41`) and `v1.0.1`
  (`60d9aa901`); `v1` was created at the former and moved to the latter, each move after
  validation. The 1.0.1 patch fixed four gaps the AI-authored pull request study exposed on
  its first run through 1.0.0 (a 256 MB container scratch, an unpinned pnpm lockfile, a
  configured Python tool absent from the environment, an absent pytest), named in the
  changelog; the sixteen rollout pull requests were re-pinned to it with the same verdicts.
- Patch `1.0.2` (tag at `f7d20cacc`, distribution `v1.0.2` = `046c1750e`, `v1` moved there after
  validation): the study's run through 1.0.1 showed the container's tmpfs scratch charged to
  its 2 GB memory limit killing large installs, and a base commit that exists but cannot be
  checked out (two paths differing only in case on a case-insensitive filesystem) reported as
  "not in the checkout". Both fixed at the root and named in the changelog.
- Patch `1.0.3` (tag at `857e0e87b`, distribution `v1.0.3` = `ea35e0fa1`, `v1` moved there after
  validation): the study's complete run through 1.0.2 showed ten of twenty-two adjudicated-correct
  pull requests refused for a lint or format failure their base carried, and Python projects
  whose test runner sits in a non-default dependency group reading as no test run. The first is a
  change of verdict semantics, named as such in the changelog (an inherited failure is measured
  by the base control and no longer leaves the regression dimension unmeasured); the second is
  `--all-groups` on the authorized `uv sync`. The study's primary rows stay on 1.0.2; a labelled
  replay on 1.0.3 is recorded apart. The rollout re-pinned to 1.0.3 returned the same sixteen
  results and exposed a contradiction: quantproof and cronproof now report `Regression: pass`
  while their headline still reads "Not verified", because the Action's result was decided from
  any failed check rather than from the regression dimension.
- Patch `1.0.4` (tag `swarm-verify-v1.0.4` at `c2206b6c6` after remote gates, verifier matrix
  and action-controls passed; npm `latest` with a signed provenance statement; distribution
  `v1.0.4` = `v1` = `42321e1c0`): the Action's result follows the regression dimension when
  every failed check is inherited, and the authorized `uv sync` installs every extra as well as
  every group. The rollout re-pinned to it has seven regression-only passes, including
  quantproof and cronproof, and no headline that contradicts its regression line. The study's
  replay on 1.0.3 had shown projects keeping pytest in a `dev` extra reading "no test ran"; a
  replay on 1.0.4 is labelled apart.
- Patch `1.0.5` (tag `swarm-verify-v1.0.5` at `ea419b4a5` after remote gates, verifier matrix
  and action-controls passed; npm `latest`; distribution `v1.0.5` = `v1` = `3a552d70f`): the
  oracle runs with the prepared `.venv/bin` and `node_modules/.bin` first on PATH and every
  oracle run is kept in the verdict; container removal is observed up to three times before
  cleanup is called unconfirmed; a failed TAP run names its failing tests; a failed test check
  whose counts show no failure says why. The first validation of 1.0.5 failed on the worker
  flake of issue #75, which was then fixed at the root in the test before tagging. The rollout
  re-pinned to 1.0.5 returned the same sixteen results as 1.0.4.
- Patch `1.0.6` (tag `swarm-verify-v1.0.6` at `d98431cfc` after remote gates, verifier matrix
  and action-controls passed; the first publish attempt failed on a timing test's margin and its
  rerun published; npm `latest`): two false passes reported against the published 1.0.5, both
  reproduced on it and fixed at the root. A patch that broke `sum.js` and added a
  `vitest.config.js` writing a passing report to the path in `process.argv` read as a regression
  pass; the runner's configuration now comes from the base, as its command did. A newly broken
  test behind a test the base already failed read as inherited; a failure is now inherited only
  where every failing test also failed at the base, or the outputs match once times are set
  aside, and otherwise it is a regression or leaves the dimension unmeasured. Fixing them found a
  third defect: since 1.0.3 the offline re-deriver disagreed with the live rule, so every bundle
  with an inherited pass failed its own "independent regression re-derived" check; it now
  implements both rules itself. Verified on the published 1.0.6: both repros read regression
  fail, a harmless patch over a proven inherited failure still passes, and both bundles verify
  offline. Real-Vitest controls hold both (attack-control families 2 and 13). The study replay on
  1.0.5 was stopped at row 40 when the report arrived, since 1.0.6 changes what it measures; its
  partial rows are not kept. *(Corrected 2026-09-29: they were kept, gitignored in the working
  tree; they are now tracked as `ai-pr-study/rows-replay-1.0.5-partial.json.br`: rows 1 to 38
  executed, 8 to 11 and 23 to 29 after infrastructure attempts, 39 blocked, 40 to 50 never run.)*
- Patch `1.0.7` (tag at `6c14d1934` after remote validation; npm `latest`; distribution
  `v1.0.7` = `v1` = `9b7d32a2c`): Vitest's text-reporter FAIL lines are read as failure
  identities, so an inheritance under a script with extra flags (`--coverage`) can be proven.
  The 1.0.6 rollout had read cronproof#2 as incomplete for want of them; 1.0.7 proves its
  inheritance and it passes. Both reported repros fail on the published 1.0.7 and the harmless
  control passes. The study replay on 1.0.6 was stopped at row 7 for this and runs on 1.0.7; its
  rows 1 to 7 are tracked as `ai-pr-study/rows-replay-1.0.6-partial.json.br` (added 2026-09-29).
- Distribution repository created: `moonrunnerkc/swarm-verify` (public), first commit
  `9d0a1eb32492f05c27afd442304a66cd8e79fe31` generated by `scripts/build-action-distribution.mjs`
  from `eced3116c`, lockfile pinning the package at integrity
  `sha512-F3Hi6Us9b/vucWHWJNoWvVpRFpekxByPWFkj57eqY/GfP2Gm2CBhgt1OjiwyIAAd8af2DCf/IS9SruYZ3UHTPg==`,
  tag `v1.0.0-rc.1`. No `v1` tag yet: it moves only to a validated stable version.
- Tamper demonstration recorded with the published prerelease:
  [tamper-demo.gif](../evidence/2026-09-27/verifier-first/tamper-demo.gif), its
  [cast](../evidence/2026-09-27/verifier-first/tamper-demo.cast), the
  [plain transcript](../evidence/2026-09-27/verifier-first/tamper-demo-transcript.txt) and the
  [script that produced it](../evidence/2026-09-27/verifier-first/tamper-demo.sh), over the committed
  `docs/evidence/2026-08-18/live-frontier` bundle: verified (exit 0), one byte of record 28's
  timestamp flipped, refused with the broken link named (exit 1).
- Known nondeterministic test, not in the verifier: `src/workers/acceptance.test.ts` ("two tasks
  that collide") failed once in a full gate run on 2026-09-28 (`rejected.reason` undefined) and
  passed on the rerun and on five runs alone; it belongs to the beta agent's worker coordination
  and is not on the verifier's path. Left open and named here rather than retried into silence.
- Local development environment: Node 24.15.0 (`node@22` 22.22.3 is installed beside it),
  npm 11.12.1, pnpm 9.15.0, uv 0.11.13, Python 3.14.7, Docker 29.5.2, gh 2.92.0 with
  `attestation verify`, Claude Code 2.1.283, Ollama serving local models. The local npm
  credential is expired (`whoami` answers 401); publication goes through the repository's
  tag-triggered workflow, which published 0.2.0 today.

## Records

- [baseline.md](baseline.md): G0 prerequisite checks and the gate transcript on the baseline.
- [dogfood-manifest.md](dogfood-manifest.md): the owned-repository inventory and rollout state.
- [node-22.md](node-22.md): the coverage arm on Node 22.8 and newer, with the probe per runtime.
- [attack-controls.md](attack-controls.md): the twelve attack families, and a thirteenth reported against 1.0.5, bound to executed controls.
- [contract.md](contract.md): the stable 1.x contract of the package and the Action.
