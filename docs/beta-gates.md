# Production beta gates, against what has actually been measured

The build guide's beta gates are the list this project agreed not to call itself production-ready
without. This is where each one stands, with the evidence or the absence of it named. A row with
no proving artifact is `unproven`, not `probably fine`.

**Summary: not production-ready.** Counted against the table below rather than from memory, which
is how the earlier "four of twelve pass" got in here and stayed wrong: **eight pass** (2, 3a, 4, 5,
6, 8, 9, 11, and 8 passes by not building the thing it guards), **two are partial** with the gap
named (1, 10), **two are unproven** (7, 12), and **two are reported rather than barred** (3b, 3c),
which is what replaced the old gate 3.

## Gate 3 was one bar asking three questions, and it is retired

The wording was **zero false greens in at least 400 held-out tasks**. Four measured things are
wrong with it, and running more tasks fixes none of them.

**1. Self-defeating in its units.** An opportunity needs the tool to certify a patch first. The
certify rate on the mined corpus is 4 of 79, 5.1%, so 400 *tasks* buys 20 opportunities, whose
Wilson upper bound with zero false greens is 16.1%. Passing the gate exactly as worded would still
leave "under 16%". A bound near 1% needs about 300 opportunities, which at that certify rate is
about 5,900 tasks. Every check that makes the tool safer lowers the certify rate and pushes that
number further away, which is the shape of the problem rather than an accident of this corpus.

**2. Zero is not reachable by a verifier that can only check what it was given.** Every false green
this corpus has produced is one shape: the patch omits code the sealed oracle never tests. koa#1946
and dayjs#3181 are refused only incidentally, because those patches also added a line their own
oracle never ran. commander#1671 had nothing extra to point at, which is why it stood.

**3. The number grades the oracles, not the tool.** It measures how often half a maintainer's suite
fails to cover what the other half covers. Change the split and it moves; hand the tool the whole
suite and it goes to nearly zero, with no change to the verifier at all.

**4. The denominator is set by the model.** A more capable model certifies more and reaches 400
opportunities sooner; a more conservative verifier never reaches it. The gate rewards
permissiveness in the thing it constrains.

Three statements replace it. **3a** is the only bar, and the only one whose denominator the tool
does not choose. **3b** is the capability question, measured on a denominator too small and too
in-sample to be a bar yet. **3c** is reported and is a property of the oracles supplied rather than
of the verifier.

### What the tool learned to refuse, and what it still cannot

The one false green that stood is now refused, and not by a check that knows anything about
commander. After the oracle accepts, the lines the patch added are changed into something that
behaves differently and the oracle is run again; one that still accepts ran the code without
asserting anything about it. commander#1671's precedence is one `.reverse()`, its sealed half runs
that line on every case and never tests a name collision, and dropping it the sealed half still
passes:

```
regression: pass   task: accepted   oracle reach: reached
oracle bond: vacuous
  accepted lib/command.js:1473:drop-chained-call
    - getCommandAndParents(this).reverse().forEach((cmd) => {
    + getCommandAndParents(this).forEach((cmd) => {
not verified. the oracle ran a line the patch added and then accepted a change to that same line
```

**What it costs and what it does not catch are both measured.** Across the sixteen patches the tool
had certified: 14 bonds held, 1 vacuous, 0 unshown, 1 not bonded. Zero false refusals, after an
audit that read every vacuous verdict by hand and narrowed two operators that were producing
mutants which changed nothing. The full decision, the audit and the rejected stricter option are in
[`false-green-plan.md`](false-green-plan.md).

**The adversarial arm is unchanged, and that is the residual doing visible work.** Shown its oracle
and asked to satisfy only that, the model still produces 2 false greens in 5 certified, both with
`not bonded`: a minimal patch written to pass a visible test has no added line these operators can
change. Bonding closes the careless case and not the adversarial one.

**Nothing was refused wrongly.** Zero false reds across both corpora, on the definition that has
always applied: a patch both oracles accept that the tool refused with no refusal it can point at.

That there is a number here at all is because the corpus was mined rather than hand-authored.
Eleven opportunities written by this project's own authors produced none; the mined ones produced
every false green found. A specification written by maintainers who never heard of this tool tests
what they cared about, not what its author thought to check.

