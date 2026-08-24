# Release-completion run report, 2026-08-23

One session, run start to finish on `v13-main` without pausing for approval. Every decision
point took the stated default; the decision and its reasoning are recorded in the decisions
section. Steps that could not run live are recorded as NOT-RUN or NOT-DONE with the exact
reason and the exact command, never synthesized.

This run continues from `../2026-08-18/run-report.md`, which is left in place as the record
of what was true then.

## 0. Preflight

| Check | Result |
| --- | --- |
| `node -v` | v24.15.0 (floor is 24; run proceeds) |
| `npm -v` | 11.12.1 (npm notices 12.0.2 is available; not taken mid-release) |
| Branch | `v13-main` at a5ce696b |
| Working tree | clean apart from untracked `RELEASE-COMPLETION-PROMPT.md` (the work list itself, not committed) |
| Baseline `npm run gates` | exit 0, 88 files, 1082 tests passed |
| Baseline `npm run fuzz:build` | exit 0, 8 harnesses, 84 seeds |
| `node scripts/check-invariant-drift.mjs` | exit 0, 12 invariants identical across CLAUDE.md and AGENTS.md |
| Container runtime | none: `docker`, `podman`, `nerdctl`, `lima`, `limactl`, `colima`, `orbctl` all absent; no container app in /Applications. Homebrew is present at /opt/homebrew/bin/brew |
| `gh` | 2.92.0, authenticated as `moonrunnerkc` (keyring), scopes `gist`, `read:org`, `repo`, `workflow` |
| `npm whoami` | not logged in (`ENEEDAUTH`) |
| Provider keys | `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `NPM_TOKEN` present in repo-root `.env` (names only; no value read or echoed) |
| Ollama, port 11434 | not running at preflight; started with `ollama serve`, then responds with 30 models |
| rapid-mlx, port 8000 | responds; serves `qwen3-coder:30b-a3b` |
| `$TERM` | `xterm-256color` (`COLORTERM=truecolor`) |
| `NO_COLOR` | unset |

Consequences carried into the rest of the run: the clean-container verification in phase 4
has no runtime at preflight and phase 4 begins by trying to install one. Everything needing a
local model can run; the frontier keys authenticate but were unfunded at the 08-18 run and are
re-checked in phase 6 rather than assumed.

The baseline is 88 files and 1082 tests, up from the 84 and 1021 the 08-18 run closed at. The
difference is the five commits that landed after it.

## Per-item status log

Appended as the run proceeds.

| Item | Status | Note |
| --- | --- | --- |
| 0. Preflight | done | table above |
| 1.1 Push `v13-main` | done | 10 commits, `2633f1c1..f16e7f70`, under owner bypass |
| 1.2 Push `v13.0.0` and `v12-final` | done | both confirmed by `git ls-remote --tags origin` and from a fresh clone |
| 1.3 v12 tag reachable from a clone | done | fresh clone in a temp directory; `git show v12-final:package.json` resolves and the v12 tree is intact |
| 1.4 Gates workflow on the pushed branch | done | run `32668575341`, success, 88 files / 1082 tests, fuzz smoke and drift check both in it |
| 1.5 Tag push fired the publish workflow | finding, recorded | run `32668579920` failed at `npm publish` with `E404 ... PUT https://registry.npmjs.org/swarm-orchestrator`. Nothing was published. The provenance statement reached the sigstore transparency log before the 404 (logIndex 2576965290) |
| 1.6 Tag push fired the v12 CD workflow | finding, no effect | run `32668579948`, from the workflows in the v12-final tree, stopped at its own interlock: `tag v12-final does not match package.json 12.1.1; refusing to publish`. No image, no package |
| 2.1 `main` holds nothing unique | done | `origin/main` and local `main` are both `b2b681ff`, which is exactly the commit `v12-final` points at. `git log origin/main..main` is empty |
| 2.2 Repoint default branch | done | `gh api -X PATCH ... -f default_branch=v13-main`, confirmed by `git ls-remote --symref origin HEAD` reporting `ref: refs/heads/v13-main` |
| 2.3 Branch-naming audit | done, one real defect fixed | README gates badge already names `v13-main`. The two curated-JSON URLs named `main` and answered 404; fixed in `4ca7aa0a` |
| 2.4 v12 reachable, changelog correct | done, one correction | tag reachable from a fresh clone. The changelog told v12 users to install `@12.1.1`, which the registry does not carry; corrected in `3f158e21` |
| 3.1 Non-TTY output frozen first | done | `src/tui/fixtures/plain-lines.txt`, captured before any interface work, asserted byte for byte by `src/tui/plain-lines.test.ts` |
| 3.2 The stdin collision | done, fixed at the root | one owner of stdin per process: the confirmation is a component inside the running screen, answered by the same key dispatcher; readline is left to the path where Ink is not running. `src/tui/confirmation-path.test.ts` drives a keystroke through the dispatcher into `createToolChokepoint`, both directions |
| 3.3 The screen | done | header, plan, action stream, expandable detail with the record digest, gate strip, status, hint bar. Keys for scroll, expand, focus, filter, pause, help, evidence, and two distinct exits |
| 3.4 Honest progress | done | elapsed from the injected clock, step, token, attempt and ratchet counters, all from `LoopEvent`. No percentage anywhere, asserted in `screen-model.test.ts` |
| 3.5 Resize, narrow, colourless | done | `SIGWINCH` handled, laid out and tested at 60, 80, 120 and 200 columns and every height from one row to sixty, `NO_COLOR` and `TERM=dumb` captured from real pty runs |
| 3.6 Config and flags | done | `[interface]`, `[theme]` and `[keys]` in swarm.toml, five screen flags, precedence unchanged from `src/config/settings.ts` |
| 3.7 Evidence panel | done | artifacts by purpose, record and claim counts, verified only where the embedded verifier ran here and exited 0, opened by argv on a harness-computed path. `swarm review <bundle>` reuses it |
| 3.8 Recording | done | `interface.cast` (asciinema v2, parsed and converted by asciinema 3.2.1) and `interface-frames.txt`, nine frames from four real pty captures |
| 3.9 `interface.md`, README, claims rows | done | keymap, config surface, degradation matrix; four claims rows, each naming an artifact |
| 4. Clean-container verification | done | `clean-container-verification.md`: both arms in a `node:24` container with no network and no mount of this repository, exit 0 and exit 1 |
| 6.1 Edit-quality battery, frontier arm | **NOT-DONE** | both keys authenticate and neither has a balance, checked live. `partial-arms.md` |
| 6.2 Hardware select, two more machines | **NOT-DONE** | not reachable from this session. `partial-arms.md` |
| 8.1 `schema-v1` | done, kept | the only reference to `79c9c856` anywhere; pushed and documented rather than deleted. `tag-and-branch-hygiene.md` |
| 8.2 Local-only refs | done | three branches with unique commits pushed, two phase tags named as intentionally local |
| 8.3 Branch cleanup | done | nine ancestors deleted with `-d`, hashes recorded first; four non-ancestors kept |
| 9.1 Dependency currency | done | 7 patch bumps proposed, none taken mid-release; `@types/node` held at the runtime floor deliberately |
| 9.2 `npm audit` | done | 0 vulnerabilities |
| 9.3 Drift | done | 12 invariants identical; `fuzz/README.md` current at 8 harnesses; `security-coverage.md` corrected on two counts |
| 9.4 Dangling doc pointers | done, now in CI | `scripts/check-doc-paths.mjs`, run again at the close of the run: 271 references across 30 documentation files, zero misses, 3 named and known, 7 generated |
| 9.5 Coverage | done | chokepoint 98.3%, core 98.8%, evidence 94.4%, gates 94.2%, tui 75.7%, tree 85.2% |
| 9.6 Invariant 8 | done | zero in `src/core`, and the interface work added none |
| 10.4 The four residuals | done, unchanged | build guide 7.1 untouched by this run, all four cases still assert their gaps, suite 49 green |
| 10.5 Build guide 4.2 | done | the component list describes the interface that now exists |
| 7.1 Version decision | done | 13.1.0, minor: everything added is additive and nothing changed meaning. `v13.0.0` stays where it is |
| 7.2 `npm whoami` | **NOT-DONE** | `ENEEDAUTH`, and the `NPM_TOKEN` in `.env` is not a working token: the registry's whoami answers `{}` for it and the collaborators endpoint answers 401. `npm login` needs a browser and an OTP |
| 7.3 Pack against the allowlist | done | 268 files, 311.8 kB, matching `files` exactly. Nothing from `.env`, `.swarm/`, `redteam/`, `fuzz/`, no tests, no fixtures, no `src/` |
| 7.4 Install and run the tarball | done | installed into a clean directory, `dist/cli.js` resolves as the entry, `swarm --help`, `swarm review` against a committed bundle, and a real task end to end, in a terminal and off one |
| 7.5 Publish from the workflow | **NOT-DONE**, and proved to be the credential | run `32685163550` on the `v13.1.0` tag passed the tag/version check, the gates through `prepublishOnly`, and `npm pack`, then failed at `npm publish` with `E404` on the `PUT` |
| 7.6 Verify from the registry | **NOT-DONE** | blocked by 7.5 |
| 7.7 Record the artifact | done | 13.1.0, shasum `84b47d1bccbed715034eb6b595ff08b9f525fc64`, 268 files, run `32685163550` |
| 7.8 GitHub release | done | `v13.1.0` created and marked latest, so the repository sidebar names the v13 lineage rather than the v12 auditor it had named since 2026-07-06 |
| 9.7 The weekly scan, never fired | done, three defects found | dispatched by hand: osv-scanner had never scanned anything, the issue it files could not be filed, semgrep had 21 unseen findings. All three closed or dispositioned |
| 9.8 The schedule itself | done, confirmed the next morning | run `32697714165` fired on the Monday schedule at 06:31 UTC on 2026-08-24 with nobody watching: osv-scanner read the lockfile (259 packages, no issues) rather than exiting 127, semgrep ran its 252 rules over 6102 files, and the issue was filed and labelled. [security-coverage.md](../../security-coverage.md) |
| 5.1 The fixes are in the binary | done | `npm run build`, then `node dist/cli.js calibrate`. Calibrated through the built CLI, not from source |
| 5.2 Enumerate what each backend serves | done | Ollama on 11434 serves 30 models, recorded; rapid-mlx on 8000 serves one, `qwen3-coder:30b-a3b`, which is why a three-model comparison there is not possible |
| 5.3 Three models, 20 cases, 3 repeats | done | 180 runs. Sampling pinned on the wire at temperature 0.7, top-p 0.95, recorded in every model-call record, seed per repeat derived from case, model and repeat number |
| 5.4 Stop and diagnose rather than aggregate | done, and it fired | throughput read 0.0 for all 180 runs of all three models. Root cause: the local provider was built without `includeUsage`, so no `stream_options.include_usage` reached the server and no usage chunk came back. Confirmed against Ollama directly, fixed, and the whole calibration re-run. One repeat genuinely did not execute and is reported as not executed rather than as a zero |
| 5.5 A calibration through the interface | **NOT-DONE** | the screen is wired to `swarm <task>` only. `swarm calibrate` writes plain lines on a terminal and off one, so there is nothing to run it through. A sweep is not one run and the existing screen renders one run, so this is a second view rather than a call site. On `docs/tech-debt.md` with the reasoning |
| 5.6 Verify the bundle from outside the repo | done | `calibration/`, 3720 records, verified from `/tmp` by its own embedded verifier, exit 0 |
| 5.7 `calibration-report.md` | done | distributions rather than averages, supersedes the 08-18 report and says why, which is left in place |
| 5.8 The static pick was not calibrated | done, said so | the shortlist recommends an mlx build rapid-mlx does not serve here; nothing in the run corroborates or contradicts it, exactly as the 08-18 report said |
| 6.3 Update evidence with the arms that completed | done | `partial-arms.md` carries both NOT-DONE arms with the remaining counts and the machines named |
| 10.1 `docs/claims.md` | done | rows added for the interface, the container run, the new calibration, and the installed-package run; the signing row now names both outcomes; banned list re-read and nothing in this run violates it |
| 10.2 `README.md` | done | every capability claim resolves to a committed artifact, checked by `scripts/check-doc-paths.mjs` rather than by eye |
| 10.3 `CHANGELOG.md` | done | the interface, five flags, three config tables, the version decision, and the local-usage fix |
| 11.1 `npm run gates` | done | exit 0, 103 files, 1297 tests, against a baseline of 88 and 1082. No drop anywhere: the difference is 15 new test files from the interface, the doc-path check, the signing messages and the provider fix |
| 11.2 `npm run fuzz:build` | done | exit 0, 8 harnesses, all building |
| 11.3 `check-invariant-drift.mjs` | done | exit 0, 12 invariants identical across CLAUDE.md and AGENTS.md |
| 11.4 Verify every committed bundle | done | 7 bundles, each by its own embedded verifier, each run from `/tmp` rather than from the repository. 7 verified, 0 failed |
| 11.5 A real task through the installed package | done | `installed-package-run.md`, with `live-task.cast` and `open-evidence.cast`. One run green, one escalated at the file-set gate citing its ledger record, both bundles verifying from outside, and the panel reporting `open exited 0` after a browser tab opened |
| 11.6 Resolve every path under `docs/` | done | zero misses, 3 known and named, 7 generated |
| 11.7 `docs/state-report-2026-08-23.md` | done | supersedes the 08-17 report and says so |
| 11.8 Close this report | done | the per-item log above, the decisions below, and the per-section diff stat |

