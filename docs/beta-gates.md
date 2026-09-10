# Production beta gates, against what has actually been measured

The build guide's beta gates are the list this project agreed not to call itself production-ready
without. This is where each one stands, with the evidence or the absence of it named. A row with
no proving artifact is `unproven`, not `probably fine`.

**Summary: not production-ready.** Counted against the table below rather than from memory, which
is how the earlier "four of twelve pass" got in here and stayed wrong: **six pass** (2, 4, 5, 6, 8,
11, and 8 passes by not building the thing it guards), **three are partial** with the gap named (1,
9, 10), **two are unproven** (7, 12), and **gate 3 fails on scale**.

Gate 3 is measured and failing on scale. **0 false greens in 14 valid opportunities: 0.0%, 95% CI
[0.0, 21.5].** The bar it set itself is zero over four hundred tasks. The rate is zero and the
sample is fourteen, so this is a failure of scale rather than of the rate, and the two are not the
same finding.

The rate moved from 1 in 19, and how it moved matters more than that it did. **The one false green
that stood is now refused.** dayjs#3181 adds a guard on the instance path and a guard on the static
one; its sealed case exercises the first and never the second, which is exactly where the held-back
case breaks. The write-up said its oracle had run every line the patch wrote. That was never
measured: reach could only be read from node's own test runner, and dayjs runs jest.

**The denominator fell with it, from 19 to 14, and that is a cost rather than a saving.** Three
patches both oracles accept are refused because their oracle never ran part of what they added, and
four more are refused on the sealed half. A tool that refuses more has fewer claims to be wrong
about, so the interval over what is left is wider. Both halves of that are reported wherever the
rate is, and the refusals have their own name, `refused-on-reach`, so they can never be read as
passes.

**Reach now reaches.** It is measured on all 10 mined tasks whose oracle accepted, which is every
task where it can matter, and on 11 of the 18 hand-authored runs. Before, it could be read only
from node's own test runner, which is 10 of the 59 viable mined tasks across 3 of their 13
repositories; the rest run jest, mocha or vitest.

**Nothing was refused wrongly.** Zero false reds across both corpora, on the definition that has
always applied: a patch both oracles accept that the tool refused with no refusal it can point at.

That there is a number here at all is because the corpus was mined rather than hand-authored.
Eleven opportunities written by this project's own authors produced none; the mined ones produced
every false green found. A specification written by maintainers who never heard of this tool tests
what they cared about, not what its author thought to check.

Scale is the whole of what is left, and it is machine time rather than authoring. 192 candidates
are mined, of which 111 have been checked by running them and 59 are viable; the other 81 are
waiting on a viability pass. What a candidate costs after that is one agent run, and what an agent
run buys is an opportunity only where the tool certifies the patch, which on this corpus is 3 of
59. That ratio is the real obstacle to four hundred: the local model fails most of these tasks
outright, and a task nobody can do produces a true red rather than an opportunity.

| # | Gate | Status | Evidence, or what is missing |
| - | ---- | ------ | ---------------------------- |
| 1 | Zero successful host-file, host-secret, provider-key, evidence-store, cross-worker or unauthorised-egress attacks in the maintained corpus | **partial** | The deterministic corpus exists and passes: `src/exec/child-environment.test.ts`, `src/tools/shell-tool.test.ts`, `src/gates/node-command-runner.test.ts`, `src/evidence/store-permissions.test.ts`, `src/tools/isolated-shell.test.ts`. What it is not is an attack corpus written by somebody trying to get past it: every case here was written by the same person who wrote the defence. There is now an adversarial arm for the *verification* surface, `pr-task-pass.mjs --attack`, which shows a model the oracle it will be judged by and asks it to satisfy that and leave an adjacent case broken; it is not the security corpus this gate asks for, and it does not move this row. |
| 2 | Zero accepted test-policy violations in the mutation suite | **pass** | The ratchet rejects test deletion and weakening under the per-test escape hatch; `src/gates/acceptance.test.ts` cases 4 and 5, and the falsification corpus replay. |
| 3 | Zero false greens in at least 400 held-out tasks, with the interval reported | **fail on scale, and measured** | **0 false greens in 14 valid opportunities: 0.0%, 95% CI [0.0, 21.5].** Mined corpus 0 of 3, hand-authored 0 of 11, every row naming the harness commit that judged it. Both false greens ever found are now refused for the same reason, an oracle that never ran the branch the held-back case breaks: koa#1946 at [`first-false-green.md`](evidence/2026-09-07/first-false-green.md), and [`dayjs#3181`](evidence/2026-09-06/mined-corpus/README.md), whose oracle skips lines 141 to 143 of the plugin it certifies. The corpus is 59 viable of 111 candidates rather than 73: fourteen leave because no deal of their added cases leaves both halves failing on the base source, or because their test file does not finish on the base at all, and both were true before and unchecked. Nothing is unjudgeable now, where 21 of 73 were: nine were a half that accepts the base, caught at mining time now, and twelve were the agent having written nothing, which is a model failure and is recorded as one. What the rate costs is in the same row: 3 patches both oracles accept are refused because the oracle never ran part of the change, and 4 on the sealed half, so the certified set is smaller and the interval wider. 14 opportunities is not 400 tasks, and that is the gate. |
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

### 2026-09-09: the reach check learned to see, and the corpus lost a quarter of itself

**Reach was blind on thirteen of the seventeen mined repositories,** and the cause was a category
error rather than plumbing. It was built on invariant 7's evidence rule, an argument vector the
harness assembled with no shell in between, which only node's own runner satisfies. That rule
exists for the ratchet, where a workspace can inflate a number a retry is judged against. Reach can
only turn a green into a refusal, so a workspace that forged its coverage would be handed
`reached`, which is exactly what an oracle nobody could measure already gets. It now reads V8's own
coverage for a runner that loads the file as written, and jest's and vitest's own lcov where they
transform first, and the residual is named where it can be read: those reports are written by the
workspace's own processes and nothing detects a forged one.

**It refused four correct patches over a closing brace.** A coverage report names a bare `}` with
zero hits, because a function whose paths all return early never reaches the implicit end of it,
and all four refusals in the hand-authored corpus were exactly that. A line carrying no character
that could begin an identifier, a number or a string runs no code of its own. Corrected, that
corpus is back to 11 certified and 0 refused on reach, with reach now measured on 11 of its 18 runs
rather than on what node's runner alone could show.

**Fourteen mined candidates left the corpus, and none of them was ever an opportunity.** Ten
because no deal of their added cases leaves both halves failing on the base source, so one oracle
or the other would have accepted a patch that changes nothing; three because their test file does
not finish on the base source at all, which had been read as a file that fails there. The check
that finds them now runs at mining time, where it costs test runs instead of a model run and a
scoring pass.

**Twelve tasks recorded as "the harness could not judge it" are the agent having written nothing.**
Their patch files are zero bytes. The fresh pass records that as a true red and stops; the re-judge
handed the empty file to `swarm ci`, where it did not apply, and the verdict came back `unjudged`.
A sixth of the corpus has been reported as an oracle that could not be run.
