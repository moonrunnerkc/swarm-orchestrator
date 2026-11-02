# Closing run report, 2026-11-01 to 2026-11-02

The closing run of docs/plans/2026-11-01-closing-run.md, carried out in the clones under
`/Users/brad/projects/recovery-2026-10-31`, with Brad's closing instructions of 2026-11-01
evening (steps 1 to 8) on top. Every command's outcome is in
`/Users/brad/projects/recovery-2026-10-31/run-log.md` (outside both repositories) under
"Closing run"; the acceptance evidence is docs/acceptance/2026-10-31/ in this repository.

## 1. Starting and ending commits

| Repository | Start | End |
| --- | --- | --- |
| swarm-orchestrator | `recovery/2026-10-31` f86c5095a520658dc9165957f07e0dce83731d29 | `v13-main` and tag `v16.0.0` at b673c1f3d9ada7a75b5a144fea426892e5a65535; follow-up `recovery/2026-11-01-closing` at d45a73dacd180df95fd865482e9717c1b1cac172, then the commit adding this report |
| swarm-verify | `recovery/2026-10-31` 1e5c0f32be43c62572a4799ba9f24bfe026a1b0a | work branch rewritten without trailers to c7e3ca4dd8305ec8cbc7e0b6814375561c03ba8f, finished at 53b647379e983064c4ac57df76bfa7a2b8a2614d (tags `v2.0.0` and `v2`); `main` at eb87133933cf1e439e043c0ac3a1701d4f0493fb; follow-up `docs/readme-replay` at 9e8e4d17ffa16f5ba213ac37c8193a563bd0f847 |

swarm-verify `main` moved 7132869 to 53b6473 (release candidate), 7d52c17 (release on full
version tags only, README Releases section) and eb87133 (the hand-run Action smoke workflow).
The tags `v2` and `v2.0.0` were not moved. Brad's checkout `/Users/brad/projects/swarm-orchestrator`
was not worked in: clean at cce4bde43.

## 2. Definition of done

| # | Point | Evidence | Status |
| --- | --- | --- | --- |
| 1 | Both packages on npm, lockfile integrity equals the published tarball, clean global install works and resolves the installed verifier | `npm view swarm-verify@2.0.0 dist.integrity` = sha512-xynz5IZqcxXW//vIGgVeQGvoHuo6iTGro8qnYL7KS1yGiXwlLRAAzxXNhwynJwLtvrFC0S3C43T2FSJRq+H0Zg==, the lockfile pin; `npm view swarm-orchestrator@16.0.0 dependencies` names swarm-verify 2.0.0; into an empty prefix `swarm --version` 16.0.0, its own swarm-verify 2.0.0; a dossier task through it complete, isolated, replay agrees (section 6) | met |
| 2 | CI green on both default branches after merge | swarm-orchestrator `v13-main` b673c1f3d: run 41523265165 success; swarm-verify `main` eb87133: run 41524179977 success | met |
| 3 | Each of the eight categories has a complete replayed run of its own, or an entry saying why not | seven complete with agreeing replays; the cross-module refactor (t6 tracemantle) is a recorded limitation in docs/acceptance/2026-10-31/README.md, docs/known-issues.md, the 16.0.0 changelog's Known limits and docs/DECISIONS.md, with docs/acceptance/2026-10-31/t6-comparison/ to judge another agent on the same base | met, t6 as a recorded limitation |
| 4 | No false completion reproducible; t7a "latest 9.x" never complete at a wrong version | t7a closing attempt 3 (20261101T235811-1133bb) complete at vitest 4.1.10 and Stryker 9.6.1, the registry's latest 9.x read during preparation; attempt 2 incomplete with the right versions; swarm-verify test "fails Stryker 10.1.1 against the latest 9.x, whatever the model claimed" | met |
| 5 | Per-task input no longer grows linearly with turns; reduction measured on reruns | section 4 token comparison; loop-context.test.ts "stays bounded over 40 turns"; c1's 56 turns peaked at 12,172 a turn | met |
| 6 | Copied venv interpreter and quoted-script path refusals fixed at the root, with tests | venv: 2e9ac5733, 5aaaa636e, 6f966a671 (python-environment.integration.test.ts failed before); quoted paths: 83ba574bc, 0c89d452a, 1aac319da (8 of the 9 recorded quoted-text refusals now allowed, the ninth a real /tmp write) | met |
| 7 | No AI attribution trailer on either work branch | 0 `Co-Authored-By` or `Claude-Session` lines in 5f1b5472b..b673c1f3d (128 commits) and in 7132869..origin/main (232 commits), and none in the follow-up commits | met |
| 8 | Machine restored | Ollama, colima and Rapid-MLX stopped, docker context default; every repository under `/Users/brad/projects` checked for refs, reflog entries, tags, stashes, worktrees, local config and clones from a run: none (section 6) | met |