## Decisions, phases 1 and 2

**The v13.0.0 tag push triggered a publish attempt, and that was not the plan.** The work list
says to push both tags in phase 1 and to decide the published version in phase 7, after the
interface work has landed. Those two instructions are in tension, because `publish.yml` fires
on `v*`. The tag was pushed as instructed and the publish ran; it failed at the registry with
`E404` on the `PUT`, so nothing was published and phase 7 still has a free choice of version.
The failure is a credential, not a build: `npm pack` ran, `prepublishOnly` ran the gates, the
tarball was assembled at 268.9 kB over 234 files, and provenance was signed and logged before
the registry refused the write. The `NPM_TOKEN` repository secret exists and does not carry
publish rights for this package.

**Repointing the default branch stops six scheduled workflows.** GitHub fires `schedule`
triggers only from the default branch, and the six on `main` (`agent-stream`, `backward-mine`,
`codex-canary`, `complaint-mine`, `eg-viable-measure`, `pages`) belong to the v12 auditor
lineage. They stop firing as of the repoint. The build guide treats the repoint as a release
precondition, so this is a consequence taken knowingly rather than a surprise, and it is
written here so nobody later reads the silence as breakage. `weekly-scan.yml` on `v13-main`
becomes the scheduled workflow that does fire.

**The curated-JSON 404 was not what the 08-18 report expected.** That report predicted the
repoint would fix `hardware-select.md`'s shortlist 404, because the URL pointed at `main`. It
does not: `raw.githubusercontent.com/<owner>/<repo>/main/...` names the branch `main`, not the
repository's HEAD, so repointing HEAD leaves it resolving to the v12 tree, which carries
neither file. Both URLs now build from one ref that carries them, checked live: 404 before,
200 after.

