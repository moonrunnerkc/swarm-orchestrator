# swarm-orchestrator

Give Swarm an engineering task. It makes the change, checks each requirement, repairs supported
failures, and returns the patch with evidence of what is complete and what remains uncertain.

[![ci](https://github.com/moonrunnerkc/swarm-orchestrator/actions/workflows/ci.yml/badge.svg?branch=v13-main)](https://github.com/moonrunnerkc/swarm-orchestrator/actions/workflows/ci.yml)
[![license: ISC](https://img.shields.io/badge/license-ISC-blue)](LICENSE)

```sh
swarm run "Add a --json option to the status command and keep the text output as it is"
```

Features, fixes, refactors and upgrades are all ordinary work. Source, tests, manifests and
lockfiles may change together when the task needs it; what the change cannot touch is the
authority that judges it.

## How a run works

1. Swarm reads the task and the repository's `AGENTS.md` (or `CLAUDE.md`) instructions.
2. It records the requirements it was given, with stable IDs, and the assumptions it made.
3. A local model edits the code through one bash tool. Every command goes through one
   chokepoint under a lexical path policy and lands on a hash-chained ledger outside the
   workspace.
4. [Swarm Verify](https://github.com/moonrunnerkc/swarm-verify), the standalone verifier, measures
   the candidate: the base commit's tests against the new source, new tests as labeled
   evidence, test by test against the base.
5. A supported failure goes back to the model for repair while the run budget allows.
6. Every exit, including a budget running out or an interrupted run, ends in one finalization
   that verifies the exact delivered snapshot, or writes an incomplete report bound to it.

The final report lists each requirement as `satisfied`, `failed`, `unverified` or `blocked`,
with the evidence that decided it. The run is `complete` only when every required obligation is
satisfied, no new regression is unresolved, and the evidence matches the delivered patch.

## Install

Node 22 or newer and git. Swarm runs against a local model: Ollama, or any OpenAI-compatible
endpoint you name with `--endpoint`.

```sh
npm install -g swarm-orchestrator
swarm run "<task>" --endpoint http://localhost:11434/v1 --model <name>
```

## What the evidence is, and is not

The verifier signs an in-toto Statement in a DSSE envelope over the patch and the tree it
measured. That is tamper-evident evidence: a changed bundle no longer verifies against the
key. It does not prove the code is correct, that the tests were comprehensive, or that nothing
unobserved happened. Execution assurance (how the checks were contained) and evidence integrity
(whether the record is intact) are separate fields. [docs/verifying.md](docs/verifying.md)
says what each part of a verdict means and where its reach ends.

## Where things are

- [ADR 0015](docs/adr/0015-coding-agent-consumes-standalone-verifier.md): why the agent and the
  verifier are two products, and which owns what.
- [docs/plans/2026-10-31-product-recovery.md](docs/plans/2026-10-31-product-recovery.md): the
  specification the current work follows.
- [docs/verifying.md](docs/verifying.md): what the verifier runs and what a result means.
- [docs/integrations.md](docs/integrations.md): CI, pre-commit, MCP and editor hooks.
- [docs/results.md](docs/results.md): earlier evaluation results, kept as history.
- [docs/eval.md](docs/eval.md): how those evaluations ran.

ISC licensed; see [LICENSE](LICENSE).