## 3. Defects fixed (Phase B and after)

| Defect | Failing before | Passing after | Commit |
| --- | --- | --- | --- |
| A version constraint in the task's wording was not held | swarm-verify "fails Stryker 10.1.1 against the latest 9.x, whatever the model claimed" (status satisfied); orchestrator "holds the task's version constraints on R1, and no proposal rewrites, drops or adds one" | both pass; slice "fails an upgrade past the version the task's wording allows" | swarm-verify ea3e8b5; orchestrator a71f2895c |
| The report showed the model's reading without the task's wording | report.test.ts, two cases | pass | 5d1752b49 |
| A flaky test read as a regression | swarm-verify reruns.integration.test.ts, divergences.test.ts | pass, flaky kept as uncertainty with bounded reruns | swarm-verify 7706686, 473053a |
| Prompt grew with every turn | loop-context.test.ts "stays bounded over 40 turns": largest turn 85,045, slope 2,175 at a 262,144 context | largest 13,084, slope 109 | 1f7f7f3b6, 303c55790, 87ffbbb2f |
| Path-shaped text inside quoted scripts refused | recorded refusals replayed through the reader | 8 of 9 allowed | 83ba574bc, 0c89d452a, 1aac319da |
| The workspace used the user's copied `.venv` | python-environment.integration.test.ts (imported the user's source) | pass | 2e9ac5733, 5aaaa636e, 6f966a671 |
| Replay ignored the recorded execution | replay tests | pass, exit 5 when it cannot run | swarm-verify 9bd0897, aaeb4b8 |
| Option values after `=` not read as paths | guard-attacks.test.ts | pass | 3787c1942 |
| Concurrent checkouts deleted each other's test fixture parents | "spawn git ENOENT" in gates | per-process directories | swarm-verify 21b4b81; orchestrator 6baec5d43 |
| The git worktree workspace let `git branch`, `git tag` and `git config` write into the user's repository | outside-worktree.integration.test.ts "leaves the user's repository, its remote and the files beside it as they were" | pass with a shared clone that has no remote | af98ff25d |
| No Python environment for a project without `uv.lock` | t6 attempt-1 "python env not prepared" | `uv lock && uv sync --frozen --all-extras` in the clone | 2d6dd38a3 |
| An unobserved package claim had no usable next action | claimcheck session 20261101T213431-7eaedd | explicit next action | swarm-verify 0e21ae0 |
| The release workflow ran on the `v2` alias and failed | run 41370691236 | trigger `v[0-9]+.[0-9]+.[0-9]+` | swarm-verify 7d52c17 |

## 4. Acceptance