## Decisions

Every judgment call this run made, with the reasoning, so a reader can disagree with the
decision rather than guess at it.

**Pushing the v13.0.0 tag set off a publish, and the work list asked for both.** Phase 1 says
push both tags; phase 1 also says hold the v13.0.0 tag until phase 7 decides what ships, and
`publish.yml` fires on `v*`. The tag was pushed as instructed, the publish ran, and the registry
refused it. Nothing was published and phase 7 kept a free choice. Recorded rather than tidied
away, because the tension is in the instructions and the next person will hit it too.

**The version is 13.1.0 rather than 13.0.0.** Everything phase 3 added is additive: no flag,
command or output changed meaning, and the plain-line stream is byte-identical. That is a minor.
13.0.0 was tagged and never reached the registry, so that tag stays where it is as the record of
the tree it named rather than being moved onto a different one.

**A container runtime was installed.** The clean-container check had two honest outcomes: run
it, or leave the claim unmade. Simulating a container with a chroot or a second checkout would
have answered a weaker question while looking like an answer to this one. Installing colima is a
change to the machine and not to the tree, which is the objection the 08-18 run raised; that
objection is about not doing it silently, and this run did it and wrote down what it installed.

**`docker cp` rather than a bind mount, and the failure that led there.** The first attempt
mounted the bundle read-only and the verifier reported a missing module: colima maps only part
of the host filesystem into its VM, so the mount arrived empty. An empty directory failing to
verify proves nothing. Both the failure and the switch are in the evidence file, because a
recorded false start is worth more than a clean transcript that hides one.

