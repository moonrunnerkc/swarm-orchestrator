# Production-readiness run report, 2026-08-18

One session, run start to finish on `v13-main` without pausing for approval. Every decision
point took the stated default; the decision and its reasoning are recorded below. Steps that
could not run live are recorded as NOT-RUN with the exact reason, never synthesized.

## 0. Preflight

| Check | Result |
| --- | --- |
| `node -v` | v24.15.0 (floor is 24; run proceeds) |
| `npm -v` | 11.12.1 |
| Branch | `v13-main` at 4e37753c |
| Working tree | clean apart from untracked `docs/state-report-2026-08-17.md` |
| Baseline `npm run gates` | exit 0, 81 files, 984 tests passed |
| Container runtime | none: no `docker`, no `podman`, no Docker.app, no colima or lima |
| `gh` | 2.92.0, authenticated as `moonrunnerkc`, scopes `gist`, `read:org`, `repo`, `workflow` |
| `npm whoami` | not logged in (`ENEEDAUTH`) |
| Provider keys | `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `NPM_TOKEN` present in repo-root `.env` (names only; no value read or echoed) |
| Ollama, port 11434 | responds; 11 models present |
| rapid-mlx, port 8000 | responds; serves `qwen3-coder:30b-a3b` |

Consequences carried into the rest of the run: the clean-container verification in section 3
has no runtime to run in and is recorded NOT-RUN there. Everything needing a frontier or a
local model can run.

## Per-item status log

Appended as the run proceeds.

| Item | Status | Note |
| --- | --- | --- |
| 0. Preflight | done | table above |
| 1.1 Merge crossfire-h3 | done, no merge needed | `git branch --contains crossfire-h3` already lists `v13-main`: crossfire-h3 is at 1303aa2c and v13-main is one commit ahead of it. Nothing was stranded. Gates exit 0 and the floor-4 cases in `src/evidence/scrub.test.ts` run on trunk. |
| 1.2 pass5 dangling pointer | done, restored | found in history at cdbe9651 on `redteam/loop/lap-1-attack`; restored byte-exact. Correction record appended at `redteam/loop/state/corrections.jsonl`. |
| 1.3 Lap-accounting addendum | done | `redteam/loop/state/lap-accounting.jsonl`, 10 records, new file so no JSONL was rewritten. |
| 1.4 Housekeeping | done | `redteam/leep/` removed (empty and untracked); fixture README in `state-dryrun/` and `state-wake/`; `schema-v1` recorded below as a known dangling tag. |
| 2.1 Replay findings inputs | done | all five replay clean against a fresh `fuzz:build`; none crashes, none disagrees |
| 2.2 Nested multibyte-key | done, was already closed | `da7b9794` closed it; A/B against `da7b9794~1` shows DISAGREE then AGREE |
| 2.3 ReDoS regression tests | done | `src/tools/regex-safety.test.ts` 34 to 57 tests: octal, non-printable, fail-closed empty probe |
| 2.4 Invariant 9 floor | done | four-character floor and three open gaps stated in CLAUDE.md and AGENTS.md, identical text |
| 2.5 `@types/node` ^24 | done | ^22.20.1 to ^24.13.3, nothing surfaced |
| 2.6 Weekly scan workflow | done, unfired | `.github/workflows/weekly-scan.yml`: Semgrep p/default at WARNING+, OSV-Scanner, fuzz smoke, issue on findings, hard fail if it cannot file one |
| 2.7 `fuzz:build` on push | done, verified remotely | ran green in CI run 32150734348 |
| 2.8 corpus-replay in CI | done, was broken, fixed | skipped 3/3 remotely before; runs 7/7 after `84d2370a` |
| 3.1 Live end-to-end, frontier | done | `live-frontier/`, 42 records, verifier passes, `keySource: keychain` |
| 3.1 Live end-to-end, local | done, third attempt | `live-local/`, 60 records. rapid-mlx failed inside its own streaming, mistral-small3.2 wrote nothing, qwen3.6:35b-mlx completed |
| 3.1 Live keychain signing | done | both manifests say `keychain`, both verifiers confirm `ed25519, keychain key` |
| 3.2 Clean-container verification | **NOT-RUN** | no container runtime on this machine: docker, podman, nerdctl, lima, colima, orbctl all absent. Command committed |
| 3.3 Tamper demonstration | done | one byte, exit 0 and exit 1 side by side, reproducible from the committed bundle |
| 3.4 Live hardware select | done, one machine | Apple M5 Max, 64 GB. Count stated as one; two more on the external-actions list |
| 3.5 Live calibration | done | 60 runs, 1265-record bundle, verifier passes |
| 3.6 Shakedown | done, split arms | criteria committed before running. 6 tasks frontier, 4 local after the credit ran out |
| 3.7 Edit-quality battery | done, one arm | golden set already at 20. Local arm complete, frontier arm 30 of 60 then an outage |
| 3.8 Routing-decision recorder | done | `src/select/routing-record.ts`, written at session open, 5 tests |
| 3.9 Build guide 4.3 fallback | done | amended to match the code; batched into the section 4 pass so the file is written once |
| 4.1 security-coverage.md | done | harness count, floor, ReDoS status, all five findings, corpus-replay CI answer |
| 4.2 fuzz/README.md | done | all eight harnesses; both traps untouched |
| 4.3 AGENTS.md sync + CI check | done | all twelve invariants identical; `scripts/check-invariant-drift.mjs` in CI |
| 4.4 Build guide corrections | done | 4.3 fallback, the chokepoint stub line, the missing prompts file reference |
| 5.1 Build to dist | done | `tsconfig.dist.json` plus asset copying; tsc alone shipped a broken CLI |
| 5.2 Package hygiene | done | allowlist, `prepublishOnly`, `private: false`, all in one commit |
| 5.3 Publish workflow | done, not triggered | `.github/workflows/publish.yml`, tag or dispatch only |
| 5.4 LICENSE | done | ISC, carried forward from v12; no default needed |
| 5.5 README | done | every capability claim links a committed artifact |
| 5.6 CHANGELOG | done | the 12 to 13 break, v12 users pointed at `v12-final` |
| 5.7 docs/claims.md | done | claim-to-artifact table plus the banned list verbatim |

## Decisions

**1.1 crossfire-h3 needed no merge.** The branch is an ancestor of `v13-main`, so a merge
would have been a no-op commit. Recorded rather than manufactured.

**1.2 pass5 restored byte-exact, not repaired.** The suite fails 20 of 51 against current
source. Every failure class checked runs the same way: the tree got stricter than the probe
asserted. `parseTestOutcomes` is not merely guarded, it is gone from `src/gates/parsers.ts`;
the coverage arm refuses an invocation it cannot vouch for rather than correcting it; pass 4
closed the wrapper-array scrub the probe asserts is open. Editing a probe to green it would
forge the record the file is kept as, so nothing was edited and the status is written down
instead. Ten of the twenty failures are classified in the correction record; the other ten
were not individually re-derived and the record says so.

**1.4 `schema-v1` left in place.** The tag points at 79c9c856, which no branch contains, so
it is dangling. Tag deletion is not this run's call, so it is recorded here and left alone.

**2.1 and 2.2 needed no fix, so none was invented.** All five findings inputs replay clean.
`da7b9794` closed all five: it introduced four of them itself as artifacts of faults it
fixed in the same change, which is why they were never written up. The fifth was a
scrub/export disagreement, so absence of a crash proves nothing about it and it was checked
by A/B across the closing commit instead. `src/evidence/scrub.test.ts` already binds all
five as regression cases, so no new test was added for a change that did not happen.

**2.8 was a real defect, and the item found it.** The first push of this run showed
corpus-replay skipping all three tests remotely under a green gates job. `fetch-depth: 0`
was set and was never the problem: actions/checkout creates one local branch, the one being
built, so `git archive main` resolves in every working clone and names nothing on CI. The
1059-diff corpus had never replayed remotely and nothing said so. Fixed by resolving the
revision against git, verified first by reproducing the CI checkout shape locally and then
by the CI run itself.

**Push works.** The ruleset reports "Cannot update this protected ref" and then applies
owner bypass, so `v13-main` pushes. Nothing went on the external-actions list for this.

## Decisions in sections 3 to 5

**Bundles are committed byte-exact rather than redacted.** Each task bundle holds six
absolute home paths, all of them the coverage destination invariant 7 requires the harness to
name outside the workspace. Editing those bytes changes a content address and breaks the
chain the signature covers, so the bundle would stop verifying, and a bundle that does not
verify is not evidence. The prose around them writes `~`. Re-running under a neutral `HOME`
was tried first and blocks forever on a keychain prompt, so it is not a way out.

**Two defects were found by doing section 3 and both were fixed at the root.**

The first: a run that changed nothing scored 0.846. Every gate passes over an untouched tree,
correctly, and the reward saw green, no retries, fast, free. The bandit was being taught that
the model doing the least is the best available. Now zero, with the count taken from the
diff-budget gate's own measure rather than recomputed. Found by a local model that declared
two filenames that do not exist and stopped.

The second: the calibration report cannot tell a repeat that failed from one that never ran.
The frontier arm lost its credit ten cases in, and the ten cases that never executed rendered
`0 of 3 green`, identical to a model that cannot do them. That is the distinction invariant 7
spends its whole length on, missing one layer up. The stop reason was already in every
record; the summary was not reading it.

**The shakedown ran in two arms because the Anthropic balance ran out mid-run.** Six tasks
completed on the frontier model. Task 7 died at step 26 with `credit balance is too low`, and
tasks 8 to 10 died at step 0. The remaining four were re-run on the local model and are
labelled as a separate arm. This is a forced deviation from the criteria file, which named
the frontier model, and it is recorded rather than presented as the original plan. The
criteria themselves were not touched after results were seen.

**Task 1 of the shakedown was already done in the tree.** The chore it named, having
`fuzz/smoke.mjs` print the corpus path it looked in, was already satisfied. It was not
swapped out: replacing a task after seeing its result is the thing writing criteria first
exists to prevent. It is recorded as what it is, and it produced a useful result anyway, a
run that correctly changed nothing and scored zero.

**The shakedown workspaces contain the criteria file.** The clone is of this repository at a
commit that already had `pass-criteria.md`, so agents could and did read it. It describes the
shakedown rather than the tasks, so it is not an answer key, but it is contamination and is
named here rather than left to be discovered.

**The golden set was not extended.** The item asks for twenty or more cases and it holds
twenty. Extending it mid-measurement would have made the two arms incomparable. The class
imbalance, edit 9, test-fix 8, tool-heavy 2, multi-file 1, is stated in the results file so
no per-class number gets read off one case.

**LICENSE needed no default.** Both `main` and `v12-final` carry ISC under moonrunnerkc, so
the v13 tree carries ISC forward. The MIT fallback the item described was not reached.

**One file was committed that this run did not set out to commit.**
`docs/state-report-2026-08-17.md` was untracked at preflight and was swept into `7af44a21`
by a `git add -A docs/`, which is broader than the change that commit describes. The file is
the state report the work list derives from and belongs in the tree, so it stays and this
records it rather than rewriting a published commit to hide it. The lesson is the narrower
`git add` I should have used, and it is the same discipline invariant 12 puts on the agent:
declare what you intend to touch, and when you touch something else, say so.

**Pushes work under owner bypass.** The ruleset reports "Cannot update this protected ref"
and then applies the bypass, so `v13-main` pushed twice during this run and CI ran on both.

## External actions

Everything this run prepared but did not execute, with the exact command. Each is here
because it is irreversible, needs a credential this session does not have, or needs hardware
this machine is not.

**Push the v12 tag and every branch and tag.** The ruleset applies owner bypass on push, and
`v13-main` pushed twice during this run, so this is a matter of doing it rather than a block.

    git push origin v12-final
    git push origin --all
    git push origin --tags

**Push the v13.0.0 tag.** Tagged locally in this run, deliberately not pushed, because
pushing it is what triggers the publish workflow.

    git push origin v13.0.0

**Repoint the GitHub default branch to the v13 lineage.** The histories share no merge base,
so this is a branch repoint rather than a merge. Doing it also fixes the shortlist 404 in
`hardware-select.md`, since the URL the probe fetches points at `main`.

    gh api -X PATCH repos/moonrunnerkc/swarm-orchestrator -f default_branch=v13-main

**Publish, after a human reads the pack contents.** `prepublishOnly` runs the gates and the
build; the tarball is in `npm-pack-dry-run.md`. `npm whoami` reported `ENEEDAUTH` in this
session, so nothing could have been published from here even by accident.

    npm login
    npm publish --provenance --access public

**Run the live select capture on each additional physical machine.** One machine was
available and the report says one. The Phase 4 gate wants three.

    swarm select > select-<machine>.txt

**Verify a bundle in a clean container.** No container runtime exists here, recorded NOT-RUN
in `clean-container-verification.md`.

    docker run --rm -v "$PWD/docs/evidence/2026-08-18/live-frontier:/bundle:ro" \
      node:24 node /bundle/verify.mjs /bundle

**Watch the first weekly scan.** `weekly-scan.yml` fires Mondays and has never run, so
Semgrep and OSV-Scanner in it are unexercised. Trigger it early rather than waiting:

    gh workflow run weekly-scan.yml --ref v13-main
    gh run watch "$(gh run list --workflow=weekly-scan.yml --limit 1 --json databaseId --jq '.[0].databaseId')"

**Complete the second calibration arm.** The frontier arm ran 30 of 60 before the Anthropic
credit ran out. With credit restored, or another provider:

    swarm calibrate --models anthropic:claude-sonnet-5 --repeats 3

The first CI watch is **not** on this list: it happened, twice, and both runs are recorded in
`corpus-replay-ci.md`.