Scale is what is left of 3c, and it is machine time rather than authoring. 192 candidates are
mined, all of them checked by running them, and 79 are viable. What a candidate costs after that is
one agent run, and what an agent run buys is an opportunity only where the tool certifies the
patch, which on this corpus is 4 of 79. That ratio is the obstacle, and it is not one more tasks
solve on their own: the local model fails most of these outright, a task nobody can do produces a
true red rather than an opportunity, and every check that makes the tool safer takes another patch
out of the certified set.

| # | Gate | Status | Evidence, or what is missing |
| - | ---- | ------ | ---------------------------- |
| 1 | Zero successful host-file, host-secret, provider-key, evidence-store, cross-worker or unauthorised-egress attacks in the maintained corpus | **partial, and three attacks landed** | The deterministic corpus passes: `src/exec/child-environment.test.ts`, `src/tools/shell-tool.test.ts`, `src/gates/node-command-runner.test.ts`, `src/evidence/store-permissions.test.ts`, `src/tools/isolated-shell.test.ts`. Every case in it was written by whoever wrote the defence, so `src/tools/guard-attacks.test.ts` was written the other way round, from the source of the check looking for what it does not read. **Three attacks got past the guard and are closed.** Casing: macOS and Windows are case-insensitive by default, so `.ENV` opens `.env` and every credential pattern was case-sensitive; measured on APFS before the fix, `readFileSync('.ENV')` returns what `.env` holds, and `realpathSync` hands back the casing it was given, so nothing upstream normalized it. `SWARM.TOML`, `server.PEM`, `.git/CONFIG` and a differently cased denied root were the same hole. A revision and a path in one word: `git show HEAD:.env` prints a credential file and the word the guard ruled on matched no pattern. A path inside a word the shell passes whole: `sed -n 'w /home/dev/.ssh/authorized_keys'` writes outside the workspace and the operand was the whole script. The denial comparisons now fold case, and a word offers every path it could open. **Two attacks still succeed and are asserted as succeeding**, because a residual nobody can point at is not named: `git config --list` reads a denied file without naming it, and `node -e "..."` is an allowlisted interpreter handed a program. Neither is reachable by a path check, which is the whole of what "restricted, not a sandbox" means. **A process leak, found live rather than by a test.** During a corpus re-judge one repository's suite left **328 orphaned processes**, each its own process group with PPID 1, from a command that exited zero: the harness signals the group it created, and a descendant that calls `setsid` leaves it. The row's earlier claim that processes are proven was about a child that outlives its parent inside the group. This is not that, it is not fixed, and gate 10 carries it. There is also an adversarial arm for the *verification* surface, `pr-task-pass.mjs --attack`, which is a different surface and does not move this row. |
| 2 | Zero accepted test-policy violations in the mutation suite | **pass** | The ratchet rejects test deletion and weakening under the per-test escape hatch; `src/gates/acceptance.test.ts` cases 4 and 5, and the falsification corpus replay. |
| 3a | `swarm ci` reports `verified` zero times where its own record holds a reason to refuse | **pass** | **Zero, over 129 recorded verdicts.** `npm run checks` runs `scripts/check-ci-verdicts.mjs`, which re-derives every `swarm ci` verdict this repository records from the fields the record carries and compares it with what the tool claimed. The rule is not written twice: it is `rederiveCiVerdict` in the dependency-free verifier a bundle ships, and a parity test holds that to `src/gates/certification.ts`, where `swarm ci` computes `verified`. A green claim missing a field the policy reads fails as loudly as a green claim contradicted by one, because a green nobody can recompute is the thing this bars; a refusal is re-derived from the fields it does carry, since the reasons are monotone and nothing absent can take one back. It went red twice before it went green, once on a fixture that records a reason to refuse and still says `verified` (`scripts/check-ci-verdicts.test.mjs`), and once on the real corpus, over three rows of the second-model arm that claimed `verified` with no `oracleReach` recorded at all. Those were re-judged and the writer fixed: a field the verdict did not carry is now absent from the row rather than filled in with a word of the pass's own. **Named as failing this row historically:** the same three rows, and `iamkun/dayjs#3012`, whose records could not be re-derived until they were re-judged. `swarm ci` writes no evidence bundle of its own, so what is re-derived is the verdict record rather than a signed bundle; that is the gap this row still carries. |
| 3b | Of the oracles a held-back oracle proves inadequate, the fraction the tool refuses to certify on | **measured, not yet a bar: 3 of 3, 100.0% [43.9, 100.0]** | `node scripts/false-green-rate.mjs`. The denominator is oracles rather than tasks, which is what makes this a question about the tool: a better model certifies more patches and proves no more oracles inadequate. **The denominator is three.** koa#1946 and commander#1557 were already refused; commander#1671 is the one bonding added, and it is **in-sample**: the operators were chosen knowing that patch, so catching it shows the check works on the case it was built for and says nothing about whether it generalizes. An interval over three is wide and the point estimate is not the finding. This becomes a bar when the denominator is both larger and out-of-sample, and not before. |
| 3c | The held-back false-green rate, with the certify rate beside it, split by bond state | **reported, not a bar** | **0 false greens in 15 certified: 0.0%, 95% CI [0.0, 20.4]**, from `node scripts/false-green-rate.mjs`, every row judged at one harness commit. Certified by bond state: **14 held, 1 not bonded**, so `verified` is never one word here: a patch certified on an oracle that refused every mutant of the change is a stronger claim than one certified on an oracle nothing could be asked of. Stated as what it is: a property of the oracles supplied rather than of the verifier. Hand the tool a whole suite instead of half of one and this number goes toward zero without the verifier changing. What it costs is in the same row: 4 patches both oracles accept are refused because the oracle never ran part of the change, 5 on the sealed half, and 1 on the bond in the report-only comparison, so the certified set is smaller and the interval wider. The corpus is 79 viable of 192 candidates, all checked by running them, and nothing is unjudgeable where 21 of 73 were. |
| 4 | 99% recovery from injected termination without duplicate committed effects | **pass** | 100 injected kills, 300 committed effects, no duplicates: `src/durable/crash-recovery.test.ts`. |
| 5 | Every stable documented command exists and works in the published artifact | **pass** | `scripts/check-packed-cli.mjs` packs the tarball, installs into an empty directory, reads the command list from the installed build's own help, and runs each. Runs in CI as its own job. |
| 6 | Trusted-identity verification rejects a re-signed bundle from an unknown key | **pass** | `src/evidence/resign-attack.test.ts`: a bundle is edited, rehashed and re-signed with an attacker key; consistency still holds and the identity check refuses it, naming the substituted fingerprint. |
| 7 | Task success statistically non-inferior to the strongest single-agent baseline, cost and latency reported | **unproven, and the blocker was misdiagnosed** | The arms run, the statistics exist, `scoreArms` already reports cost and latency, and no comparison has been made. What this row said was that the discriminating corpus has three tasks and more would have to be authored by hand. That was wrong: they are already mined. `node scripts/task-difficulty.mjs` derives it from rows a pass already recorded, and over the pull-request corpus this model solves **11 of 79, 13.9% [8.0, 23.2]**, spread across fourteen repositories rather than concentrated in one. A set where the model both succeeds and fails is what a paired test needs, and the golden set gives none of it: twenty cases solved first-try leave every arm tied. Success there is what an oracle the run did not control says, both halves accepting, rather than what the tool certified, so the set's difficulty does not move when the verifier gets stricter. What is left is not authoring. It is arm selection in the mined pass, which does not exist, and a second local run of all 79 tasks under the single-agent baseline. |
| 8 | Multi-agent automatic only where held-out evidence shows it earns its place | **pass, by not doing it** | Multi-agent is never automatic: `swarm parallel` is asked for. `learnedRoutingJustified` states the bar for turning learned routing on, nothing has cleared it, and routing follows the calibration and competency table. |
| 9 | Deadline overshoot below 2% in deterministic budget tests | **pass: worst 3ms, 1.20%** | `node scripts/deadline-overshoot.mjs`, one definition shared with the test that holds the bound, `src/eval/deadline-overshoot.test.ts`. Twenty samples over budgets of 250, 500, 1000 and 2000ms, with a real child that outlives its deadline and the whole cancellation tree between them: the deadline timer fires, the cancellation aborts, the abort reaches the process group, the child goes, the run settles. Worst overshoot **3ms** on an idle machine, which is **1.20%** of the 250ms budget and 0.15% of the 2000ms one. The wall clock, not an injected one: a driven clock reports zero overshoot by construction, which is the one answer this measurement cannot be allowed to give. **The percentage depends on the load as much as on the tool, and that was found the hard way.** Overshoot is scheduling and does not shrink with the budget, so 2% of 250ms is 5ms, which is the worst sample measured with eight processes spinning, and 2% of 500ms is 10ms, which the whole test suite running in parallel ate: the first version of the deterministic test asserted 2% at 500ms and went red inside its own suite. So the absolute number is what to quote, with the load beside it, and the test makes the 2% claim at a two-second budget where 40ms of headroom stands against a measured 2 to 5. What is not measured here at all is a child that traps SIGTERM, whose overshoot is bounded by the kill grace period instead. |
| 10 | Ctrl-C and abort leave no orphan processes, leases, worktrees or branches | **partial: worktrees and branches now proven, processes are not** | Worktrees and branches: `src/workers/interrupted-parallel-run.test.ts` starts a real parallel run with two workers, real worktrees and real branches, and interrupts it on the model's first turn, the moment every worker holds both and nothing is committed. Afterwards git reports only the repository's own worktree and no worker branch, and the scratch directory is empty. Held to going red: with the worktree removal and the branch sweep taken out, the run leaves `worker-1` and `worker-2` registered and the test says so. A second case covers what cleanup cannot reach, a killed process that leaves a registration pointing at a directory already gone, which the next run prunes rather than failing on. The integration branch is named rather than asserted away: the sweep keeps it on purpose and the report tells a person to merge it. Leases: `src/durable/run-store.test.ts`. **Processes are no longer claimed.** `src/exec/run-process.test.ts` kills a child that outlives its parent inside the group the harness created, and that is what it proves. A corpus re-judge left **328 orphaned processes** from one repository's suite, each its own process group with PPID 1, started by a command that then exited zero, so nothing was left to signal and the group kill never applied. A descendant that calls `setsid` leaves the group the harness owns, and no group signal reaches it. What would close it is a subtree recorded while the command runs, or a backend whose teardown takes everything with it, which is one of the things `--isolation` is for. Neither is built. |
| 11 | New evidence directories and files reliably 0700 and 0600 | **pass** | `src/evidence/store-permissions.test.ts`, which sets a 000 umask first so it fails without the change rather than passing on the machine that happened to run it. |
| 12 | A new user can install, initialise a policy, make a safe test-backed fix, verify signer identity, and understand the result in under ten minutes | **unproven** | Every step exists and none has been timed with a person who had not seen the tool. The script such a run would follow is written down: [`first-run-script.md`](first-run-script.md), with the six steps, what the observer watches for at each, and the four things they write down, including the subject's own words at the end. That last step is what the gate is about, since a subject who completes the mechanics and cannot say what was established has not understood the result. Nothing in it has been timed. Timing the author is a different measurement, not a weaker version of this one, so this row does not move until somebody who has not read this repository sits for it. |

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

