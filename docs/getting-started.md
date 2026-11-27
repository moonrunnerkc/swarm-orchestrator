# Getting started

This walks through one task from install to reading the result. Commands and options are listed
in full in the [reference](reference.md).

## 1. Check the machine

```sh
npm install -g swarm-orchestrator
swarm doctor            # what owns the `swarm` command, and whether the install is healthy
swarm doctor --models   # every installed model: fits in memory or not, ready or not, and why
```

Swarm needs Node 22.13 or newer, git, and a model server. With no model named it asks Ollama
what is installed, leaves out cloud entries, embedding models and anything that would not fit in
memory, probes the strongest candidates until one follows the reply protocol, and prints the one
it chose and why. To choose yourself:

```sh
swarm run "<task>" --model gemma4:31b
swarm run "<task>" --endpoint http://127.0.0.1:8000/v1 --model <name the server serves>
```

The model's commands and the checks run in containers, so a run needs a docker daemon. If you
have none the run stops before it executes anything. `--host` runs both on your machine, where
only a filter on command text stands between the model and your files, and the report says
`host, not isolated`.

## 2. Decide what "done" means

A run is complete only when each requirement is shown met by a check the coding model did not
write. You choose where that check comes from:

| You have | Pass | What happens |
| --- | --- | --- |
| A test that fails today | `--accept <file or directory>` | It runs before any edit and must fail there. The model sees its output, never its source. |
| A command that fails today | `--accept-cmd "<command>"` | Same, for a command. |
| A test that must keep passing | `--accept keep=<file>` | It must pass before and after. |
| Nothing yet | `--write-checks <dir outside the repo>` | A separate model call drafts a check from the task's wording and the repository as it is. The run stops so you can read and edit it, then pass it with `--accept <dir>`. |
| Nothing, at a terminal | (no flag) | The drafted check is shown for you to approve, edit or reject. |
| Nothing, and no wish to read it | `--accept-authored` | The drafted check is used as written. The report labels it `independently-generated`, not yours. |

The drafting call never sees a change. It is shown the task, one of your tests, the source files
that test imports and the application's entry with what they import (small files whole, larger
ones as declarations), the module system and the start command. Its draft is run at the base
and must fail there for want of the behavior the task asks for: a draft that does not parse,
imports what does not exist, tests a function it defines itself, or whose control case fails,
is sent back with what its run printed, up to three times. A draft is taken whole or not at
all; no failing case is left out to make the rest usable.

## 3. Run it

```sh
cd your-repo
swarm run "Add a --json option to the status command" --accept ../status-checks
```

The run works in a clone beside your repository, starting from your tree as it is, uncommitted
edits included. Each turn the model sends one command or one file edit. After every change Swarm
runs the checks and shows the model the results; when they pass it verifies the tree in a clean
checkout.

## 4. Read the result

The closing summary gives the state, each requirement's status, and three paths:

- `patch`: the delivered change. It is applied to your working tree whatever the state, complete
  or not, unless you changed the tree during the run or passed `--no-apply`. Read the state
  before you commit it; `git apply -R <patch>` takes it back out.
- `report`: `report.md`, with a table of requirements, the evidence for each, what was
  regression-checked, and the resources used. `report.json` beside it is the same as data.
- `evidence`: the session directory, with the ledger of every command and model reply.

Requirement statuses are `satisfied`, `failed`, `unverified` (nothing independent could show it
either way) and `blocked`. `unverified` is never counted as done.

To have the verifier rerun the final verification from the record and compare:

```sh
npm install -g swarm-verify
swarm-verify replay <directory holding the printed attestation> --key <the printed key> --workspace .
```

## Teach it your conventions

```sh
swarm init --learn src lib/util.ts   # files or directories; none means the repository's sources
swarm init --approve <proposal>      # add --global for a default across repositories
swarm init --set exports=named       # correct one rule; --forget exports removes it
swarm doctor --conventions           # the global profile, this project's, and what applies
```

`--learn` counts what the samples do (exports, naming, typing, error handling, documentation of
exports, where tests live) and writes a proposal under `~/.swarm/conventions/proposals`. Nothing
is in effect until you approve it, and only you can: the model's commands cannot reach that
directory. One sample makes a tentative proposal; mixed samples make none. A rule your lint
configuration already decides is left to it, and formatting is left to your formatter. A sample
that logs a credential or swallows an error is reported with its safe form and never learned.

An approved rule becomes a requirement of every run in that repository, checked on the files the
run adds or changes, so code that was already there is not held against it. A project's profile
overrides the global one rule by rule, and the report says where they disagree. Where the task
itself asks for something else ("with a default export"), the task decides for that run and the
report says the rule was not checked. Guidance you add with `--set guidance="..."` is shown to
the model and never checked.

## Security obligations

For a JavaScript or TypeScript project with an HTTP API, Swarm reads the task for three things:
a resource that belongs to one user, a token that is redeemed once, and an operation that must
not be applied twice. Each one the task touches becomes a required requirement with source
`security`; the report lists all three with whether each applied and why. Where a task changes a
request handler and its wording does not say whose data it serves, the run stops and asks you to
pass `--security ownership` or `--no-security ownership`.

The check for a security requirement is made of real requests. The verifier starts your server
in a container with no network and sends the requests from a second container, at the base and
on the change. It needs a binding: how the server starts, and which request as which user. Write
one and pass `--security-check <file>` ([format](reference.md#security-binding)), or let a
separate model call draft it from the repository. A draft is held to credentials the repository
itself holds and is tried at the base with real requests before anything is built; what those
show is wrong with it is sent back to be mended. That is validation, not review: at a terminal
you approve, edit or reject the draft, `--write-checks` writes it out and stops, and only
`--accept-authored` uses it unread, which the report says. The three checks are what this
version makes for these three obligations; they are not a security review of the change. [examples/invoice-api](../examples/invoice-api/README.md) is a
complete example.

## Tasks with several parts

A task whose text holds a list (two or more lines opening with `-`, `*` or a number) gets one
required requirement per item, R2 onward, in the task's own words. R1 is always the whole task.
Prose is not split automatically; set a phrase apart with `--require "<its words>"`, which must
quote the task. Give an item its own check with `--accept R2=<file>`. The run is complete only
when every required requirement is satisfied, and the report lists each one separately.

## Keeping experiments out of model selection

Automatic selection learns from finished runs, kept per machine under `~/.swarm/profiles`. Use
`--profile <name>` to keep a set of runs in a record of its own, `--no-record` to write nothing,
or set `SWARM_HOME` to move sessions and records elsewhere entirely.
