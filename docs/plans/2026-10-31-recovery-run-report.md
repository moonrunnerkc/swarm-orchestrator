# Recovery run report, 2026-10-31 to 2026-11-01

The product recovery plan of 2026-10-31 (docs/plans/2026-10-31-product-recovery.md), carried out
in fresh clones under `/Users/brad/projects/recovery-2026-10-31` on branch `recovery/2026-10-31`
in both repositories. The work log with every command's outcome is
`/Users/brad/projects/recovery-2026-10-31/run-log.md` (outside both repositories); the acceptance
evidence is docs/acceptance/2026-10-31/ in this repository.

## 1. Starting and ending commits

| Repository | Start | End (pushed to origin `recovery/2026-10-31`) |
| --- | --- | --- |
| swarm-orchestrator | `v13-main` 5f1b5472bd40f1d6889e8f2304ce4f9361fb9086 | f595ee771fe0d47cd0fc1ed7b89ae3292c2e6f67, then the commit adding this report |
| swarm-verify | `main` 71328695ef1cf8822c6f326e96e5d0888df72db4 | e9958df8a19bf7cbd280e268d041da0e93049194 |

Pushed with `git push -u origin recovery/2026-10-31` in each; `git ls-remote` returned the same
heads. Nothing was pushed to a default branch, no tag was created or moved, nothing was published.

The existing checkout `/Users/brad/projects/swarm-orchestrator` was not worked in: `v13-main` at
cce4bde43, clean, 7 ahead and 0 behind `origin/v13-main` (`git rev-list --left-right --count`
returned `0 7`), as at the start. Its 7 unpushed commits (d89579ff4..cce4bde43, the per-test
judgment work) were cherry-picked onto the work branch at Brad's decision (129039465..61cd81095).

Found while auditing the pushed history: 98 commits in swarm-verify dated 2026-09-27 to
2026-10-24 carry `Co-Authored-By` trailers. They are the orchestrator's own history, brought over
by the history merge c7feeee (filter-repo), and were already on the orchestrator's origin. None of
the recovery's commits carries a trailer (`git log --grep` over each repository's range since the
start commit). Rewriting that history was not done: it is Brad's to decide.

## 2. Phases

| Phase | Exit condition | Evidence | Status |
| --- | --- | --- | --- |
| 0. Lock the product direction | Plan in the repo; product docs say agent plus verifier; one CI command | orchestrator ae53066d4, df1c6bb70, 3e3ec79de, 20d69218d, 25fbd537d; swarm-verify 56942cf; `npm run gates` exit 0 (38 files / 329 tests) | Done |
| 1. Give Swarm Verify ownership | Verifier source and history in swarm-verify; agent consumes it at an exact version | swarm-verify c7feeee (151 commits of history), f63465b (request/result API), 3050a49 (v2 Action from source); orchestrator 642df6593 deleted the embedded copy; `scripts/packed-consumer.test.mjs` passes; two packs from fresh clones gave identical sha512 | Done |
| 2. Repair verification semantics | The eight verifier probes pass | swarm-verify 525e885, e1773d0; `swarm-verify/src/probes/probes.integration.test.ts` 8/8 (before: 8/8 failing, run-log); tamper 20/0 honest, 24/24 cheats | Done |
| 3. Deliver requirement completion | Agent probes and four slices complete | orchestrator 108797b39, eca91962d, 1bc59159f; `src/agent/probes.integration.test.ts` 3/3; `src/agent/slices.integration.test.ts` 4/4 with verify.mjs exit 0 | Done |
| 4. Establish execution trust | Isolated by default; integrity suite; replay | swarm-verify 79dc3f1, f859c26, 674d505; `swarm-verify/src/probes/integrity.integration.test.ts` all pass; 4/4 slice replays agree; orchestrator 890818022 | Done |
| 5. Make local use automatic | Discovery, capacity, readiness, routing, recovery steps; a run with no model flags | docs/acceptance/2026-10-31/models-survey.txt; dossier auto run complete (session 20261101T003354-c4d1fc); Rapid-MLX run complete (20261101T005703-cef65a); provider failure and capacity outputs in the run log | Done |
| 6. Prove the everyday workflow | Every category a replayable successful run; no known false completion | docs/acceptance/2026-10-31/README.md; seven of eight categories complete (t6 is not); one known false completion remains (t7a attempts 1 and 2) | Not complete: see sections 5 and 8 |
| 7. Prepare the release | CI runs gates; versions; packed smoke; Action; branches pushed; machine restored | sections below; orchestrator f9dbfb60f (16.0.0), ae3c5a565 (notes), f595ee771 (smoke); swarm-verify 9b2e4e0, fd0b8a2, 5d3a455, 42fe7ba | Done, publishing left to Brad |