**`schema-v1` is kept rather than deleted.** The work list offered either. It is the only
reference to `79c9c856` anywhere in the repository, checked against every tag and every branch,
so deleting it would not have tidied a listing, it would have made a commit unreachable. Kept,
pushed so the sole pointer no longer lives on one laptop, and documented by what it tags.

**Nine branches deleted, four kept.** Ancestors of `v13-main` carry nothing `v13-main` does not,
so they were deleted with `git branch -d`, which would have refused any that was not merged.
Non-ancestors carry unique commits and were pushed instead, `redteam/loop/lap-1-attack` most of
all: it is where the 08-18 run recovered the pass5 probe from, and deleting it would have
removed the provenance of a restored artifact while leaving the artifact in place.

**One dependency was added.** `@vitest/coverage-v8`, pinned exactly, dev only. The raw
`NODE_V8_COVERAGE` route reports zero for every source file, because the test runner transforms
modules in memory and nothing outside it can read their coverage. The alternative was to report
coverage as not measured, which would have been honest and less useful than measuring it with
the runner's own first-party provider.

**The calibration was run twice, and only the second one is reported.** The first ran 180 runs
over three models and reported "output tokens per second" as 0.0 for every run of every model.
A dimension that prints the same number for everything is not measuring anything, and the work
list is explicit that a dimension scored from less than it was given is a stop-and-diagnose
rather than an aggregate to report. The cause was a request the harness never sent, the fix is
one option on the local provider, and the second run is against the fixed path. The first run's
numbers are not carried forward: the throughput row would be dishonest and the rest would be
measurements of a different build.