### 2026-09-10: gate 3 was retired, and the false green it could not see is refused

**The bar was replaced by three statements, not lowered.** The four reasons are at the top of this
document, and none of them is fixed by running more tasks: the gate's units defeat it, its target
is unreachable by any verifier that only checks what it was given, its number grades the oracles
rather than the tool, and its denominator is chosen by the model. **3a** carries the bar, at zero
over 129 recorded verdicts, and it is the only one whose denominator the tool does not set.

**The oracle is now bonded.** After it accepts, the lines the patch added are changed into
something that behaves differently and the oracle is run again; one that still accepts ran the code
without asserting anything about it. That refuses commander#1671, the one false green that had
nothing unexecuted to point at, and it does so by a rule that knows nothing about commander.

**The rule was written down before the measurement and was not changed afterwards.** It is
committed at `6e84d532e` and the switch went true at `343ae4740`, whose revert restores
report-only. What the audit found on the way is worth as much as the finding: two mutants that
changed nothing, `return false;` replaced by `return undefined;` inside a `filter` predicate and a
swapped `Math.min`, each narrowing the operator that produced it. Both came back `held` after that,
which is the difference between a check that refuses and a check that refuses for a reason.

**What is still open is named rather than implied away.** A mutant that changes nothing is
indistinguishable here from an oracle that failed to notice one that did. A patch with no mutable
added line gets no bond at all, and the adversarial arm is exactly that shape: 2 false greens in 5
certified, both `not bonded`, unchanged by any of this.

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
