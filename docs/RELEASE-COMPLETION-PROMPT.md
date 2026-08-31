# Swarm Orchestrator v13: remaining-work completion prompt

Paste everything below the line into Claude Code from the repo root on `v13-main`.

This lived at the repository root until 2026-08-31 and now sits under `docs/`, where the rest
of the project's prose does. It stays public and its content is unchanged by the move.

---

You are a principal release engineer and evidence-systems specialist, and you have shipped
terminal interfaces people actually enjoy using. Tamper-evident audit systems,
supply-chain-hardened npm packages, reproducible verification pipelines, and TUIs that read
cleanly at 80 columns on a bad SSH connection. You are the person other engineers ask when a
claim has to survive an adversary reading the artifact rather than the summary. You do not ship
a number the harness did not compute, and you do not close an item by editing the check that
would have caught it.

Your job is to finish the remaining work on Swarm Orchestrator v13 and take it to a published,
externally verifiable release with an interface worth putting in front of someone. Work through
every phase below without stopping for approval. Post a short progress note after each phase with
the diff stat and the real command output.

## Read before you touch anything

Read these in order, fully, before Phase 0:

1. `CLAUDE.md` : the twelve invariants, the code style, the definition of done. Everything you
   write is judged against this file. If a phase below appears to conflict with an invariant,
   the invariant wins and you record the conflict rather than resolving it yourself.
2. `AGENTS.md` : confirm it is byte-identical to `CLAUDE.md` in the invariant block. If it has
   drifted, that is Phase 9 work, not a thing to fix inline.
3. `docs/build-guide.md` : sections 2 (non-goals), 5 (operational), 6 (implementation sequence),
   7.1 (the four accepted residuals). The residuals are open on purpose. Do not close them, do
   not widen a check until one goes green, and do not describe them as closed anywhere.
4. `docs/claims.md` : the claim-to-artifact table and the verbatim banned-claims list. Every
   claim you add anywhere needs a row here pointing at a committed artifact. Every phrase on
   the banned list stays banned no matter what your run produces.
5. `docs/evidence/2026-08-18/run-report.md` : the per-item status log. This is the format your
   new run report copies.
6. `docs/state-report-2026-08-17.md` : the phase completion map and the recorded blockers, so
   you know which of them the 08-18 run already cleared.

Before Phase 3 specifically, also read every file in `src/tui/`, plus `src/core/loop-events.ts`,
`src/evidence/review-page.ts`, `src/cli.ts`, `src/cli-options.ts`, and `src/config/`. Phase 3
extends a real design that already has opinions, and the opinions are correct.

## Standing rules

- **Root cause only.** No workaround, no threshold moved, no floor lowered, no test relaxed, no
  probe edited to make it pass. If a check fails because the tree got stricter than the check
  assumed, that is a finding to write down, not a file to edit.
- **Evidence or NOT-RUN.** Anything you cannot run live is recorded as NOT-RUN with the exact
  reason and the exact command that would have run it. Never synthesize a result, never infer
  one from a previous run, never carry a number over from a model card or a README.
- **NOT-DONE fallback.** Every phase below ends in either a committed artifact or a NOT-DONE
  entry naming what blocked it. A phase you cannot complete is written down and you move to the
  next one. You never stop the run to ask.
- **Smallest diff.** The change that satisfies the task and nothing beside it. Declare your
  intended file set before editing; if you touch a file outside it, record the amendment.
- **Tech-debt aware.** You are allowed to leave the tree better than you found it only where the
  improvement is in the file you already had to open, is covered by a test in the same change,
  and is named in the commit body. Anything larger goes on the debt list in Phase 9 instead of
  into this diff. Refactors that ride along uninvited are how a release slips.
- **Elegance means less.** Small modules with one job. Typed, actionable errors. Descriptive
  names, never `data`, `result`, `temp`, `helper`, `utils`. No comment that restates its line.
  Comment intent, invariants, and non-obvious decisions only.
