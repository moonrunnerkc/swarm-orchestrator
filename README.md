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
   the candidate in a container from a pinned image, network closed, with dependencies installed
   fresh from the lockfile: the base commit's tests against the new source, new tests as labeled
   evidence, test by test against the base. `--host` runs the checks on your machine instead, and
   the report says `host, not isolated`; add `--linked-dependencies` where the lockfile does not
   install in a clean checkout, and the report says the dependencies are not reproducible.
5. A supported failure goes back to the model for repair while the run budget allows.
6. Every exit, including a budget running out or an interrupted run, ends in one finalization
   that verifies the exact delivered snapshot, or writes an incomplete report bound to it.

The final report lists each requirement as `satisfied`, `failed`, `unverified` or `blocked`,
with the evidence that decided it. The run is `complete` only when every required obligation is
satisfied, no new regression is unresolved, and the evidence matches the delivered patch.

## Install

Node 22 or newer, git, and a docker daemon for isolated verification (colima or Docker Desktop
on macOS). Swarm runs against a local model.

```sh
npm install -g swarm-orchestrator
swarm run "<task>"
```

With no model named, Swarm asks Ollama what is installed, leaves out cloud entries, embedding
models and anything that would not fit in memory at the context (weights plus KV cache), probes
the strongest candidates until one follows its shell protocol, and prints the one it chose and
why. It tries a 65,536-token context first and 32,768 where nothing fits there; `--context` sets
one, and a named model or server gets 32,768 unless you set it. Probe results are kept per machine and model digest under `~/.swarm/profiles`.
`swarm doctor --models` shows every installed model's verdict. Name a model with `--model`, or
any OpenAI-compatible server (Rapid-MLX, vLLM, llama.cpp) with `--endpoint`. Nothing is
downloaded and nothing remote is chosen for you.

The run works in a git worktree beside your repository, starting from your tree as it is (staged,
unstaged and untracked edits included), and applies its patch to your working tree at the end
only if nothing changed there meanwhile; `--no-apply` keeps it as a patch. A Python project's
`.venv` is not copied there: the worktree gets its own, built with your `[verify] setup` command
or else `uv sync --frozen` from `uv.lock`, and the report names its interpreter or says why it has
none.

Your existing tests keep judging the change in their original form. When the task itself changes
what they should expect, pass `--authorize-behavior-change`: a rewritten expectation then stands
where its new version fails before the change and passes after it, and the report names each one.

`--review` asks the same model, in a fresh context, for one case the finished change gets wrong
and a command that shows it. Only a command that fails on the delivered tree reopens the work;
the verifier still decides. It is off by default and costs one more model turn.

## What the evidence is, and is not

The verifier signs an in-toto Statement in a DSSE envelope over the patch and the tree it
measured. That is tamper-evident evidence: a changed bundle no longer verifies against the
key. It does not prove the code is correct, that the tests were comprehensive, or that nothing
unobserved happened. Execution assurance (how the checks were contained) and evidence integrity
(whether the record is intact) are separate fields. The verifier's
[docs/verifying.md](https://github.com/moonrunnerkc/swarm-verify/blob/main/docs/verifying.md) says
what each part of a result means and where its reach ends.

## Where things are

- [ADR 0015](docs/adr/0015-coding-agent-consumes-standalone-verifier.md): why the agent and the
  verifier are two products, and which owns what.
- [docs/plans/2026-10-31-product-recovery.md](docs/plans/2026-10-31-product-recovery.md): the
  specification the current work follows.
- [moonrunnerkc/swarm-verify](https://github.com/moonrunnerkc/swarm-verify): the verifier, its
  API, its GitHub Action and its integrations with CI, pre-commit and MCP.
- [docs/results.md](docs/results.md): earlier evaluation results, kept as history.
- [docs/eval.md](docs/eval.md): how those evaluations ran.

ISC licensed; see [LICENSE](LICENSE).