**The keychain entry was left alone.** It holds nine characters that are not an ed25519 key, so
every run of this session signed with a per-run key. The code now says which of the three
keychain failures happened and what to do about it. Overwriting the entry would have fixed the
signature by destroying something nobody has identified, and that is the user's call.

**Nothing was silenced to make a scan green.** Semgrep's 21 findings are dispositioned by class
and none is suppressed; scoping the token rule off the scrubber's own fixtures is the right fix
and is on the tech-debt list rather than done as a release-day footnote. An issue that arrives
every Monday saying the same known thing is one people learn to close unread, which is the
failure mode this project names about gates, so it is worth its own change with its own
evidence.

**Two red CI runs were the check working.** `scripts/check-doc-paths.mjs` resolved documentation
pointers against the filesystem, so a path present on this machine and in no commit passed here
and failed on a clean checkout. That is the same broken pointer to every reader, which is the
whole point of the check, so the local pass was false on exactly the case it was written for.
The second failure was the same mistake one level down, in the code written to remove it. It is
verified now against a fresh clone with nothing built in it, which is what CI is.

## Per-section diff stat

Measured against `a5ce696b`, the commit this run started on, and grouped by the phase whose
commits made each change. Files counted once per group.

| Section | Files | Lines |
| --- | --- | --- |
| 0. Preflight | 1 | +45 / -0 |
| 1 and 2. Remote state, default branch, curated JSON | 7 | +91 / -6 |
| 3. The interface | 44 | +5282 / -172 |
| 4. Clean-container verification | 4 | +139 / -8 |
| 5. Calibration, code and reports | 12 | +351 / -6 |
| 5. Calibration, the bundle | 3725 | +292248 / -0 |
| 6 and 8. Partial arms, tag and branch hygiene | 2 | +184 / -0 |
| 7. Publish, version, release | 5 | +89 / -7 |
| 9. Tech debt, doc paths, scans, signing | 11 | +898 / -87 |
| 10. Claims surface, build guide | 1 | +14 / -2 |
| 11. Reports | 2 | +337 / -0 |