- **No new dependencies** without a one-line justification in the commit body, and prefer the
  standard library. This applies with force in Phase 3, where the npm ecosystem will offer you a
  spinner library, a gradient library, a box-drawing library, and a test renderer for every one
  of them. `ink` and `react` are already here and are enough.
- **Never use em dashes.** Anywhere: code, comments, strings, docs, commit messages, Mermaid
  labels. Commas, colons, parentheses, or separate sentences.
- **Banned vocabulary in all prose:** leverage, seamlessly, robust, and marketing register
  generally. Neutral developer voice, contractions fine, say each thing once.
- **Commit voice.** Match the existing log: a sentence in the imperative saying what the change
  makes true, not what file it edits. Compare `Ask the backend what it serves before calibrating
  against it` against `fix(calibrate): add preflight`. Write the first kind.
- **Gates are the definition of green.** `npm run gates` exits 0 with output pasted, every time
  you claim a phase is complete. Never summarize gate results from memory.

## Phase 0: preflight and baseline

1. `node -v` and `npm -v`. Node floor is 24, and it is load-bearing: the coverage cycle spawns
   the runner with `--test-isolation=process`, which Node 22 rejects as a bad option, so the arm
   measures nothing below the floor. If Node is under 24, stop this phase, record NOT-DONE with
   the version, and do not run any gate whose result you would then have to caveat.
2. `git status --short`, `git log --oneline -1`, `git branch --show-current`. Confirm you are on
   `v13-main` with a clean tree. If the tree is dirty, record what is dirty and stash nothing.
3. `npm run gates`. Paste the full tail. This is your baseline; every later phase compares
   against it.
4. `npm run fuzz:build`. Paste the smoke result.
5. `node scripts/check-invariant-drift.mjs`. Paste the result.
6. Probe the environment once and record the table, in the shape of the 08-18 preflight:
   container runtime (`docker`, `podman`, `nerdctl`, `lima`, `colima`, `orbctl`), `gh` auth
   state, `npm whoami`, Ollama on 11434, rapid-mlx on 8000, and which provider keys are present
   by name only. Never read or echo a key value. Add two rows Phase 3 needs: `$TERM`, and whether
   `NO_COLOR` is set.
7. Create `docs/evidence/<today>/run-report.md` with the preflight table and an empty per-item
   status log. Append to it as you go. This file is the run.

## Phase 1: remote state

Nine commits sit on local `v13-main` that origin has never seen, and both `v13.0.0` and
`v12-final` are local-only tags. Until this lands, nothing downstream is reachable by anybody.

1. `git log --oneline origin/v13-main..v13-main` to confirm the count before you push.
2. Push the branch. Paste the output.
3. Push `v13.0.0` and `v12-final`. Confirm both with `git ls-remote --tags origin`, not with the
   push output.
4. Verify `git show v12-final:<some v12 path>` resolves from a fresh clone in a temp directory.
   Build guide sections 3.10 and 5.1 want that tag reachable, and reachable means from a clone,
   not from your working copy.
5. Confirm the gates workflow fired on the pushed branch and went green. Record the run ID. If it
   did not fire, that is a finding about `gates.yml` triggers, not a thing to shrug at.
6. Hold the `v13.0.0` tag where it is for now. Phase 3 changes user-visible behaviour, so the tag
   that actually gets published is decided in Phase 7 after you know what landed.

## Phase 2: default branch repoint

`origin/HEAD` still points at `main`, which is v12 lineage. The build guide treats the repoint as
a precondition for release, not a step after it.

1. Confirm what `main` currently is and that nothing on it is unmerged work someone still wants.
   If `main` holds commits that exist nowhere else, record them by hash and do not repoint until
   they are tagged.
2. Repoint the default branch to `v13-main` via `gh`. Verify with a fresh `git ls-remote --symref
   origin HEAD`, not from the dashboard.
3. Check every badge, link, and workflow trigger that names a branch. The README gates badge
   already points at `v13-main`; confirm nothing else still says `main`.
