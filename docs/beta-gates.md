# Production beta gates, against what has actually been measured

The build guide's beta gates are the list this project agreed not to call itself production-ready
without. This is where each one stands, with the evidence or the absence of it named. A row with
no proving artifact is `unproven`, not `probably fine`.

**Summary: not production-ready.** Four of twelve gates pass on measured evidence, four are
partially met with the gap named, and four are unproven. The largest gap is gate 3, and it is
larger than this page said yesterday: the false-green rate after the fix is not zero, it is
unmeasured, because the measurement that produced the zero compared the hidden test against
itself.

| # | Gate | Status | Evidence, or what is missing |
| - | ---- | ------ | ---------------------------- |
| 1 | Zero successful host-file, host-secret, provider-key, evidence-store, cross-worker or unauthorised-egress attacks in the maintained corpus | **partial** | The deterministic corpus exists and passes: `src/exec/child-environment.test.ts`, `src/tools/shell-tool.test.ts`, `src/gates/node-command-runner.test.ts`, `src/evidence/store-permissions.test.ts`, `src/tools/isolated-shell.test.ts`. What it is not is an attack corpus written by somebody trying to get past it: every case here was written by the same person who wrote the defence. |
| 2 | Zero accepted test-policy violations in the mutation suite | **pass** | The ratchet rejects test deletion and weakening under the per-test escape hatch; `src/gates/acceptance.test.ts` cases 4 and 5, and the falsification corpus replay. |
| 3 | Zero false greens in at least 400 held-out tasks, with the interval reported | **unproven** | A rate of 22.2% [6.3, 54.7] was measured and fixed, and the rate after the fix is **unmeasured**: the 0 of 18 first reported here had the hidden test on both sides of the comparison, supplied to the tool as its oracle and then used as the ground truth it was scored against, so it agreed with itself on 18 of 18. Withdrawn, with the reasoning kept, in [`false-green-measurement.md`](evidence/2026-09-05/false-green-measurement.md). Measuring the post-fix rate needs a second oracle per task, independent of the one wired in, and the corpus has one. |
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

Gate 3 moved from unproven to measured and then back to unproven. The 22.2% pre-fix rate is real
and the fix for it is real. The 0.0% post-fix rate was not a measurement, and it is withdrawn:
scoring a tool against the same oracle it was handed measures reproducibility, and reporting that
as a false-green rate is the collapse of *unmeasured* into *green* that this project exists to
refuse, committed in the document announcing that it had been avoided elsewhere.
