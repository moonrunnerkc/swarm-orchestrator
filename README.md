<a id="readme-top"></a>

<div align="center">

<h1>Swarm Orchestrator</h1>

<p><strong>A coding agent that must prove its work.</strong></p>

<p>
It makes bounded repository changes, runs the project's real checks, challenges weak evidence,<br />
retries failures without trading away test quality, and records what actually happened,<br />
so the agent's own summary is never the source of truth.
</p>

<p>
  <a href="docs/README.md"><strong>Explore the docs »</strong></a>
  ·
  <a href="docs/evidence/2026-08-18/live-tasks.md">See a real run</a>
  ·
  <a href="https://github.com/moonrunnerkc/swarm-verify">Swarm Verify, the standalone verifier</a>
  ·
  <a href="https://github.com/moonrunnerkc/swarm-orchestrator/issues/new/choose">Report a bug</a>
</p>

[![gates](https://img.shields.io/github/actions/workflow/status/moonrunnerkc/swarm-orchestrator/gates.yml?branch=v13-main&style=for-the-badge&label=gates)](https://github.com/moonrunnerkc/swarm-orchestrator/actions/workflows/gates.yml)
[![npm](https://img.shields.io/npm/v/swarm-orchestrator?style=for-the-badge&label=swarm-orchestrator&color=CB3837)](https://www.npmjs.com/package/swarm-orchestrator)
[![node](https://img.shields.io/badge/node-%E2%89%A522-5FA04E?style=for-the-badge)](package.json)
[![license](https://img.shields.io/badge/license-ISC-blue?style=for-the-badge)](LICENSE)

</div>

---

## What it does

`swarm` takes a task and a git repository. It plans, declares the files it intends to touch,
edits through one recording chokepoint, runs your project's checks as sealed gates, and retries
failures under a ratchet that refuses a fix which trades away tests, assertions or coverage.
When the gates pass it exports a signed, hash-chained evidence bundle that carries its own
dependency-free verifier, so anyone can check what ran, and what passed, with nothing but Node
and without trusting the machine that produced it.

```text
task
  -> the agent plans and declares its files
  -> a bounded change, every tool call recorded
  -> the project's checks run as sealed gates
  -> weak evidence is challenged: a passing check must be shown able to fail
  -> the ratchet: a retry may not trade away tests, assertions or coverage
  -> retry, accept, or refuse with the reason on the record
  -> evidence: a signed bundle anyone can verify offline
```

Here is a real run, committed: [`live-tasks.md`](docs/evidence/2026-08-18/live-tasks.md),
with its bundle in [`live-frontier/`](docs/evidence/2026-08-18/live-frontier). And here is the
packaged tool doing it, installed from a tarball into a directory holding nothing else, against
a workspace it had never seen, recorded in a real terminal:
[`installed-package-run.md`](docs/evidence/2026-08-23/installed-package-run.md).

## Why it is not an ordinary coding agent

The model can say whatever it likes. It cannot make a check pass, mark a claim verified, or
change a record after the fact. Those are the harness's to decide.

- **A claim is not evidence.** A structured claim the model makes names a predicate and a
  record; the harness evaluates it against its own records and renders the verdict. Narrative
  never renders green, and a claim the harness cannot evaluate renders `UNVERIFIED` without
  stopping the run.
- **A pass must be able to fail.** Each passing gate is handed one fixture it has to refuse,
  so a check that cannot fail is caught rather than counted.
- **A retry cannot buy green by deleting tests.** Tests collected, assertions in touched tests
  and covered changed lines cannot decrease across retries; skips cannot increase.
- **Regression and task acceptance are two answers.** A suite passing says nothing broke. Only
  a requirement contract or an acceptance check you supply can say the work was done, and the
  tool reports when neither was given.
- **Unmeasured is a verdict.** Nobody checked is not the same as checked and passed, and it is
  never rendered as a pass.

## Install

```sh
npm install -g swarm-orchestrator
```

That is **14.4.0**, and it leaves `swarm` on your path. It runs on Node 22 or newer; Node 24 or
newer is recommended, because the changed-line coverage measurement spawns Node's test runner
with process isolation, which Node 22 below 22.8 rejects. Below that, the measurement reports
unmeasured and never counts as a pass. `swarm doctor` says which Node it found and what owns
the `swarm` command, and `--fix` repairs an install that an older build is shadowing.

## Run one task

```sh
export ANTHROPIC_API_KEY=...       # or OPENAI_API_KEY, GOOGLE_GENERATIVE_AI_API_KEY,
                                   # or start Ollama and pass --model local:<id>
cd your-repository
swarm "make slugify collapse whitespace and strip punctuation"
```

Keys come from the environment or your OS keychain, never from `swarm.toml`: that file is
committed and cloned, so a key in it has already been shared with everyone holding the
repository. The run shows each step, each gate and each retry as it happens, and ends on the
evidence panel. `swarm review <bundle>` opens a run's review page later; `swarm verify <bundle>`
checks its integrity and who signed it. Every command and flag is in
[docs/cli.md](docs/cli.md); sessions, several workers at once and the screen are in
[docs/using.md](docs/using.md).

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## What verification happens

Every tool call and every check goes through one recording chokepoint, and the record is an
append-only, hash-chained ledger that lives outside the workspace. The gates, their severities,
their parsers and the budgets are sealed before the first model call, so nothing the model
does during the run can change what it is measured against.

Six words carry most of the weight. A **gate** is a check declared as data: a command, a
parser, and whether it blocks. The **ratchet** is the rule that a retry may not trade away
tests, assertions or coverage to turn a gate green. A **bond** is one file a passing gate is
handed that it must refuse, so a pass that cannot fail is caught. An **oracle** is the check
you supply that says the task was done, as distinct from nothing broke. **Reach** is whether
that oracle executed the lines a patch added. And **unmeasured** is a verdict of its own.

With a goal contract (`--goal-contract`), the contract's own checks are challenged
(`--challenges report|required`): a base control per requirement, mechanical mutations of the
changed lines witnessed by the suite, and sealed fixtures, so a check that could not have
caught wrong work is named. With `--strengthen`, the model may propose one additive check per
witnessed gap; the harness admits it only where it observes the check reject the counterexample
and accept every sealed reference, then repairs the code under the revised contract. Nothing is
asked of the model before the criteria are sealed.

The mechanics, the nine-answer report and worked examples are in
[docs/verifying.md](docs/verifying.md). The goal contracts, presets and package scope are in
[docs/broad-use.md](docs/broad-use.md).

## What evidence is produced

A run writes its ledger under `~/.swarm/sessions`, never inside the workspace, and exports a
bundle: the manifest with the chain head and the signature, the records, every blob by
SHA-256, the review page, the summary, and `verify.mjs`, a dependency-free verifier that
re-derives every verdict from the records alone.

```sh
node <bundle>/verify.mjs <bundle>          # anywhere, nothing installed
swarm verify <bundle> --signer <fp>        # here, with the signer judged too
```

Every number here links to the committed artifact of the thing happening; the full table, and
the list of things that may not be said, is [docs/claims.md](docs/claims.md).

- **One changed byte breaks verification.** The same bundle verified and then tampered with in
  a single byte, exit 0 and exit 1 side by side, with a script to reproduce it:
  [tamper demo](docs/evidence/2026-08-18/tamper-demo).
- **A bundle verifies on a machine that has never seen this repository.** Run in a `node:24`
  container with no network and no mount of this repository:
  [clean-container-verification.md](docs/evidence/2026-08-23/clean-container-verification.md).
- **A green verdict is computed by the harness, and the model cannot produce one.** In a real
  run the model asserted a predicate the language does not parse; the harness rendered it
  `UNVERIFIED` and carried on, twice: [shakedown results](docs/evidence/2026-08-18/shakedown/results.md).
- **A suite passing is not the task being done.** Four of eighteen patches this project's own
  agent and a baseline arm produced over three public TypeScript repositories passed their
  project's whole suite and failed a hidden acceptance test, which is why `regression` and
  `task` are two answers: [docs/verifying.md](docs/verifying.md). That is a measurement of
  those eighteen patches, not a rate for AI-written changes in general.
- **The oracle is judged too.** Certified tasks turned out to rest on oracles that could not
  fail; the last false green standing was refused because its oracle accepted a change to a
  line it had run: [docs/verifying.md](docs/verifying.md#the-oracle-is-judged-too).
- **The September 6 mined-corpus false-green rate was 0 in 15**, 95% CI [0.0, 20.4], with two
  oracles per task, one handed to the tool and one held back:
  [mined-corpus](docs/evidence/2026-09-06/mined-corpus/README.md).

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## What it does not prove

The five that matter most. The full list is in
[docs/verifying.md](docs/verifying.md#what-is-not-claimed).

- **It is not production-ready.** The counts above describe the linked campaigns, not a fresh
  measurement of every gate on this checkout. Each row and what would settle it:
  [docs/beta-gates.md](docs/beta-gates.md).
- **Not "fully secure".** The secret detector does known-pattern scrubbing, not secret removal.
  Zero crashes at a fuzz budget is evidence, not proof.
- **The default execution mode is `restricted`, not `isolated`.** A lexical path and program
  policy in front of interpreters unless you pass `--isolation`. Reported before the run starts
  and recorded on the chain rather than quietly assumed, but it is not containment.
- **0 in 15 says "under 20%", not "zero".** That upper bound is the honest half of the rate,
  and it is a rate for that corpus and that build, not for this one.
- **Shown its oracle, a model still gets past this.** Bonding and challenges ask whether the
  checks judged what the patch added. They cannot ask what the patch left out, and that is
  what an adversarial patch does.

Gates prove mechanical quality, not design quality. What a bundle buys you is that reviewing the
change is fast and its claims are checkable, not that review is unnecessary.

## Swarm Verify, the standalone verifier

The verification the agent is held to is a product of its own. [Swarm Verify](https://github.com/moonrunnerkc/swarm-verify)
checks a change from any source, this agent, Claude Code, Codex, Copilot, another agent or a
person, with no model, no key and no configuration:

```sh
npx swarm-verify                                   # run a repository's declared checks and report what that establishes
npx swarm-verify ci --pr owner/repo#123            # verify a pull request in a fresh checkout of its base
npx swarm-verify verify <bundle> --signer <fp>     # check a bundle this agent, or anything else, produced
```

It also ships as the GitHub Action `moonrunnerkc/swarm-verify@v1`, a Claude Code hook, an MCP
server and a pre-commit hook. The same commands are in the `swarm` binary: `swarm check`,
`swarm ci`, `swarm verify`, `swarm verdict` and `swarm gates` need no model, and
[docs/verify-only.md](docs/verify-only.md) walks through them over committed artifacts.

There is one implementation. The `swarm-verify` package is built from this repository's
verification modules under [packages/swarm-verify](packages/swarm-verify), behind a build-time
boundary that refuses any provider, worker or screen module; the agent composes those same
modules. Swarm Orchestrator uses Swarm Verify. It is not Swarm Verify.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Versions

The package name has carried three different programs, and the majors are the boundary:

| Versions | What it was |
| --- | --- |
| 8.x | a contract-first coding orchestrator: a goal compiled to typed obligations, persona candidates raced per obligation, verifier-gated commits, a hash-chained ledger |
| 10.x to 12.x | a pull-request auditor: static cheat-pattern detectors over AI-written diffs, advisory by default, with a merge gate. The last of that line is the `v12-final` tag |
| 13.x and later | this coding agent, with no migration path from 12.x and nothing of its interface |
| 14.1.0 | the verification path extracted as the `swarm-verify` package, the same code with none of the agent |
| 14.3.0 | the README and repository description presented Swarm Verify as this repository's product and the agent as a beta mode; 14.4.0 restores the agent as the product of this repository and gives the verifier its own home |

Pin a major. Each release names the verifier version it carries in [CHANGELOG.md](CHANGELOG.md);
the verifier's own changelog is [packages/swarm-verify/CHANGELOG.md](packages/swarm-verify/CHANGELOG.md).

## Contributing

The bar is the one the tool applies to itself: `npm run gates` green with the output shown, new
behaviour covered by a test that failed first, and no claim in a document that its linked artifact
does not establish.

1. Fork the project
2. Create a branch (`git checkout -b feature/amazing-feature`)
3. Run `npm run gates` and paste the real output in the pull request
4. Commit (`git commit -m 'Add an amazing feature'`)
5. Push (`git push origin feature/amazing-feature`)
6. Open a pull request

New dependencies need a one-line justification; the standard library is preferred.
[docs/build-guide.md](docs/build-guide.md) is worth reading before structural work.

## License

Distributed under the ISC License. See [LICENSE](LICENSE).

## Contact

Brad Kinnard, [@KChackerman](https://x.com/KChackerman), bradkinnard@proton.me

Project link: [github.com/moonrunnerkc/swarm-orchestrator](https://github.com/moonrunnerkc/swarm-orchestrator)

<p align="right">(<a href="#readme-top">back to top</a>)</p>