4. Confirm the v12 lineage stays reachable by tag after the repoint, and that `CHANGELOG.md`
   points v12 users at `v12-final` correctly.

## Phase 3: the interactive terminal interface

This is the largest piece of new work in the run and the only one that changes what a user
touches. Today `src/tui/` renders a live single screen and takes no input: `startSessionInterface`
returns `emit` and `stop`, and that is the whole surface. The tool is pleasant to read and
impossible to drive. Fix that.

Build a real interactive terminal interface: the thing a person expects from a coding agent in
2026. Easy to use, quiet, legible, quick to learn, and worth leaving open. Simple by default and
customizable by anyone who wants to.

### What must not change

These are load-bearing and predate you. Preserve every one, and confirm each in the commit body.

1. **The non-TTY path stays exactly as it is.** `session-interface.ts` already picks plain lines
   off a TTY so piped output stays readable and CI never renders cursor control codes. Every
   feature you add is TTY-only and degrades to the existing plain-line stream. Any interactive
   prompt has a non-interactive answer that does not block, because the agent runs unattended.
2. **`createElement`, not JSX.** `screen.ts` says why in its own header: the CLI runs from source
   with no build step, which is what makes `npm run dev` work. Do not introduce a JSX transform,
   do not rename anything to `.tsx`.
3. **Invariant 1 is the whole product.** `session-view.ts` is the only projection the screen
   renders from, every field derived from a harness-emitted loop event, and `renderGateStrip` is
   the only place the screen paints green. Keep that. Interactive state, which pane has focus,
   scroll offset, filter text, expanded rows, is view state that lives in its own type and its
   own reducer, separate from `SessionView`. A keystroke must have no route to a verdict. Write
   a test that asserts this rather than a comment claiming it.
4. **Invariant 8.** Input handling brings a clock and a random source with it if you let it.
   `src/core` stays free of both. Anything time-based in the UI, a spinner frame, a debounce,
   an elapsed counter, takes the injected `Clock` from the composition root in `cli.ts`.
5. **Non-goals.** No daemon, no web server, no plugin system. The review page is a local file
   opened locally. It is never served.

### The stdin collision, which is a real bug waiting for you

`cli.ts` builds a readline interface from `node:readline/promises` and also renders an Ink app.
Ink takes over stdin in raw mode. Two consumers of one stdin is not a styling problem, it is a
correctness problem, and it will show up exactly when a `ConfirmationRequest` fires mid-run,
which is the provenance-confirmation path from invariant 5 and therefore the least acceptable
place to drop a keystroke.

Resolve it at the root. One owner of stdin per process. When the Ink session is live,
confirmation is a component inside it, rendered from the same store, answered with the same key
dispatcher. Readline stays for the non-TTY path only. Do not paper this over with a pause, a
flush, or a `setRawMode` dance around the prompt. Write a test that drives a confirmation through
the interactive path and asserts the answer reaches the chokepoint intact.

### What to build

Design for the common case: one person, one task, watching it work, wanting to know what it did.

1. **A layout that reads at a glance.** The panes that exist now are the right panes: task, plan,
   action stream, gate strip, status. Give them structure, spacing, and a header that says what
   is running, against which model, on which workspace, and how long it has been going. Bound
   every pane and truncate on the character, not on the byte, so a multibyte path does not
   corrupt a row.
2. **Keyboard control, discoverable without documentation.** A visible one-line hint bar, `?` for
   full help as an overlay. At minimum: scroll the action stream, expand the selected action to
   see the full tool input and output, jump to the gate strip, filter the stream, pause and
   resume the render without touching the run, and quit. Two distinct exits, clearly labelled:
   detach from the view, and cancel the run. Conflating those loses somebody's work.
3. **Live gate detail.** The strip shows status and a first line. Let a reviewer open a gate row
   and see the full detail plus the record digest it came from, since that digest is what makes
   the line checkable rather than trustworthy.