Gates at the end: orchestrator `npm run gates` exit 0, 42 files / 316 tests (at ae3c5a565; the
later commits add documents only); swarm-verify exit 0, 34 files / 199 tests (at 42fe7ba; e9958df
adds a result file only).

## 3. The eleven behavior probes (Appendix A)

git 2.54.0 (Apple Git-157). "Before" is the plan's reproduction against the pinned source and the
failing runs recorded in the run log (Phase 2, Phase 3); "after" is the named test passing at the
ending commits.

| Probe | Observed before | Observed after | Regression test |
| --- | --- | --- | --- |
| Model declares `double(n)` done without the change | stop verified, verdict pass, empty diff | incomplete, R1 unverified, "no change observed" | orchestrator `src/agent/probes.integration.test.ts`: "does not complete a task whose model declares completion without making the change" |
| Correct `half(n)` fix with a new regression test | fail: test changed with source | complete; the new test witnesses the fix | swarm-verify `swarm-verify/src/probes/probes.integration.test.ts`: "accepts a correct source fix that adds its own regression test" |
| Only the expectation weakened | pass without sealed checks | not complete; expectation change named | "does not let a weakened candidate test stand in for the requested behavior" |
| Empty test directory | pass | check `no-tests`, never complete | "never reads zero collected tests as test success" |
| Fix beside an unrelated failing test | whole check pre-existing-failure, unmeasured | requirement satisfied, failure inherited | "separates a repaired requirement from an unrelated inherited failure" |
| New regression in an already failing suite | pre-existing-failure, unmeasured | regression found | "finds a new regression inside a suite that already fails" |
| Correct edit on the last allowed step | step-budget, no verification, no attestation | final verification fresh, attestation of the delivered patch | orchestrator: "judges a correct edit made on the last allowed step" |
| Edit after the last verification | stale verdict, mismatched patch digest | verified again; digests match | orchestrator: "verifies the delivered tree again when an edit followed the last verification" |
| Linked `node_modules` changed between runs | cached baseline reused, verdict flips | never cached; reported linked, not reproducible | "never reuses a baseline measured on linked, mutable dependencies" |
| Ignored `.swarm/` on a second verification | git add error on ignored path | snapshots | "snapshots a repository that ignores the verifier's output directory" |
| Mutation dropping a closing brace | invalid JavaScript recorded as killed | only valid mutants run; invalid ones refused | "counts a mutant as killed only when it is valid code a test caught"; swarm-verify `swarm-verify/src/verify/mutation.test.ts`: "never runs, or counts as killed, a mutant that does not parse" |

## 4. Models

From `swarm doctor --models` (docs/acceptance/2026-10-31/models-survey.txt, Ollama 0.32.14, a
48.0 GiB budget on a 64 GB machine, 32,768-token context):

