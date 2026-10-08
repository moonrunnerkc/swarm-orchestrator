# Running the coding agent

`swarm` is a coding agent for the terminal that leaves a signed, offline-checkable record of
what it ran and what passed. This page is the long form of the README: install, a first run,
how a run is verified, what has been measured, what has not, and what is still open before
the agent can be called production-ready.

## What it is

`swarm` takes a task and a git repository, makes a bounded change, runs your project's checks
over it, and writes a record of every command it ran and every check that passed or failed.
The record is a hash-chained ledger, exported as a signed bundle that carries its own
dependency-free verifier, so anyone can check it later with nothing but Node and without
trusting the machine that produced it.

The model can say whatever it likes. It cannot make a check pass, mark a claim verified, or
change a record after the fact.

**Upgrading from 12.x?** That was a pull-request auditor; 13 and later are a coding agent under
the same package name, with no migration path. Stay on the `v12-final` tag, or pin the major.

## Install

```sh
npm install -g swarm-orchestrator
```

It runs on Node 22 or newer, and every measurement runs on Node 22.8 or newer: the
changed-line coverage measurement spawns node's test runner with process isolation named on
the command line, in the spelling the running Node takes. On 22.0 to 22.7 that one
measurement reports unmeasured and never counts as a pass. `swarm doctor` says which Node it
found and what owns the `swarm` command, and `--fix` repairs an install that an older build is
shadowing.

## Try it

```sh
export ANTHROPIC_API_KEY=...       # or OPENAI_API_KEY, GOOGLE_GENERATIVE_AI_API_KEY,
                                   # or start Ollama and pass --model local:<id>
cd your-repository
swarm "make slugify collapse whitespace and strip punctuation"
```

Keys come from the environment or your OS keychain, never from `swarm.toml`: that file is
committed and cloned, so a key in it has already been shared with everyone holding the
repository. Every command and flag is in [cli.md](cli.md). The first run asks once how
off-allowlist commands should be approved and records the answer in `swarm.toml`; `swarm init`
configures a repository's declared checks without installing anything.

## How it verifies

Every tool call and every check goes through one recording chokepoint, and the record is an
append-only, hash-chained ledger that lives outside the workspace. When a run ends it is
exported as a signed bundle carrying a dependency-free verifier, so the bundle can be checked
anywhere with plain Node.

Six words carry most of the weight. A **gate** is a check declared as data: a command, a
parser, and whether it blocks. The **ratchet** is the rule that a retry may not trade away
tests, assertions or coverage to turn a gate green. A **bond** is one file a passing gate is
handed that it must refuse, so a pass that cannot fail is caught. An **oracle** is the check
you supply that says the task was done, as distinct from nothing broke. **Reach** is whether
that oracle executed the lines a patch added. And **unmeasured** is a verdict of its own:
nobody checked is not the same as checked and passed, and it never renders green.

