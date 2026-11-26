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

Isolated verification needs a docker daemon. If you have none, add `--host`: checks then run on
your machine and the report says `host, not isolated`.

## 2. Decide what "done" means

A run is complete only when each requirement is shown met by a check the coding model did not
write. You choose where that check comes from:

| You have | Pass | What happens |
| --- | --- | --- |
| A test that fails today | `--accept <file or directory>` | It runs before any edit and must fail there. The model sees its output, never its source. |
| A command that fails today | `--accept-cmd "<command>"` | Same, for a command. |
| A test that must keep passing | `--accept keep=<file>` | It must pass before and after. |
| Nothing yet | `--write-checks <dir outside the repo>` | A separate model call drafts a check from the task's wording. The run stops so you can read and edit it, then pass it with `--accept <dir>`. |
| Nothing, at a terminal | (no flag) | The drafted check is shown for you to approve, edit or reject. |
| Nothing, and no wish to read it | `--accept-authored` | The drafted check is used as written. The report labels it `independently-generated`, not yours. |

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