| Model | Readiness probe | Memory at 32,768 | Outcome |
| --- | --- | --- | --- |
| gemma4-31b-greedy-128k | ready, 26.2 tok/s | 22.8 GiB | eligible; chosen for t7b, h1, t2/h2/t1 in batch 2 |
| swarm-redesign-qwen36-32k | ready, 145.2 tok/s | 24.6 GiB | eligible; chosen for t3, t4, t5b, t7a 1-2, t6; named for t6 attempt 6 |
| qwen3.6:35b-a3b | ready, 145.2 tok/s | 24.6 GiB | eligible; chosen for the Phase 5 auto run and t8 |
| gemma4:31b | ready, 23.7 tok/s | 22.8 GiB | eligible; chosen for the packed smoke run (untried, ranked above worse records) |
| qwen3:0.6b | ready, 272.7 tok/s | 5.0 GiB | eligible, smaller, not chosen |
| gemma4:e2b-it-q8_0 | ready, 138.9 tok/s | 9.0 GiB | eligible, not chosen |
| gemma4:e4b-it-q8_0 | ready, 85.5 tok/s | 12.7 GiB | eligible, not chosen |
| resident-heavy:24b | ready, 37.2 tok/s | 20.1 GiB | eligible, not chosen |
| resident-reason:e4b | ready, 85.5 tok/s | 12.7 GiB | eligible, not chosen |
| mistral-small3.2:24b | ready, 36.5 tok/s | 20.1 GiB | eligible, not chosen |
| resident-fast:2b | not probed | not estimable | excluded: metadata states no attention shape |
| resident-embed:0.6b, qwen3-embedding:0.6b | not probed | n/a | excluded: not chat models |
| deepseek-v4-pro, kimi-k2:1t, kimi-k2.6, glm-5.1 (cloud) | not probed | n/a | excluded: served remotely, no local weights |

Rapid-MLX `malekoo/Qwen3.8-27B-MLX-8bit` (served as qwen3.8:27b) was used by name with
`--endpoint`/`--model`; Metal memory peaked at 41.2 GB in its log. One model was resident at a time
throughout. No model was pulled and no cloud model was called.

## 5. Acceptance

Figures copied from each final run's `report.json`. No run needed Brad's intervention. Details and
every earlier attempt: docs/acceptance/2026-10-31/README.md.

| Task | State | Requirements | Model, runtime | Turns, tokens in / out, wall | Replay |
| --- | --- | --- | --- | --- | --- |
| t1 pubprep (feature, boundary) | complete | R1-R4 satisfied | qwen3.8:27b, Rapid-MLX | 32, 290,094 / 6,135, 425 s | agrees |
| t2 crossfire (multi-file feature) | complete | R1 satisfied | qwen3.8:27b, Rapid-MLX, 65,536 | 38, 646,974 / 4,653, 687 s | agrees |
| t3 ruleprobe (fix; fix beside inherited) | complete | R1 satisfied | swarm-redesign-qwen36-32k, Ollama auto, `--host` | 30, 560,835 / 4,765, 322 s | diverges, as a macOS-only defect must in a Linux replay |
| t4 resident (fix beside inherited) | incomplete | R1 unverified | swarm-redesign-qwen36-32k, Ollama auto, `--host --linked-dependencies` | 22, 209,209 / 2,642, 2,910 s | diverges; environment-limited (section 8) |
| t5a depose (refactor) | incomplete | R1 unverified | qwen3.8:27b, Rapid-MLX, 65,536 | 46, 844,628 / 5,808, 438 s | agrees (replay-2.out, corrected verifier) |
| t5b ironroot (refactor) | complete | R1 satisfied | swarm-redesign-qwen36-32k, Ollama auto | 39, 735,845 / 7,243, 224 s | agrees |
| t6 tracemantle (cross-module refactor) | incomplete | R1 unverified, regression found | swarm-redesign-qwen36-32k, Ollama named, 65,536 | 60, 1,075,815 / 10,300, 1,065 s | diverges by one nondeterministic test |
| t7a claimcheck (dependency upgrade) | incomplete | R1, R2 unverified | qwen3.8:27b, Rapid-MLX | 19, 161,280 / 1,236, 151 s | agrees |
| t7b dependency detector (dependency upgrade) | complete | R1 satisfied | gemma4-31b-greedy-128k, Ollama auto | 11, 56,251 / 302, 224 s | agrees |
| t8 quantproof (runtime upgrade) | complete | R1 satisfied | qwen3.6:35b-a3b, Ollama auto | 34, 222,006 / 1,990, 226 s | agrees |
| h1 crossfire (held back) | complete | R1 satisfied | gemma4-31b-greedy-128k, Ollama auto | 23, 299,897 / 3,421, 944 s | agrees |
| h2 ironroot (held back) | incomplete | R1 unverified | qwen3.8:27b, Rapid-MLX | 15, 127,365 / 1,860, 211 s | agrees |