Whole run: **3802 files, +299581 / -191**. Take the bundle row out and it is **77 files,
+7333 / -191**, which is the number worth reading. The 3725-file row is one calibration bundle:
3720 ledger records and their blobs, written by the runs rather than by anyone, and committed
because a report whose numbers cannot be recomputed is a report nobody can check.

The interface is the bulk of the rest, and roughly half of its 5282 lines are tests. The 191
deletions across the whole run are the only lines this release removed, and none of them is a
test: they are the two dead exports named in [tech-debt.md](../../tech-debt.md), the rewrites inside
`scripts/check-doc-paths.mjs` across its two corrections, the `screen.ts` body replaced by the
pure model beside it, and the `cli.ts` lines the end-of-run deferral moved.

## Closing runs

Every one of these ran at the close of the session, on the tree as committed.

    $ npm run gates
    ... exit 0, 103 files, 1297 tests passed

    $ npm run fuzz:build
    ... exit 0, 8 harnesses

    $ node scripts/check-invariant-drift.mjs
    ... exit 0, 12 invariants identical

    $ node scripts/check-doc-paths.mjs
    resolved 271 path reference(s) across 30 documentation file(s), against what git tracks
    zero misses, 3 known and named, 7 generated

    $ for each of the 7 committed bundles: node <bundle>/verify.mjs <bundle>   # run from /tmp
    ... 7 verified, 0 failed

Against the phase 0 baseline of 88 files and 1082 tests, that is 15 more test files and 215 more
tests. Nothing dropped: no test was deleted, skipped or renamed out of the count during this run.

## What this run did not finish

Five things, each with the reason and the command that would unblock it, so nobody has to
reconstruct them from the table:

| Not done | Why | What unblocks it |
| --- | --- | --- |
| The frontier arm of the edit-quality battery, 30 of 60 | both keys authenticate and neither has a balance, checked live during this run | funding either key, then the remaining 30 cases |
| Hardware profiles for two of three machines | neither is reachable from this session | `swarm select` on each machine |
| Publishing to the npm registry | one credential. `npm whoami` answers `ENEEDAUTH`, and the `NPM_TOKEN` in `.env` is not a working token: the registry's whoami answers `{}` and the collaborators endpoint answers 401 | `npm login` in a browser with an OTP, or a token with publish rights on this package as the `NPM_TOKEN` repository secret. The workflow is proved otherwise: run `32685163550` cleared the tag/version interlock, the gates and `npm pack`, and failed only at the `PUT` |
| A calibration watched through the interactive screen | the screen is wired to `swarm <task>`; `swarm calibrate` writes plain lines. A sweep is not one run, so this is a second view rather than a call site | a calibration view with its own layout and tests. On [tech-debt.md](../../tech-debt.md) |
| The keychain signing key | the entry under `swarm-orchestrator/bundle-signing-key` holds nine characters that are not an ed25519 key, so every bundle this session signed carries `keySource: ephemeral` | deleting that entry, after identifying what it is, at which point the next run stores a real key. Not done here because overwriting an unidentified credential is destructive and is the user's call |

The four accepted residuals in [build-guide.md](../../build-guide.md) 7.1 are not on that list. They are open by
design, `build-guide.md` was not touched in 7.1 by this run, and each still has a case in the
adversarial suite asserting the gap exactly as it stood.
