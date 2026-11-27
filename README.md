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
- A docker daemon (Docker Desktop, or colima on macOS). The model's commands and every check run
  in containers with no network. Without one a run stops before it executes anything; `--host`
  runs on your machine instead, and the report says `host, not isolated`.

## Install

```sh
npm install -g swarm-orchestrator
swarm doctor --models
```

`swarm doctor --models` lists each installed model, whether it fits in memory and whether it
follows the reply protocol. If none is ready it says why.

## Run a task

Swarm finishes a task when a check the coding model did not write passes. Where you have none,
a separate model call drafts one from the task and your repository as it is, and you decide what
becomes of the draft:

```sh
cd your-repo
swarm run "Add a --json option to the status command"
```

At a terminal each drafted check is shown for you to approve, edit or reject before anything is
edited. Without a terminal the drafts are written out and the run stops (`--write-checks <dir>`
chooses where); read them, then pass them back with `--accept <dir>`. To let a run use its
drafts unread, pass `--accept-authored`: the report then labels them `independently-generated`
and says nobody reviewed them.

Already have a test that fails today and should pass when the work is done? Pass it with
`--accept <file>` or `--accept-cmd "<command>"`, and nothing is drafted for it.

A task that lists several things, one per bullet or number, gets one requirement per item, and
each needs a check of its own. Set a phrase of the task apart the same way with
`--require "<its words>"`.

## Your conventions and security checks

```sh
swarm init --learn src          # propose conventions from examples; nothing is in effect yet
swarm init --approve <proposal> # put the file you read and edited in effect for this repository
```

An approved rule (named exports, camelCase functions, no `any`) becomes a requirement of every
later run, checked on the files the run changes. For a JavaScript or TypeScript web API, a task
that touches a per-user resource, a single-use token or an operation that must not repeat also
gets a security requirement, checked by real requests to your running server from a separate
container. The check needs a binding: how the server starts, and which request as which user.
Pass yours with `--security-check <file>`, or let it be drafted like any other check; a draft is
tried at the base with real requests before it is offered to you. The report says which
obligations applied and why. These three checks are what this version makes: they are not a
security review, and a passing one shows only that the requests it sent were answered as they
should be. [The example](examples/invoice-api/README.md) runs all of it.

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
ran, that those checks are thorough, or that nothing unobserved happened. The container keeps
the model's commands away from your home directory, credentials and network; it is not a defense
against a compromised docker daemon or host. With `--host` only a filter on command text applies.

## More

- [Getting started](docs/getting-started.md): the first run step by step, and choosing a model.
- [Reference](docs/reference.md): every command, option, configuration key and exit code.
- [Troubleshooting](docs/troubleshooting.md): what each stop and blocked message means.
- [Architecture](docs/architecture.md): how a run works and where the evidence boundaries are.
- [History](docs/history.md): past evaluations and release reports, with links to the evidence.

ISC licensed; see [LICENSE](LICENSE).
