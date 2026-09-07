# Production beta gates, against what has actually been measured

The build guide's beta gates are the list this project agreed not to call itself production-ready
without. This is where each one stands, with the evidence or the absence of it named. A row with
no proving artifact is `unproven`, not `probably fine`.

**Summary: not production-ready.** Counted against the table below rather than from memory, which
is how the earlier "four of twelve pass" got in here and stayed wrong: **six pass** (2, 4, 5, 6, 8,
11, and 8 passes by not building the thing it guards), **three are partial** with the gap named (1,
9, 10), **two are unproven** (7, 12), and **gate 3 fails on scale**.

Gate 3 is the largest gap and it is now unattended time rather than method or authoring. The rate
is zero on thirteen opportunities across two corpora, upper bound 22.8%. Two mined results were
withdrawn: they ran under `node --test`, which stops reading flags at the first positional
argument, so the title filter that separates the sealed half from the held-back half was ignored
and both oracles ran the same tests. Fixed, and those tasks are being re-scored. The mined corpus removes
the authoring: 111 candidates are already mined and roughly 90 are expected viable, which would
put the bound near 8%. Four hundred is then a matter of mining more repositories and letting the
pass run.

| # | Gate | Status | Evidence, or what is missing |
| - | ---- | ------ | ---------------------------- |
| 1 | Zero successful host-file, host-secret, provider-key, evidence-store, cross-worker or unauthorised-egress attacks in the maintained corpus | **partial** | The deterministic corpus exists and passes: `src/exec/child-environment.test.ts`, `src/tools/shell-tool.test.ts`, `src/gates/node-command-runner.test.ts`, `src/evidence/store-permissions.test.ts`, `src/tools/isolated-shell.test.ts`. What it is not is an attack corpus written by somebody trying to get past it: every case here was written by the same person who wrote the defence. |
| 2 | Zero accepted test-policy violations in the mutation suite | **pass** | The ratchet rejects test deletion and weakening under the per-test escape hatch; `src/gates/acceptance.test.ts` cases 4 and 5, and the falsification corpus replay. |
| 3 | Zero false greens in at least 400 held-out tasks, with the interval reported | **fail, and measured on two corpora** | **0 of 13 combined, 95% CI [0.0, 22.8]**: 11 opportunities against hand-authored held-back oracles ([`second-oracle/`](evidence/2026-09-06/second-oracle/README.md)) and 2 against oracles mined from merged pull requests ([`mined-corpus/`](evidence/2026-09-06/mined-corpus/README.md)). The mined corpus needs no hand-authoring: a merged pull request supplies the base, the task and a specification its own maintainers wrote, split alternately into a sealed half and a held-back one, and a candidate is kept only if its tests provably fail on the base source and pass on the merged tree. 111 candidates mined, 81% viable so far, 50% of scored tasks certified. Reaching 400 is now unattended time rather than authoring. |
| 4 | 99% recovery from injected termination without duplicate committed effects | **pass** | 100 injected kills, 300 committed effects, no duplicates: `src/durable/crash-recovery.test.ts`. |
| 5 | Every stable documented command exists and works in the published artifact | **pass** | `scripts/check-packed-cli.mjs` packs the tarball, installs into an empty directory, reads the command list from the installed build's own help, and runs each. Runs in CI as its own job. |
| 6 | Trusted-identity verification rejects a re-signed bundle from an unknown key | **pass** | `src/evidence/resign-attack.test.ts`: a bundle is edited, rehashed and re-signed with an attacker key; consistency still holds and the identity check refuses it, naming the substituted fingerprint. |
| 7 | Task success statistically non-inferior to the strongest single-agent baseline, cost and latency reported | **unproven** | The arms run and the statistics exist, and no comparison has been made at a size that could support the claim. The golden set does not discriminate: this model solves it first-try, so both arms accept everything and there is nothing for a paired test to work on. The corpus that discriminates has three tasks. |
| 8 | Multi-agent automatic only where held-out evidence shows it earns its place | **pass, by not doing it** | Multi-agent is never automatic: `swarm parallel` is asked for. `learnedRoutingJustified` states the bar for turning learned routing on, nothing has cleared it, and routing follows the calibration and competency table. |
| 9 | Deadline overshoot below 2% in deterministic budget tests | **partial** | One cancellation tree bounds the whole run and hands workers the remainder: `src/exec/run-cancellation.test.ts`. The overshoot percentage itself is not measured, so this is a mechanism with no number against it. |
| 10 | Ctrl-C and abort leave no orphan processes, leases, worktrees or branches | **partial** | Processes and leases: proven. `src/exec/run-process.test.ts` kills a child that outlives its parent; `src/durable/run-store.test.ts` releases leases on repair. Worktrees and branches after a real interrupted parallel run are not covered by a test. |
| 11 | New evidence directories and files reliably 0700 and 0600 | **pass** | `src/evidence/store-permissions.test.ts`, which sets a 000 umask first so it fails without the change rather than passing on the machine that happened to run it. |
| 12 | A new user can install, initialise a policy, make a safe test-backed fix, verify signer identity, and understand the result in under ten minutes | **unproven** | Every step exists and none has been timed with a person who had not seen the tool. |

## The three that are unproven, and why they are hard

**An adversarial corpus written by an adversary (1).** Every security case in this repository was
written by whoever wrote the defence, which is the weakest form of the evidence. The red-team
directories are closer, and they were also self-run.

**A baseline comparison (7).** This needs tasks hard enough that a strong model fails some of
them, and enough of those tasks for a paired test to say anything. Three is not enough and the
golden set is too easy. Authoring more tasks with hidden oracles is the work, and it is work
somebody has to do by hand.

**A ten-minute first run (12).** Needs a person who has not seen the tool, and a stopwatch.

## What changed

Gates 4, 5, 6 and 11 moved from unproven to passing on measured evidence.

Gate 3 moved from unproven to measured, back to unproven, and then to measured on a different
footing. The 22.2% pre-fix rate is real and the fix for it is real. The 0.0% that followed was not
a measurement and is withdrawn: scoring a tool against the same oracle it was handed measures
reproducibility, and reporting that as a false-green rate is the collapse of *unmeasured* into
*green* that this project exists to refuse, committed in the document announcing it had been
avoided elsewhere.

What replaced it is a second oracle per task, written from the task text, held back from the tool,
and checked for being an instrument before its verdict is read. That arrangement can produce a
false green, and on these eighteen patches it produces none.