With a goal contract, the contract's checks are challenged and, under `--strengthen`, a
witnessed gap may be closed by one additive check the harness admits only on its own
observations, after which the code is repaired under the revised contract; the flags are in
[cli.md](cli.md) and the mechanics in [broad-use.md](broad-use.md#challenging-the-checks).

The mechanics, the nine-answer report and worked examples are in [verifying.md](verifying.md).
Retries under the ratchet, sessions and several workers at once are in [using.md](using.md).

## The verifier on its own

The verification above is also a product of its own, [Swarm Verify](https://github.com/moonrunnerkc/swarm-verify),
for a change from any source and with no model. The `swarm` binary carries its commands
(`swarm check`, `swarm ci`, `swarm verify`, `swarm verdict`, `swarm gates`), walked through in
[verify-only.md](verify-only.md); the package, the Action and the integrations are documented
at the verifier's own home.

## Measured

Every number here links to the committed artifact of the thing happening. The full table, and
the list of things that may not be said, is [claims.md](claims.md).

- **One changed byte breaks verification.** The same bundle verified and then tampered with in
  a single byte, exit 0 and exit 1 side by side, with a script to reproduce it:
  [tamper demo](evidence/2026-08-18/tamper-demo).
- **A bundle verifies on a machine that has never seen this repository.** Run in a `node:24`
  container with no network and no mount of this repository:
  [clean-container-verification.md](evidence/2026-08-23/clean-container-verification.md).
- **A green verdict is computed by the harness, and the model cannot produce one.** In a real
  run the model asserted a predicate the language does not parse; the harness rendered it
  `UNVERIFIED` and carried on, twice: [shakedown results](evidence/2026-08-18/shakedown/results.md).
- **A suite passing is not the task being done.** Four of eighteen patches this project's own
  agent and a baseline arm produced over three public TypeScript repositories passed their
  project's whole suite and failed a hidden acceptance test, which is why `swarm ci` reports
  `regression` and `task` as two answers: [verifying.md](verifying.md). That is a measurement
  of those eighteen patches, not a rate for AI-written pull requests in general.
- **The oracle is judged too.** Certified tasks turned out to rest on oracles that could not
  fail. The last false green standing, `commander#1671`, was certified by an oracle that runs
  every line the patch adds and never tests the precedence those lines decide; it is refused now
  because that oracle accepted a change to a line it had run:
  [verifying.md](verifying.md#the-oracle-is-judged-too).
- **The September 6 mined-corpus false-green rate was 0 in 15**, 0.0%, 95% CI [0.0, 20.4], with
  two oracles per task, one handed to the tool and one held back:
  [mined-corpus](evidence/2026-09-06/mined-corpus/README.md). The denominator moved when
  the tool did: four patches both oracles accept are refused because the tool's own oracle never
  ran part of what they changed, five because the sealed half rejects work the held-back half
  accepts, and one because its oracle accepted a change to a line it had run.
- **Twelve tasks reported as unjudgeable were the agent having written nothing at all**, which
  is a model failure and is recorded as one. An earlier 0-of-18 was withdrawn rather than
  corrected quietly: the same test was handed to the tool and then used as the ground truth it
  was scored against, so it agreed with itself:
  [false-green-measurement.md](evidence/2026-09-05/false-green-measurement.md).
- **Of the gates this project agreed not to call itself production-ready without**, the
  historical assessment records eight passing, two partial, two unproven, and two reported
  rather than barred: [beta-gates.md](beta-gates.md).

## What is not claimed

The five that matter most. The full list is in [verifying.md](verifying.md#what-is-not-claimed).

- **It is not production-ready.** The counts above describe the linked campaigns, not a fresh
  measurement of every gate on this checkout. Each row and what would settle it:
  [beta-gates.md](beta-gates.md).
- **Not "fully secure".** The secret detector does known-pattern scrubbing, not secret removal.
  Zero crashes at a fuzz budget is evidence, not proof.
- **The default execution mode is `restricted`, not `isolated`.** A lexical path and program
  policy in front of interpreters unless you pass `--isolation`. Reported before the run starts
  and recorded on the chain rather than quietly assumed, but it is not containment.
- **0 in 15 says "under 20%", not "zero".** That upper bound is the honest half of the rate,
  and it is a rate for that corpus and that build, not for this one.
- **Shown its oracle, a model still gets past this.** A patch written to satisfy a visible test
  has its added lines tested by that test, so the oracle refuses every mutant of them and is
  right to. Bonding asks whether the oracle judged what the patch added. It cannot ask what the
  patch left out, and that is what an adversarial patch does. Requirement-level challenges
  ([broad-use.md](broad-use.md#challenging-the-checks)) ask more of a contract's checks and
  still cannot ask that.

Gates prove mechanical quality, not design quality. What a bundle buys you is that reviewing the
change is fast and its claims are checkable, not that review is unnecessary.

## Roadmap

The implementation is ahead of the evidence needed to call the agent production-ready. The
audit repairs are recorded in [the implementation record](audit-implementation-2026-09-11.md);
the local campaign and every excluded case are in
[the September 11 report](evidence/2026-09-11/local-campaign/report.md). The verifier-first
work and its comparative campaign are tracked in [the verifier-first index](verifier-first/README.md).

- [x] Connect verification, displayed acceptance, cancellation, budgets and recovery to the
      records that establish them. Use standard DSSE signing bytes and literal replacement text.
- [x] Build the campaign machinery: separate case author, checker and solver models; admission
      controls before grading; frozen schedules; actual baseline dispatch; every failed launch
      retained; raw evidence that can be checked from the checkout.
- [x] Run the available Docker security and cleanup matrix. Fourteen declared observations
      passed, with working attack controls and a separate check that ordinary work still runs.
      Repair after abrupt harness death was exercised too.
- [ ] A false-green interval that supports a population claim. The historical 0 in 15 has a
      20.4% upper bound. The new synthetic pilot admits one evaluation case and cannot narrow
      that bound for real work. Freeze an independent population and a sufficient sample first.
- [ ] A denominator the tool did not choose. The new admission pass checks references and
      predetermined counterexamples, but model authorship alone does not establish independence
      or complete requirements. Independent admission and review are still needed.
- [ ] An adversarial verification corpus that covers omitted requirements. Separate local
      models supplied fresh checks and attacks. Mutation of added lines still cannot establish
      that a patch implemented something it left out; the report keeps those outcomes visible.
- [ ] Task success non-inferior to the strongest alternative. The two local baseline arms now
      execute, with matched tasks and budgets. This pilot is too small to establish which tool
      is strongest or to support a non-inferiority claim.
- [ ] Security evidence for every supported backend. Docker was measured here; Podman and
      nerdctl were unavailable. Independent attacks and those runtime matrices remain open.
- [ ] No surviving daemons across the supported runtime boundaries. Docker cleanup passed the
      declared lifecycle cases. Restricted host execution still cannot own a descendant that
      leaves its process group; abrupt harness death requires supervision or later repair.
- [ ] A new user productive in under ten minutes. The fixture and observer procedure are ready.
      No new users were observed, so setup checks cannot close this item.

Each broader claim stays open until its own evidence meets the bar in [beta-gates.md](beta-gates.md).
