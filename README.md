# swarm-orchestrator

[![ci](https://github.com/moonrunnerkc/swarm-orchestrator/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/moonrunnerkc/swarm-orchestrator/actions/workflows/ci.yml)
[![license: ISC](https://img.shields.io/badge/license-ISC-blue)](LICENSE)

Swarm is a coding agent that runs on a local model. Give it an engineering task in a git
repository: it makes the change in a copy of your tree, checks each requirement with tests the
coding model did not write, repairs what fails, and hands back a patch with a report of what is
complete and what is not. [Swarm Verify](https://github.com/moonrunnerkc/swarm-verify), a separate
package, judges every result.

## What you need

- Node 22.13 or newer, and git.
- [Ollama](https://ollama.com) with at least one model installed, or any OpenAI-compatible
  server (`--endpoint`). Swarm downloads nothing and never picks a remote model for you.
- A docker daemon (Docker Desktop, or colima on macOS) so checks run in a container. Without
  one, `--host` runs them on your machine and the report says so.

## Install

```sh
npm install -g swarm-orchestrator
swarm doctor --models
```

`swarm doctor --models` lists each installed model, whether it fits in memory and whether it
follows the reply protocol. If none is ready it says why.

## Run a task

Swarm finishes a task when a check you stand behind passes. The quickest route is to let it
draft that check, read it, then run against it:

```sh
cd your-repo

# 1. Draft a failing test for the task. Nothing in the repository is edited.
swarm run "Add a --json option to the status command" --write-checks ../status-checks

# 2. Read and edit ../status-checks, then run the task against it.
swarm run "Add a --json option to the status command" --accept ../status-checks
```

Already have a test that fails today and should pass when the work is done? Skip step 1 and pass
it with `--accept <file>` or `--accept-cmd "<command>"`. To use the drafted check without reading
it, pass `--accept-authored`.

A task that lists several things, one per bullet or number, gets one requirement per item, and
each needs a check of its own. Set a phrase of the task apart the same way with
`--require "<its words>"`.

## What you get back

The run ends with a summary like this:

```
state        complete
R1           asked    Add a --json option to the status command
             status   satisfied, witness user-acceptance
patch        ~/.swarm/sessions/<id>/final/delivered.patch
applied      yes
report       ~/.swarm/sessions/<id>/final/report.md
```

- **The patch** is applied to your working tree only if you did not change the tree meanwhile.
  `--no-apply` leaves it as a file.
- **The report** lists every requirement with its status and the evidence that decided it.
- **The session directory** holds the full record of commands, model replies and verifications.

| State | Meaning | Exit code |
| --- | --- | --- |
| `complete` | Every required requirement is satisfied by independent evidence, nothing that passed before fails now, and the evidence matches the delivered patch. | 0 |
| `incomplete` | A requirement failed, or something could not be shown. The report says which and what to do next. | 1 or 4 |
| `blocked` | The run stopped before editing, for example because no usable check exists. | 5 |

An incomplete run still delivers its patch and names what is missing. Nothing the model says can
turn an unverified requirement into a satisfied one.

## What the evidence shows, and what it does not

Each verification is signed. The signature makes the record tamper-evident: a changed patch or
report no longer matches it. It does not show that the code is correct beyond the checks that
ran, that those checks are thorough, or that nothing unobserved happened. The path policy that
keeps the model's commands inside the workspace is a filter on command text, not a sandbox.

## More

- [Getting started](docs/getting-started.md): the first run step by step, and choosing a model.
- [Reference](docs/reference.md): every command, option, configuration key and exit code.
- [Troubleshooting](docs/troubleshooting.md): what each stop and blocked message means.
- [Architecture](docs/architecture.md): how a run works and where the evidence boundaries are.
- [History](docs/history.md): past evaluations and release reports, with links to the evidence.

ISC licensed; see [LICENSE](LICENSE).