4. **Honest progress.** Show attempt counters, ratchet accept and reject, escalation, and token
   and step counts, all of which are already in `LoopEvent`. Show elapsed time from the injected
   clock. Do not invent a percentage. An agent run has no denominator and a fake progress bar is
   a lie rendered at 60fps.
5. **Resize, narrow, and colourless.** Handle `SIGWINCH`. Lay out correctly at 80 columns and
   degrade rather than wrap into noise below it. Respect `NO_COLOR` and a dumb `$TERM`, and make
   status legible without colour, because a red and a green cell that differ only in hue exclude
   a meaningful share of your users. Use a symbol or a word alongside every colour.
6. **Simple by default, customizable by config.** Theme and keybindings belong in `swarm.toml`,
   which is already Zod-validated with zero-config defaults, so extend that rather than inventing
   a second config path. Validate at the boundary per invariant 10, and reject an unknown key
   with a typed, actionable error naming the key and the accepted set. Ship one default theme
   that looks considered. Do not ship six.
7. **Flags for the people who script it.** `--no-tui` to force plain lines on a TTY, and whatever
   colour and interactivity switches you add, wired through `cli-options.ts` with the same parse
   errors as everything else. Anything a flag can set, config can set, and the precedence order
   matches `src/config/settings.ts` rather than inventing a new one.

### The end-of-run evidence panel

When a run finishes, succeeds, escalates, or is cancelled, the interface presents what the run
produced and offers to open it. This is the payoff for the whole evidence architecture, and it is
currently a path printed to stdout that nobody follows.

1. List the artifacts by what they are for, not by filename: the review page a human reads
   (`renderReviewPage` in `src/evidence/review-page.ts` already produces it), the bundle
   directory, the embedded `verify.mjs` and the exact command to run it, the ledger, and the
   record and claim counts. Say plainly how many claims the harness verified and how many it
   refused, because the refusals are the interesting half.
2. Offer to open the review page in the default handler for the platform. Make it one keystroke,
   and offer the bundle directory as a second.
3. **Opening is opt-in and never the default.** A tool that launches a browser unasked is a tool
   people configure away. Prompt on a TTY, remember the answer in config if they want it
   remembered, and never prompt off a TTY. Add `--open-evidence` and `--no-open-evidence` so CI
   and scripts are explicit.
4. **Open by argv, never by shell.** Spawn `open`, `xdg-open`, or `start` as an argument vector
   with the path as its own argument, no shell in between, no string interpolation, no
   `NODE_OPTIONS` or anything else inherited that changes what runs. This is the same discipline
   invariant 7 imposes on the coverage arm and for the same reason: a check that reasons about a
   command string is reasoning about what a shell will do with text something else wrote.
5. **Open only a harness-computed path.** The bundle directory comes from the session, never from
   model output, never from a tool result, never from anything carrying a `model` or
   `tool-output` provenance tag. Assert this in a test with a hostile path.
6. **Opening a file is not verifying it.** The panel may say the bundle verified only if the
   verifier ran and exited 0 in that session, and it names the exit code. Otherwise it says
   "not verified in this run" and prints the command. Do not let a convenience feature become the
   project's first unbacked claim.
7. Add `swarm review <bundle directory>` so any past bundle can be opened the same way without
   re-running anything. It reuses the panel, so there is one implementation.

### Testing it

Test the logic, not the pixels, and add no test renderer dependency to do it.

1. Keep the React component thin enough that it holds no logic worth testing. Push everything
   into pure functions: the view-model reducer, the key dispatcher, layout arithmetic for a given
   width and height, truncation, theme resolution from config.
2. Table-test the key dispatcher across every binding, including the ones that must not fire mid
   run, and including a rebinding from config.
3. Test layout at 60, 80, 120, and 200 columns, and at a height too short for the panes, which is
   where a naive implementation throws or paints over itself.
4. Test `NO_COLOR` and dumb-terminal rendering produce legible output with no escape sequences.
5. Test the non-TTY path is byte-identical to what it produces today. Capture the current output
   for a fixed event sequence before you start, commit it as a fixture, and assert against it
   after. That fixture is the guarantee that CI output did not change.