Cost: none (local runtimes). Seven of the eight categories have a complete, replayable run; the
cross-module refactor (t6) does not after six attempts. One known false completion remains in the
record: t7a attempts 1 and 2 delivered Stryker 10.1.1 against "the latest 9.x".

Packed-install smoke (docs/acceptance/2026-10-31/packed-install-smoke.txt): `npm pack` of both,
swarm-verify-2.0.0.tgz `sha512-tCWl67YK...WrpMA==` equal to the integrity the orchestrator's
lockfile pins, both installed into a clean prefix, the installed agent resolving the installed
verifier, `swarm --version` 16.0.0 and `swarm-verify --version` 2.0.0; one task ("half(n) returns
n; make it return n / 2.") through the installed `swarm` with the model chosen automatically
(gemma4:31b): state complete, R1 satisfied, isolated, exit 0 (session 20261101T161408-d0cd1c);
`swarm-verify replay` by the installed verifier: agreement, exit 0.

## 6. Deterministic integrity checks

Each passes in `npm run gates` at the ending commits; the table with test titles is in
docs/acceptance/2026-10-31/README.md.

| Case | Outcome |
| --- | --- |
| Missing requirement evidence | unverified, with the witnessing tests named |
| Zero tests | `no-tests`, never complete |
| Test weakening | expectation change refused; the base's version judges |
| Modified protected oracle | blocked (sealed held-out file altered) |
| Forged report | verify.mjs exit 6, FAILED report |
| Stale attestation | verify.mjs exit 6, FAILED patch |
| Truncated ledger | verify.mjs exit 6, FAILED ledger |
| Mismatched signer | verify.mjs exit 6, FAILED signature |
| Mutable dependencies | never cached; refused in isolation |
| Invalid mutant | never run, never counted killed |
| Provider failure | tree finalized and verified, recovery step stated |
| Cancellation (SIGINT, SIGTERM, SIGHUP, abort) | finalized as cancelled, worktree removed |
| Pre-existing user edits | started from and left as they were |
| Honest test additions | accepted, witnessed failing before and passing after |
| Approved behavior change | superseded expectation accepted only when authorized, and recorded |
| Publishing and unreadable commands | refused in every mode / under auto approval |

Tamper evaluation on the release candidate (swarm-verify e9958df,
eval/results/tamper-2026-11-01T16-17-34-332Z.json, host): honest patches 20, flagged 0; cheats 24,
flagged 24.

## 7. The optional review

One trial: t7a attempt 2 with `--review` (session 20261101T070045-66c4ac). One extra model turn;
outcome no-finding; the run was a false completion (Stryker 10.1.1 against "latest 9.x") that the
review did not catch. Confirmed findings 0 of 1 run. Decision: off by default (docs/DECISIONS.md,
2026-11-01).

## 8. Irreducible blockers

1. **Orchestrator CI cannot install until swarm-verify 2.0.0 is on npm.** The lockfile resolves
   `swarm-verify@2.0.0` from the registry with integrity `sha512-tCWl67YK...WrpMA==`. Done around
   it: the packed-consumer test and the smoke run install that exact tarball. Step: publish
   swarm-verify 2.0.0 first (section 10), and confirm the published integrity equals the pinned one.
2. **swarm-verify's new release workflow needs an `NPM_TOKEN` secret** in moonrunnerkc/swarm-verify,
   as the orchestrator's has. Step: add it under the repository's Actions secrets before tagging.
3. **The cross-module refactor category has no complete run** (t6 tracemantle, six attempts). Done
   around it: three verifier defects this task exposed are fixed (coverage wrapping, an untracked
   uv.lock from the base run, base-run leftovers), and the last attempt's regression is correctly
   found and attributed. Step: none required to release; a further attempt with a stronger local
   model, or this task given to Brad's usual agent for comparison, would settle the category.
4. **t4 resident cannot be verified on this machine**: its lockfile does not install in a clean
   environment, and its suite runs live inference against any reachable Ollama (it loaded about
   24 GB of models). Step: none for the release; resident's lockfile needs a source build fix
   (curated-tokenizers 0.0.9 on Python 3.13) before it can be verified anywhere clean.
5. **The t7a false completion is a residual of design**: the verifier reads no prose, so a model
   that writes the wrong version into its own package claim is held only by checks. Done around it:
   version ranges in claims, prompt guidance, the report lists every changed file. Step: none to
   release; it is stated in the acceptance README's limitations.

## 9. Known issues (docs/known-issues.md)

- A copied virtual environment runs through the original interpreter (the agent's own test runs
  may import the user's unchanged source; verification is unaffected).
- Path-shaped text inside a quoted script is refused as a path (about 8 of 39 path refusals across
  the acceptance sessions; each cost one turn).

## 10. Release checklist for Brad

Machine state at the end of the run: Ollama stopped (no `ollama` process), colima `swarm-eval`
stopped, `docker context` default, Rapid-MLX stopped; every acceptance source repository at its
recorded HEAD with only its recorded pre-existing changes, no new refs.

1. swarm-verify: add the `NPM_TOKEN` secret to moonrunnerkc/swarm-verify (Settings, Secrets and
   variables, Actions).
2. swarm-verify: merge the work branch and tag.

       cd ~/projects/recovery-2026-10-31/swarm-verify
       git fetch origin
       git checkout main && git merge --ff-only origin/recovery/2026-10-31
       git push origin main
       git tag v2.0.0 && git push origin v2.0.0
       git tag v2 && git push origin v2     # the Action reference @v2; no v2 tag exists today

   The release workflow runs the gates (including the packed install) and publishes. Expected:
   `npm view swarm-verify version` prints `2.0.0`, and `npm view swarm-verify@2.0.0 dist.integrity`
   prints `sha512-tCWl67YKOgC2W7Hf2aGn0y6v4uYKGq9sIdrGIDiWbbp1zCL/1eG+Fjd3yKzRJ+AZoHj6TtLam3SfdXVofrWpMA==`.
   If the integrity differs (a build that is not byte-identical on the runner), re-pin the
   orchestrator before step 3: `npm install --save-exact swarm-verify@2.0.0`, `npm run gates`,
   commit, push.
3. swarm-orchestrator: once swarm-verify 2.0.0 is on npm, merge and tag.

       cd ~/projects/recovery-2026-10-31/swarm-orchestrator
       git fetch origin
       git checkout v13-main && git merge --ff-only origin/recovery/2026-10-31
       git push origin v13-main
       git tag v16.0.0 && git push origin v16.0.0

   CI runs `npm ci` and `npm run gates`; the release workflow checks the tag against package.json
   and publishes. Expected: `npm view swarm-orchestrator version` prints `16.0.0`, with
   `dependencies` `{ "swarm-verify": "2.0.0", ... }`.
4. Your own checkout `~/projects/swarm-orchestrator` still holds the 7 original per-test commits
   (cce4bde43); the merged branch carries them as cherry-picks, so after step 3 `git checkout
   v13-main && git reset --hard origin/v13-main` there brings it level (your call; it discards
   nothing the branch lacks).
5. Optional: `npm i -g swarm-orchestrator@16.0.0` and `swarm doctor --models` on each machine.