| Category | Task | Session | State | Model and runtime | Input / output tokens | Wall | Replay | Open reason |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Feature with a boundary case | t1 pubprep | 20261101T140245-7b55bf | complete | qwen3.8:27b, Rapid-MLX | 290,094 / 6,135 | 425 s | agrees | |
| Multi-file feature, backward compatible | t2 crossfire | 20261101T142858-cff296 | complete | qwen3.8:27b, Rapid-MLX, 65,536 | 646,974 / 4,653 | 687 s | agrees | |
| Fix a real defect | t3 ruleprobe (`--host`) | 20261101T042617-8a01e0 | complete | swarm-redesign-qwen36-32k, Ollama auto | 560,835 / 4,765 | 322 s | agrees on the host | |
| Fix beside an inherited failure | c1 ruleprobe (`--host`) | 20261101T205458-33e203 | complete | gemma4:31b, Ollama auto | 499,019 / 9,095 | 2,220 s | agrees on the host | |
| Refactor without behavior change | t5b ironroot | 20261101T054940-b71a2a | complete | swarm-redesign-qwen36-32k, Ollama auto | 735,845 / 7,243 | 224 s | agrees | |
| Refactor across modules, tests and config | t6 tracemantle | 20261101T221712-67545b | incomplete | gemma4-31b-greedy-128k, Ollama named, 65,536 | 388,458 / 12,946 | 3,127 s | agrees | recorded limitation: the best attempt broke history_io.py (7 new failures, found by the verifier), the narrower one changed nothing |
| Upgrade a dependency | t7a claimcheck | 20261101T235811-1133bb | complete | gemma4:31b, Ollama auto | 133,999 / 1,099 | 558 s | agrees | |
| Upgrade the runtime | t8 quantproof | 20261101T073344-9bf3e4 | complete | qwen3.6:35b-a3b, Ollama auto | 222,006 / 1,990 | 226 s | agrees | |
| Held back | h1 crossfire | 20261101T103024-67e6ba | complete | gemma4-31b-greedy-128k, Ollama auto | 299,897 / 3,421 | 944 s | agrees | |
| Held back | h2 ironroot | 20261101T203914-4e0ccd | incomplete | qwen3.8:27b, Rapid-MLX | 128,114 / 1,992 | 428 s | agrees | no-progress after 18 turns in both rounds: the source fix made, no test |

Input tokens before and after context management (same task, model and context; the reruns
stopped at different turns, so input per turn is the comparison):

| Task | Before (session, turns, input) | Per turn | After (session, turns, input) | Per turn |
| --- | --- | --- | --- | --- |
| t5a depose, qwen3.8:27b, 65,536 | 20261101T155037-25f560, 46, 844,628 | 18,362 | 20261101T204818-5e8a9e, 6, 32,669 | 5,445 |
| h2 ironroot, qwen3.8:27b | 20261101T142202-e94107, 15, 127,365 | 8,491 | 20261101T203914-4e0ccd, 18, 128,114 | 7,117 |
| t7a claimcheck, qwen3.8:27b | 20261101T133613-26acb8, 19, 161,280 | 8,488 | 20261101T203312-ed53d4, 11, 60,747 | 5,522 |

## 5. Integrity and tamper

- Workspace integrity: src/agent/outside-worktree.integration.test.ts, a scripted auto-approval
  run trying 13 ways out of its workspace. "leaves the user's repository, its remote and the
  files beside it as they were" failed on the git worktree workspace (refs/heads/escaped,
  refs/tags/escaped and a changed .git/config in the user's repository) and passes on the shared
  clone (af98ff25d). "works in a clone with its own .git, and leaves the user's objects and hooks
  untouched" (c56c407f1) fails against the worktree workspace of af98ff25d^ and passes now.
- Publishing is refused in every approval mode, however it is wrapped (src/tools/chokepoint.test.ts).
- Tamper evaluation on swarm-verify 0e21ae0: 20 honest patches, 0 flagged; 24 cheats, 24 flagged
  (swarm-verify eval/results/tamper-2026-11-02T00-10-45-935Z.json).
- The swarm-verify 2.0.0 tarball packs to the same bytes from the work tree, from a fresh clone at
  5d36afd and at 53b6473, and in the release workflow (shasum 87681581d82d0e65a1eb83bfa8601fd76f8cc1cb).

## 6. Publish outcome

- swarm-verify 2.0.0: the release workflow (run 41370689193) failed at publish twice, first
  `ENEEDAUTH` (no Actions secret), then, after `NPM_TOKEN` was set from `~/.npmrc` and the job
  rerun, `EOTP`: the account requires two-factor authentication for writes, which an unattended
  run cannot supply. Published instead from a fresh clone at 53b6473: `npm pack` gave the pinned
  integrity, and `npm publish ./swarm-verify-2.0.0.tgz --access public --auth-type=web` ran under a
  pseudo-terminal until Brad approved it in the browser. Registry integrity equals the pin, so no
  re-pin and no 16.0.1. Published from a workstation, it carries no provenance statement.
- swarm-orchestrator 16.0.0: `v13-main` fast-forwarded 3ceee023e..b673c1f3d and tagged `v16.0.0`.
  CI run 41523265165 success; release run 41523268322 success; npm `latest` 16.0.0, dependencies
  swarm-verify 2.0.0, zod ^4.4.3, smol-toml ^1.8.0. `v13-main` CI had failed at `npm ci` with E404
  for swarm-verify-2.0.0.tgz from the PR #102 merge (run 41330927920) through 3ceee023e (run
  41371153465); it is green now.