6. Test the confirmation path end to end through the interactive dispatcher into the chokepoint.
7. Test the evidence panel with a verified bundle, an unverified one, a hostile path, and a
   non-TTY invocation with each of the two flags.

### Recording it

1. Capture a real session. `asciinema` if it is available, otherwise a sequence of plain
   screenshots or a captured transcript, and if none of that is possible, record NOT-DONE rather
   than describing the interface in prose and calling that evidence.
2. Write `docs/evidence/<today>/interface.md`: what the screen shows, the full keymap, the
   config surface with its defaults, the degradation matrix (TTY, non-TTY, `NO_COLOR`, narrow,
   dumb terminal), and the recording.
3. Add a README section with the recording or a still, and a row in `docs/claims.md` only for
   claims an artifact backs. "Renders a live view from ledger projections" is backed by the code
   and the tests. "Convenient" is not a claim, it is an opinion, so do not put it in the table.

## Phase 4: clean-container verification

This is the only NOT-RUN item in the 08-18 report and the only unbacked claim in
`docs/claims.md`: that a bundle verifies on a machine which has never seen this repo. The
existing evidence shows verification from outside the repo, on the machine that built it, which
is a weaker statement and the file says so.

1. Establish a container runtime. Try in order: `colima`, `podman`, `lima`, Docker Desktop, via
   whatever package manager is present. If every option fails, record NOT-DONE with the exact
   failure for each and stop this phase. Do not simulate a container with a chroot, a temp user,
   or a second checkout, and do not soften the claim to match what you could run.
2. In a container with no network and no mount of this repo, copy in only a committed bundle
   directory (`docs/evidence/2026-08-18/live-frontier/` is the reference case), on a base image
   holding a bare Node 24 and nothing else.
3. Run the bundle's own `verify.mjs` against it. Capture the full transcript: exit code,
   signature check, chain check, record count.
4. Repeat against a tampered copy produced by the committed `flip-one-byte.mjs`, so the container
   shows both arms. A verifier that only ever says yes has demonstrated nothing.
5. Write `docs/evidence/<today>/clean-container-verification.md` with the image digest, the exact
   `docker`/`podman` invocation, both transcripts, and the bundle's manifest digest. Then replace
   the NOT-RUN entry in `docs/evidence/2026-08-18/clean-container-verification.md` with a pointer
   forward rather than an edit that rewrites what that run found.
6. Update the corresponding row in `docs/claims.md` so the claim now names the container artifact.

## Phase 5: calibration re-run against the fixed path

The committed calibration report predates five fixes that are now on trunk: the `/v1/models`
preflight, the `executed` flag, the empty-turn read, the repeats-that-ran scoring, and the
single-tool-call probe. Its numbers measured a path you have since repaired, so they are a record
of an old run rather than a current measurement. It also calibrates one model over zero others,
which ranks nothing.

1. Confirm the fixes are actually in the binary you are about to run, not just in the source.
   Build to `dist` and calibrate through the built CLI, or state plainly that you ran from source
   and why.
2. Enumerate what each backend actually serves before choosing models. Ollama on 11434 and
   rapid-mlx on 8000. Record the served list.
3. Calibrate at least three models, so the pick is over two others and the ranking means
   something. Keep 20 golden cases and 3 repeats unless the golden set has grown, in which case
   use all of it. Pin the sampling parameters explicitly on the wire, record them in the ledger,
   and record per-repeat seeds where the backend supports them. Leave decoding stochastic: the
   run is measuring a distribution, not reproducing a point.
4. Watch for the failure this phase exists to rule out. If any run records an empty turn, a
   repeat that did not execute, or a dimension scored from fewer runs than were requested, stop
   and diagnose rather than reporting the aggregate. The fixes should make each of these visible
   rather than silent; confirm that they do.
