# swarm-orchestrator

[![gates](https://img.shields.io/github/actions/workflow/status/moonrunnerkc/swarm-orchestrator/gates.yml?branch=v13-main&style=flat-square&label=gates)](https://github.com/moonrunnerkc/swarm-orchestrator/actions/workflows/gates.yml)
[![node](https://img.shields.io/badge/node-%3E%3D24-blue?style=flat-square)](package.json)
[![license](https://img.shields.io/github/license/moonrunnerkc/swarm-orchestrator?style=flat-square)](LICENSE)

A coding agent whose claims about its own work resolve to machine-captured evidence.

The model can say whatever it likes. It cannot make a gate pass, it cannot mark a claim
verified, and it cannot change a record after the fact. Those are the harness's to decide,
and the run exports a signed, hash-chained bundle that anybody can check without installing
this tool.

[What it does](#what-it-does) | [Install](#install) | [Use](#use) | [What is claimed](#what-is-claimed) | [What is not claimed](#what-is-not-claimed) | [How it works](#how-it-works) | [Limits](#limits) | [Upgrading from v12](#upgrading-from-v12)

## What it does

Give it a task and a git workspace. It plans, declares the files it intends to touch, edits
through a chokepoint that records every tool call, runs your gates, and retries failures
under a numeric ratchet that refuses a fix which trades away tests, assertions, or coverage.
Then it exports the evidence.

Here is a real run, committed: [`live-tasks.md`](docs/evidence/2026-08-18/live-tasks.md),
with its bundle in [`live-frontier/`](docs/evidence/2026-08-18/live-frontier).

## Install

    npm install -g swarm-orchestrator

Node 24 or newer. That is a runtime floor rather than a preference: the coverage cycle
spawns the test runner with `--test-isolation=process`, which Node 22 rejects as a bad
option, so on anything older that measurement does not happen.

## Use

    swarm "make slugify collapse whitespace and strip punctuation"

    swarm gates                      # run the gates over a workspace, no model
    swarm select                     # probe this machine, recommend a local model
    swarm calibrate                  # measure candidate models on the golden set
    swarm replay <bundle>            # read a bundle back

Set `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` or `GOOGLE_GENERATIVE_AI_API_KEY` for a frontier
model, or start Ollama or rapid-mlx and pass `--model local:<id>`.

## What is claimed

Every line here links to a committed artifact of the thing happening. The full table,
including what backs each one, is [`docs/claims.md`](docs/claims.md).

**A green verdict is computed by the harness, and the model cannot produce one.** In a real
run, the model asserted a predicate the language does not parse. The harness rendered it
`UNVERIFIED (predicate-unparseable)` and carried on, twice, until the model wrote one that
could be evaluated:
[shakedown results](docs/evidence/2026-08-18/shakedown/results.md).

**One changed byte breaks verification.** The same bundle, verified and then tampered with
in a single byte of one record, exit 0 and exit 1 side by side, with a script to reproduce
it: [tamper demo](docs/evidence/2026-08-18/tamper-demo).

**The bundle carries its own verifier.** `node verify.mjs <bundle>` checks the manifest, the
chain, the signature, every blob against its content address, and recomputes every claim
verdict. Transcripts for two runs:
[`live-tasks.md`](docs/evidence/2026-08-18/live-tasks.md).

**Bundles are signed from the OS keychain**, not from a key in the workspace. Both manifests
say `"keySource": "keychain"` and both verifiers confirm it.

**Local model choice is measured on your machine.** The probe output and recommendation from
real hardware: [`hardware-select.md`](docs/evidence/2026-08-18/hardware-select.md). Sixty
calibration runs with distributions rather than averages:
[`calibration-report.md`](docs/evidence/2026-08-18/calibration-report.md).

**Eight untrusted boundaries are fuzzed**, and the harnesses are checked against a defect
injected on purpose so a clean run cannot be a blind one: [`fuzz/`](fuzz/README.md) and
[`security-coverage.md`](docs/security-coverage.md).

**Adversarial passes, with each closure locked as a regression test.** Six pass directories
under [`redteam/`](redteam), 49 cases in `src/evidence/redteam-adversarial.test.ts`, and an
accounting record mapping each pass to what it actually was, because the driver ledger
records one completed lap and a directory is not a lap.

## What is not claimed

Kept short and kept honest, because the point of the rest of this file is that claims cost
something.

- **Not "fully secure".** The secret detector does known-pattern scrubbing, not secret
  removal, with a four-character floor. Zero crashes at a fuzz budget is evidence, not proof.
- **No benchmark numbers.** Nothing here is measured against another tool. The calibration
  results are self-run, on one machine, and labelled directional in the file itself.
- **Four known gaps are open**, not closed, and they ship that way. They are in
  [build guide 7.1](docs/build-guide.md), and each is a permanent test case asserting the
  gap as it stands.
- **The clean-container check has not run.** No container runtime on the machine this was
  built on, recorded as
  [NOT-RUN](docs/evidence/2026-08-18/clean-container-verification.md) with the command to
  run rather than quietly skipped.

## How it works

- **Claims are predicates, not prose.** A claim names a record, a record kind, and a
  machine-checkable predicate. The harness recomputes the record's kind, evaluates the
  predicate, and decides. Model narrative always renders as unverified prose.
- **The ledger is append-only and hash-chained.** Each record carries the previous record's
  hash. A failed write aborts the run. Nothing is updated or deleted, ever.
- **Every tool call goes through one chokepoint** that records it, tags its provenance, and
  enforces the sandbox. Credential paths are denied by default and each denial is itself
  recorded.
- **Gates are data.** A gate declares a command, a parser, and whether it blocks. The engine
  never special-cases one.
- **The ratchet is numeric.** Tests collected, assertions in touched test files, coverage of
  changed lines, skip markers. Coverage comes from a report the runner wrote where the
  harness told it to, never from what a gate printed, and an unobtainable measure is
  reported as "not measured" rather than as a pass.

The full design, including what it refuses to build and why, is in
[`docs/build-guide.md`](docs/build-guide.md).

## Limits

Gates prove mechanical quality. They do not prove design quality, and nothing here pretends
a passing run means the change is good. What the bundle buys you is that reviewing the
change is fast and that its claims are checkable, not that review is unnecessary.

## Upgrading from v12

v12 was a PR auditor that ran as a GitHub Action. v13 is a coding agent. Same package name,
different product, no migration path. If you are using v12, stay on it: it is tagged
`v12-final`. Details in [`CHANGELOG.md`](CHANGELOG.md).

## License

ISC. See [`LICENSE`](LICENSE).