- swarm-verify CI: 41370672067 (53b6473), 41372168663 (7d52c17), 41524179977 (eb87133), all success.
- Action `moonrunnerkc/swarm-verify@v2`: the hand-run workflow action-smoke (added on main at
  eb87133) writes a fixture repository with a base commit and a fix with a new test and runs the
  Action on it: run 41524188833, success.
- Clean install (docs/acceptance/2026-10-31/e-dossier-installed/clean-install.txt): into an empty
  prefix, `npm i -g swarm-orchestrator@16.0.0` and `npm i -g swarm-verify@2.0.0`; `swarm --version`
  16.0.0, `swarm-verify --version` 2.0.0. `swarm doctor --models` with Ollama 0.32.14: ten local
  models probed ready, the four cloud entries excluded before loading.
- Dossier task through the clean install, model auto, isolated
  (docs/acceptance/2026-10-31/e-dossier-installed/): the driver's wording named src/walk.ts,
  which dossier does not have, and was corrected to src/adversarial/fs-walk.ts first.
  - Attempt 1 (20261102T210229-519ea0): blocked. dossier's lockfile installs `@ironroot/core`
    from `../ironroot/packages/core-ts`, and the driver had cloned dossier without its sibling.
    The patch was right. Replay diverged (recorded blocked, replayed incomplete): a defect, below.
  - Attempt 2 (20261102T211404-06df43), with ironroot cloned beside it and its package built as
    Brad's checkout has it: complete, R1 satisfied by "walkRepo > should skip .venv directory" and
    "walkRepo > should skip node_modules directory", regression none, isolated in
    node:24@sha256:e7add2a4...; the installed `swarm-verify replay`: agreement, exit 0. 60 steps,
    393,313 / 11,850 tokens, 649 s, stopped by the step budget (a defect, below). Source
    repositories unchanged.
- README drift: neither README said the verifier installs separately or how to replay a run;
  fixed on the follow-up branches (this branch; swarm-verify `docs/readme-replay`).

## 7. Blockers that remain

1. Three defects found after publishing, open because fixing them means 2.0.1 and 16.0.1
   (section 8). Brad's step: decide whether to fix and release them; each has its cause and a
   reproduction in docs/known-issues.md.
2. Follow-up branches unmerged. Brad's step: merge `recovery/2026-11-01-closing` into `v13-main`
   in swarm-orchestrator and `docs/readme-replay` into `main` in swarm-verify. The npm page for
   swarm-verify 2.0.0 shows the published README, without the `replay` line, until the next release.
3. swarm-verify's `NPM_TOKEN` secret holds the login token from `~/.npmrc`, which cannot publish
   under the account's two-factor setting. Brad's step: create a granular token with "bypass
   two-factor authentication" for swarm-verify (or set up trusted publishing) and run
   `gh secret set NPM_TOKEN -R moonrunnerkc/swarm-verify`, or delete the secret. Until then a
   release tag will fail at publish, and only a CI publish carries provenance.
4. Merged branches left on origin: swarm-verify `release/full-version-tags`, `smoke/action-alias`
   and `recovery/2026-10-31`. Brad's step, if wanted: delete them; nothing depends on them.

## 8. Known issues still open

- A relative path after `cd` is resolved against the workspace root (refusing direction).
- The cross-module refactor has no complete run on a local model (recorded limitation).
- A repeated test run never counts as a repeat when the runner prints its clock: the no-progress
  rule compares outputs byte for byte, and vitest prints `Start at` and `Duration`; 36 identical
  passing runs ran to the step budget (src/agent/command-step.ts).
- An unchanged requirements block resent without the completion marker has no limit: 29 repeats,
  the verifier called only by the budget's final verification (src/agent/requirements-step.ts).
- swarm-verify: replay of a refused dependency preparation diverges, because the refusal is
  recorded as dependencies `none` and replay prepares nothing (`swarm-verify/src/verify/prepare.ts`,
  `swarm-verify/src/api/replay.ts`).

Whether this run is done is Brad's call; the registry, CI and the clean install show what is
above.