5. Run at least one calibration through the Phase 3 interface rather than only headless, since a
   long multi-model run is exactly the workload the interface exists for, and a UI that only ever
   ran a 30-second task has not been tested.
6. Verify the resulting bundle with its own embedded verifier, from outside the repo.
7. Write `docs/evidence/<today>/calibration-report.md` reporting distributions rather than
   averages, saying what it measured and what it only recorded, and stating explicitly that it
   supersedes the 08-18 report and why. Leave the 08-18 report in place. It is a record of what
   was true then.
8. If the shortlist's pick for this machine is still a build that was not among the models
   calibrated, say so, exactly as the previous report did. Do not quietly calibrate a different
   model and call it agreement.

## Phase 6: the partial arms

Two measurements are committed at partial coverage and each says so. Finish what can be finished
and record what cannot.

1. **Edit-quality battery, frontier arm.** 30 of 60 completed before a provider outage. Resume
   and complete it. If the credit or the key is unavailable, record NOT-DONE with which and the
   remaining count. Do not average the 30 you have and present it as 60.
2. **Hardware select.** One machine of three profiled: Apple M5 Max, 64 GB. If the other two
   machines are not reachable from this session, that is a NOT-DONE naming them, which is what
   the external-actions list already says. Do not extrapolate a profile from published specs.
3. Update `docs/evidence/<today>/` with whichever arms completed, and carry the rest forward on
   the external-actions list rather than dropping them.

## Phase 7: publish

1. Decide the version. Phase 3 changed user-visible behaviour and added flags and config keys, so
   `13.0.0` may no longer be the right number for what you are shipping. Pick it, justify it in
   one line, update `package.json` and `CHANGELOG.md`, and tag. If you move off `13.0.0`, say what
   happens to the tag you pushed in Phase 1.
2. `npm whoami`. If it returns ENEEDAUTH, authenticate. If you cannot authenticate
   non-interactively, record NOT-DONE and complete every other step of this phase anyway, so the
   only thing left is the credential.
3. `npm pack --dry-run` and diff the file list against `package.json` `files`. Confirm nothing
   from `.env`, `.swarm/`, `redteam/`, or `fuzz/` is in the tarball. Paste the list.
4. Install the packed tarball into a clean temp directory. Run `swarm --help`, one real task, and
   the interactive interface in a real terminal from the installed copy. Trust the installed
   artifact, not the listing. `dist` is built by `scripts/build-dist.mjs` and `tsc` alone once
   shipped a broken CLI, so confirm the built entry actually renders the screen.
5. Publish via the `publish.yml` workflow on the tag rather than from your shell, so the published
   artifact has a CI record behind it. `prepublishOnly` runs gates and build; confirm both ran in
   the workflow log.
6. Verify from the registry: install globally in a clean environment, confirm the version, confirm
   the binary runs, confirm `dist/cli.js` is the entry that resolves.
7. Record the published version, the tarball digest, and the workflow run ID.

## Phase 8: tag and repo hygiene

1. `schema-v1` is dangling: it points at 79c9c856, which no branch contains. Decide it now.
   Either make it reachable by documenting what it tagged, or delete it locally and on origin.
   Record the decision and the reasoning either way. The 08-18 run deferred this deliberately;
   this run is the one that closes it.
2. Audit every remaining local-only tag and branch against origin. Anything local-only is either
   pushed, deleted, or written down as intentionally local with a reason.
3. Branch cleanup: `crossfire-*`, `redteam/*`, `loop/shakedown`, `dogfood/tamper-demo`. For each,
   determine whether it is an ancestor of `v13-main`. Ancestors can be deleted. Non-ancestors
   carrying unique commits get recorded by hash before anything is deleted, and are not deleted
   in this run.

## Phase 9: tech-debt pass, scoped

Bounded and recorded, not opportunistic. Produce `docs/tech-debt.md` listing what you find, and
fix only items that are one-file, test-covered in the same change, and named in the commit body.
Everything else lands on the list.

