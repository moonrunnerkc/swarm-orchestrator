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
| G0 repaired foundation | reliability fixes confirmed; execution and evidence boundaries work | in progress | [baseline.md](baseline.md) |
| G1 verifier release | R1 to R6 and R9 implemented, installed, published, exercised; package, CI and security checks clean | not started | |
| G2 public evidence and launch | R7 study complete; R8 permitted posts published; 48-hour response period elapsed; R10 loop active | not started | |
| G3 comparative advantage | Comparisons A and B and the ablations complete under the frozen decision rule | protocol and decision rule registered ([comparison-protocol.md](comparison-protocol.md)); prior art tabulated without measured claims ([prior-art.md](prior-art.md)); no comparison row produced yet | |

Completing G1 is not completing the assignment. G3 stays in this table until it is either
established or explicitly handed off with its remaining manifest.

## Requirements R1 to R10

| Req | What it asks | Implementation | Tests | Executed evidence | Status |
| --- | --- | --- | --- | --- | --- |
| R1 | `moonrunnerkc/swarm-verify@v1` Action with a signed, idempotent PR comment and an independent verification command | `src/action/*`, `action.yml`, `swarm-verify action verify\|comment\|retain`; `scripts/build-action-distribution.mjs` | `src/action/*.test.ts` (real producer runs, comment head binding, escaping) | remote action-controls run 36344708065 on 93ce4f140: good and bad candidates, verdicts signed as GitHub attestations 50593328 and 50593327 | distribution repository `moonrunnerkc/swarm-verify` at `v1.0.0` and `v1` (`5dedd6d41`), generated from `afa09c290`; sixteen real pull requests carry its comment and attestation (see R4); the fork route is documented in `docs/examples/swarm-verification-forks.yml` and not exercised on a real fork |
| R2 | `npx swarm-verify` useful with zero configuration: deterministic discovery, noninteractive run, scoped result, stable exit codes | `src/cli-check.ts`, `src/gates/check-plan.ts`, `src/gates/noninteractive-runner.ts`; no subcommand runs `check` | `src/cli-check.test.ts` (ten real invocations), `src/gates/check-plan.test.ts`, `src/gates/noninteractive-runner.test.ts` | local gates 24ef849f0: 382 files, 3654 tests; public-package run pending R5 | implemented, not yet published |
| R3 | README-only stranger simulations on three independently maintained repositories from fresh VMs | `scripts/onboarding/select-repositories.mjs` (seeded rule), `observer.mjs` (fresh pinned Ubuntu container, local-model observer given only the two READMEs), `run.mjs` | the observer's every command, belief, output and report are the record | [selection frame](../evidence/2026-09-27/onboarding/frame.json); first run [vite-rc4](../evidence/2026-09-27/onboarding/vite-rc4/summary.json) against rc.4: first result in 20 s (incomplete: pnpm absent, named with its remedy), a result after the observer installed pnpm and dependencies, the broken copy failed with the test named, 16 commands; two confusions fixed in the product and README (the failure-versus-refusal wording, the package manager remedy); [express-rc4](../evidence/2026-09-27/onboarding/express-rc4/summary.json): first result in 29 s (incomplete: no node_modules, remedy named), a regression-only pass after `npm ci`, the broken copy failed with the test named, 14 commands, one README gap fixed (install dependencies first); [python-rc4](../evidence/2026-09-27/onboarding/python-rc4/summary.json): first result in 32 s (incomplete: uv absent), then a uv project without a synced environment was reported as four checks failing in no time instead of a missing-dependencies prerequisite, fixed at the root (`uv sync --locked` is now named, with a test), 10 commands; reruns against rc.7: [vite-rc7](../evidence/2026-09-27/onboarding/vite-rc7/summary.json) (14 commands, the broken copy failed with the test named; the clean repository fails its own `wrangler deploy --dry-run` test command offline, so both runs read `fail` and the observer had to read the details), [express-rc7](../evidence/2026-09-27/onboarding/express-rc7/summary.json) (18 commands, regression-only pass, broken copy refused; two messages found confusing and reworded for the next candidate), [python-rc7](../evidence/2026-09-27/onboarding/python-rc7/summary.json) (16 commands, a result after `uv sync`, broken copy failed with the test named; the clean repository's mypy is configured but not in its environment, which read as a failed typecheck and is now an unavailable check naming the tool, and its `ruff format --check` fails on four files, now shown with ruff's own lines); a [python-rc6](../evidence/2026-09-27/onboarding/python-rc6/summary.json) run before that found the scratch-index staging defect. Reruns against rc.8: [vite-rc8](../evidence/2026-09-27/onboarding/vite-rc8/summary.json) (12 commands, first result in 71 s, the broken copy failed with the test named; the clean repository's own test still fails offline) and [express-rc8](../evidence/2026-09-27/onboarding/express-rc8/summary.json) (14 commands, regression-only pass at 138 s, broken copy refused, no confusion about the product left); [python-rc8](../evidence/2026-09-27/onboarding/python-rc8/summary.json) (17 commands, first result in 53 s, broken copy refused; the clean repository's own `ruff format --check` still fails, shown with ruff's lines, and the typecheck reads as not run with the missing tool named; one jargon suffix on the tests line reworded for the stable release) Final runs against the published `1.0.0`, with no candidate prerequisite: [vite-1.0.0](../evidence/2026-09-27/onboarding/vite-1.0.0/summary.json) (7 commands, first result at 26 s naming the missing pnpm and its install command, the broken copy refused), [express-1.0.0](../evidence/2026-09-27/onboarding/express-1.0.0/summary.json) (18 commands, first result at 24 s naming `npm ci`, a regression-only pass, the broken copy refused; the observer had to install a client subpackage's dependencies as well, which the remedy names only for the root), [python-1.0.0](../evidence/2026-09-27/onboarding/python-1.0.0/summary.json) (11 commands, first result at 28 s naming uv, the broken copy refused with the test named). Each observer reached a first result on its first or fourth command and refused the broken copy | three of three run against rc.4, rc.7, rc.8 and 1.0.0; six product fixes and three wording fixes came out of them; AI simulation, not a human tester |
| R4 | Dogfood across owned repositories, including the Aftermath site repository | [dogfood-manifest.md](dogfood-manifest.md), `scripts/rollout-action.mjs` | | first rollout [quantproof PR 1](https://github.com/moonrunnerkc/quantproof/pull/1): the Action pinned to distribution `9aad5633` (rc.4) ran, signed attestation 50608245 and posted one bound comment, but the verdict was incomplete: the runner had no image and the container backend let `create` pull it inside a 15-second probe deadline. Fixed at the root for rc.5 (the backend pulls an absent image once, before any container), which then refused with isolation unknown because the pull still ran inside a probe's 15-second deadline; fixed again at the root for rc.6 (the pull precedes the deadline, and a timed-out probe is named as such). Each run signed its attestation (50608245, 50610726) and updated the one comment in place. rc.6 across all sixteen: one regression-only pass (crossfire), two honest inherited reds (quantproof, depose), and thirteen incomplete verdicts that exposed four defects, each fixed at the root for rc.7 (vitest reports mixed with suite output; `pnpm run` in an image without pnpm; containment probes needing node; advice text contradicting the verdict). rc.7 across all sixteen: pubprep passed; the vitest fix was itself cut at the pipe's 64 KiB buffer (fixed for rc.8, with the `ci` gate set now composed through npm too); the four Python repositories are refused honestly for carrying no `uv.lock`; Rust, Java and no-toolchain repositories read unmeasured. The table in the manifest carries every row and link | sixteen repositories exercised through four candidates; six defects found and fixed |
| R5 | Stable published `swarm-verify` on Node 22 with a frozen contract and platform matrix | coverage arm on Node 22.8+ ([node-22.md](node-22.md)); the 1.x contract in [contract.md](contract.md); the platform matrix workflow | `src/node-floor.test.ts`, `src/gates/node-test-command.test.ts`, `src/gates/default-gates.test.ts` | `swarm-verify@1.0.0` published to npm under `latest` by workflow run 36361929119 from tag `swarm-verify-v1.0.0` at `afa09c290`, with npm provenance, after nine prerelease candidates; on that commit the remote gates, the verifier matrix (Linux, macOS, Windows; Node 22.0.0, 22, 24) and the action-controls run were green before the tag was cut | published |
| R6 | Verifier-first README with a real tamper GIF and tested commands | `README.md` front door; agent moved to `docs/agent.md` | the README's commands are the ones the onboarding simulations and the client sessions ran | [tamper-demo.gif](../evidence/2026-09-27/verifier-first/tamper-demo.gif) re-recorded with the published `1.0.0` over the committed 2026-08-18 bundle ([transcript](../evidence/2026-09-27/verifier-first/tamper-demo-transcript.txt), [script](../evidence/2026-09-27/verifier-first/tamper-demo.sh), [byte flip](../evidence/2026-09-27/verifier-first/flip-one-byte.mjs)): verified with 42 links, one byte of record 28's timestamp changed, refused naming record 29's broken link, exit 1 | done |
| R7 | Registered, reproducible study of 50 recent AI-authored PRs | [ai-pr-study-protocol.md](ai-pr-study-protocol.md) (registered before any run), `scripts/ai-pr-study/frame.mjs` | | [frame](../evidence/2026-09-27/ai-pr-study/window-90/frame.json): 5000 merged pull requests from five agent accounts (the Codex account authors none), 1284 repositories read, 178 eligible, 50 selected across 15 repositories by seeded order; the first draw is kept as an instrument defect and amended in the protocol | executed on the frozen `1.0.2` and adjudicated: [ai-pr-study-50.md](../results/ai-pr-study-50.md). All 50 rows executed in fresh containers (median 29 s each); 47 installs from the lockfile succeeded and 3 were refused honestly (a case-colliding checkout, a monorepo needing package selection, an install past the memory cap); 6 of 50 original suites green in the fresh execution; task truth established by an executed held-back check on 13 of 50 (9 more only inspected text and are reported apart; 28 unjudged, each with its reason); 0 observed false greens in a denominator of 0 suite-green adjudicated rows, so no false-green fraction is claimed; the verifier accepted 0, refused 4 and left unmeasured 9 of the 13 adjudicated-correct rows on 1.0.2, which is what led to the 1.0.3 change of verdict semantics for inherited failures, replayed and labelled separately. The rows are the tracked archive `rows.json.br`; the reviewer transcripts are packed beside it | executed, adjudicated, reported; replay on 1.0.3 in progress |
| R8 | Launch posts where users discuss the problem, with a real 48-hour response log | | | | not started |
| R9 | Claude Code hook, MCP server and pre-commit hook over the released verifier | `src/integrations/claude-hook.ts`, `mcp-server.ts`, `pre-commit.ts`; `swarm-verify hook\|mcp\|pre-commit`; [integrations.md](../integrations.md) | `src/integrations/*.test.ts`: hook decisions and settings edits, a real MCP session over stdio (negotiation, check, evidence, refusals, cancellation), staged-tree runs including a real blocked commit | [client session](../evidence/2026-09-27/verifier-first/clients-rc6/transcript.md) against the published `1.0.0-rc.6` in a fresh repository, scripted and recorded: `mcp --describe`, one stdio session (initialize, tools/list, `swarm_verify_check` returning a pass, `swarm_verify_status`), `hook install` writing the two settings entries, `hook run` rewriting `npm test` through the verifier and leaving a pipeline alone, `hook uninstall`, `pre-commit install`, a passing commit accepted and a breaking commit refused (exit 1). A live Claude Code or Cursor session was not driven autonomously (it would spend the person's plan); the scripted client speaks the same protocol and payloads | exercised against the published `1.0.0` too ([clients-1.0.0](../evidence/2026-09-27/verifier-first/clients-1.0.0/transcript.md), same steps, same outcomes); live-editor session left to the person |
| R10 | Working issue-to-fix loop with a named owner and tested notifications | | | | not started |

## Technical scope (sections 3 to 7 and 16)

| Item | Implementation | Tests | Executed evidence | Status |
| --- | --- | --- | --- | --- |
| Requirement-level check challenges, four families | `src/gates/goal-challenges.ts`, `src/gates/goal-challenge-runner.ts`; base control, mutations, sealed fixtures, missing obligations; Python by fixture only | `src/gates/goal-challenges.test.ts`, `src/gates/goal-challenges.integration.test.ts` (real ci runs: detected, gap, report, off) | local runs in the integration test | implemented for Node; Python mutations open |
| Precise evidence and adequacy decisions, offline re-derivation | `challenge-plan-v1`, `challenge-run-v1`, `challenge-verdict-v1` records; `src/evidence/verifier/challenges.mjs` embedded in every bundle | `src/evidence/verifier/challenges.test.ts` (parity over 270 cases), integration test reads the bundle's own verifier | bundle re-derivation in the integration test | implemented |
| Twelve attack families with clean counterparts | | | | not started |
| Bounded check strengthening and implementation repair | | | | not started |
| Three policies: disabled, report-only, required | `--challenges off\|report\|required` on `ci`; Action input `challenges` (default `report`); `challenges-unmet` refusal in `src/gates/certification.ts` mirrored in `rederive.mjs` | integration test covers all three | | implemented |
| Readable report agreeing across JSON, terminal, CI summary and bundle | | | | not started |

## Research scope (sections 8 to 15)

| Item | Status | Evidence |
| --- | --- | --- |
| Independent evaluation boundary and reviewer records | not started | |
| Frozen campaign protocol with content digest | not started | |
| Comparison A: identical-patch verifier decisions | [comparison-a.md](../results/comparison-a.md) over the 22 rows with adjudicated truth on 1.0.2: A0 (the suite alone) agreed on 3, false red 3, unmeasured 16; A1 (regression-only verdict) agreed on 1, false red 10, unmeasured 11; 0 false greens in either arm and 0 discordant rows, below the ten the frozen rule needs before any difference is called meaningful. A1's false reds were inherited lint and format failures, which 1.0.3 no longer charges to the patch; A2's first pass was void (the oracle file was absent in the verifier's clone) and is rerun on 1.0.3 as a labelled replay | run on 1.0.2; replay on 1.0.3 in progress |
| Comparison B: complete coding workflows | registered: B0/B1/B2 over the frozen `mined-pr-viable-79` cohort with one local model; runs after Comparison A reports | registered, not run |
| Ablations S0, S1, S2 | [ablations.md](../results/ablations.md) off the same 22 rows: S0 agreed on 3 with 16 unmeasured; S1 (the base control not charging inherited failures, plus the refusals) agreed on 8; S2 adds nothing on these rows without an oracle pass. Read as what each addition changed, not as a ranking | derived on 1.0.2 |
| Prior-art and differentiation table | not started | |
| Effectiveness hypothesis verdict | untested | |

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
- [attack-controls.md](attack-controls.md): the twelve attack families bound to executed controls.
- [contract.md](contract.md): the stable 1.x contract of the package and the Action.