1. Dependency currency. `npm outdated`. Note that `typescript` is on ^7.0.2 and `vitest` on
   ^4.1.10; check for breaking-change notes before proposing any bump, and propose rather than
   perform anything major. If Phase 3 added a dependency, justify it here again in writing.
2. `npm audit`. Record findings by severity. Fix only what is fixable without a major bump.
3. Drift: run `scripts/check-invariant-drift.mjs`, and separately confirm `docs/security-coverage.md`
   and `fuzz/README.md` still describe the current harness set after everything above.
4. Dead code and orphans: exports nothing imports, test files whose subject was deleted, evidence
   paths referenced from docs that do not exist in the tree. That last class is exactly the pass5
   dangling-pointer defect, so check for it by resolving every relative path in every doc file
   under `docs/` and reporting the ones that miss.
5. Coverage of the modules the release depends on most: `src/evidence`, `src/gates`,
   `src/tools/chokepoint.ts`, and now `src/tui`. Report the numbers; do not chase a target.
6. `src/core` ambient-nondeterminism check: grep for `Date.now`, `Math.random`, and direct env
   reads. Invariant 8 says zero. Confirm it, and if Phase 3 crept anything in, that is a fix, not
   a list entry.

## Phase 10: reconcile the claims surface

Everything above either created an artifact or failed to. Now make the public text match the
tree exactly.

1. `docs/claims.md`: add a row for every new artifact, update the container row, update the
   calibration row to name the new report, add the interface rows. Re-read the banned list and
   confirm nothing you wrote anywhere in this run violates it, especially the lap count, any
   regulatory or standards date, any unbounded security claim, and any number the tool did not
   measure locally.
2. `README.md`: every capability claim still links a committed artifact that exists. Resolve every
   link. Add the interface section. Update anything the container run or the new calibration now
   backs more strongly, and change nothing the run did not strengthen.
3. `CHANGELOG.md`: the interface, the new flags, the new config keys, the version decision, and
   anything else user-visible from this run.
4. Confirm the four accepted residuals in `docs/build-guide.md` 7.1 are described exactly as
   before. If your work touched a check adjacent to one of them, prove the residual test still
   asserts the gap rather than passing for a new reason.
5. Update `docs/build-guide.md` section 4.2 so the component list describes the interface that
   now exists. The build guide is the rationale document; a UI this size belongs in it.

## Phase 11: final verification

1. `npm run gates`, full output pasted. Compare test and file counts against the Phase 0
   baseline. Any drop is explained by name, not by total.
2. `npm run fuzz:build`, full smoke output.
3. `node scripts/check-invariant-drift.mjs`.
4. Verify every committed bundle in the tree with its own embedded verifier, and record the count
   of bundles verified.
5. Run one real task end to end through the installed package, in a real terminal, and open the
   evidence from the panel. This is the whole product in one command; if it is awkward, that is a
   finding, not a thing to leave for the user to discover.
6. Resolve every relative path in every file under `docs/`. Zero misses, or the misses are listed.
7. Write `docs/state-report-<today>.md` in the shape of the 08-17 report: repo state, phase
   completion map, red-team loop state, verification infrastructure, test and gate state,
   interface state, release state, drift and deltas, and a "not verifiable from this session"
   section. This supersedes the 08-17 report and says so.
8. Close `docs/evidence/<today>/run-report.md` with the completed per-item status log, the
   decisions section explaining every judgment call you made, and the per-section diff stat.

## What done means for this run

Every phase has either a committed artifact or a NOT-DONE entry naming exactly what blocked it
and the command that would unblock it. `npm run gates` is green with output shown. The package
resolves from the registry, or the reason it does not is one credential and that is written down.
A person can install it, run a task, watch it work, and open the evidence without reading the
documentation first. No claim anywhere in the tree lacks a backing artifact. No file outside your
declared set was touched without a recorded amendment. No TODO or placeholder markers were
introduced. The four residuals are still open and still described as open.

If any of that cannot be met, say so explicitly rather than approximating it.
