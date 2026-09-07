# Command reference

Every command and flag. `swarm --help` prints the same list; this is the version you can read
without a terminal open.

## Running a task

```
swarm "make slugify collapse whitespace and strip punctuation"
swarm                            # a session: type tasks, one after another
swarm --version                  # which build this is
```

| flag | what it does |
| --- | --- |
| `--model <provider:id>` | a specific model, e.g. `local:qwen3.6:35b-a3b` |
| `--workspace <dir>` | a repository other than the current directory |
| `--base <ref>` | what the diff and the ratchet measure against |
| `--attempts <n>` | how many times the ratchet may retry a gate |
| `--max-steps <n>` | how long the loop may run before it stops |
| `--max-wall-minutes <n>` | the whole run's clock: the loop and every retry together |
| `--isolation <runtime[:image]>` | run commands behind a kernel-enforced boundary |
| `--bundle <dir>` | where to write the evidence bundle |
| `--json` | line-delimited JSON: one line per event, one result at the end |
| `--no-tui` | plain lines even on a terminal |
| `--no-color` | no colour, whatever the terminal says |
| `--open-evidence` | open the review page when it finishes |
| `--local-endpoint <url>` | an OpenAI-compatible server other than the default |

## Setting up

```
swarm doctor                     # what owns the swarm command
swarm doctor --fix               # repair it
swarm init                       # write swarm.toml from package.json's scripts
```

`swarm doctor` exists because a development checkout linked into the global prefix with
`npm link` owns the command until it is removed, and npm cannot install over it: the install
either fails renaming a symlinked directory aside, or succeeds behind a stale executable still
pointing at the checkout. Neither presents as what it is.

## Gates without a model

```
swarm gates                      # run the gates over a workspace
  --allowed-files <a,b>          # the scope you authorise, for the file-set check
```

## Choosing a local model

```
swarm select                     # probe this machine, recommend a local model
swarm calibrate                  # measure candidate models on the golden set
swarm routing                    # what the reward log adds up to
```

With no model named, the router picks one from what the calibration measured on this machine.
Learned routing is off by default and there is a bar under turning it on: held-out success
non-inferior within five points judged by the whole interval, at least thirty tasks per arm, and
cheaper or faster. Nothing has cleared it, so routing follows the calibration and the competency
table.

## Several workers

```
swarm parallel --tasks <file>    # a worker per task, then a merge queue
swarm parallel --goal <text>     # break the goal into tasks, then run them
  --redundancy <n>               # try each task n ways, land the best of them
  --concurrency <n>              # how many workers may hold a worktree at once
```

See [using.md](using.md) for what a parallel run looks like and how the merge queue lands work.

## Verifying

```
swarm ci --patch <file>          # verify a patch in a fresh checkout of the base
  --oracle <command>             # what says the task was done
  --install                      # install the checkout's dependencies from its lockfile
  --immutable <a,b>              # paths the patch may not touch
  --agent-stream <file>          # another agent's event stream, read beside it
  --agent-format claude-code     # or generic
  --json
swarm verify <bundle>            # check a bundle, and who signed it
  --signer <fingerprint>         # the identity you expect, from outside the bundle
swarm review <bundle>            # what a past run produced, and open it
swarm replay <bundle>            # read a bundle back
```

Full explanation in [verifying.md](verifying.md).

## Interrupted runs

```
swarm list-runs                  # runs this machine has state for
swarm inspect <run-id>           # what a run did, and what it still owes
swarm resume <run-id>            # take up a run that was interrupted
swarm retry-step <run-id> <step> # run one step again
swarm abort <run-id>             # stop a run and refuse it new work
swarm repair <run-id>            # release what a dead run left held
swarm gc [--older-than 30d]      # what stored evidence would be removed, --remove to do it
```

Intent is written before every effect, so a crash between the two is visible rather than
invisible, and idempotency is keyed on the work rather than a clock, so resuming does not repeat
an effect that already committed.

## Credentials

Set `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` or `GOOGLE_GENERATIVE_AI_API_KEY` for a frontier model,
or start Ollama or rapid-mlx and pass `--model local:<id>`.

Keys come from the environment or your OS keychain and have no `swarm.toml` setting. That file is
committed and cloned, so a key in it has already been shared with everyone holding the
repository, and a file naming one is refused with rotation guidance.

## swarm.toml

One optional file: providers and endpoints, gate definitions, budgets, model pins, and the
`[interface]`, `[theme]` and `[keys]` tables. Flags win over the file. Settings are described in
[using.md](using.md); two are worth knowing before you need them.

```toml
[providers]
local_thinking = false         # a reasoning model served locally answers without reasoning first

[interface]
confirm_timeout_minutes = 30   # an unanswered confirmation refuses itself; 0 waits for ever
```

`local_thinking` matters on a reasoning model served locally. Left unset, nothing is sent and the
server's own default stands, which is the only safe default: the field is a vendor extension, and
a server that rejects what it does not recognise would fail every call rather than one. Set it,
and a model that would otherwise spend its whole output budget thinking answers instead. Against
rapid-mlx serving qwen3.8:27b, one request cost 37 completion tokens with reasoning on and 2 with
it off. Ollama's OpenAI-compatible route ignores the field; that is the server's limit rather than
this one's.

`confirm_timeout_minutes` is why a run left alone no longer waits for ever. The chokepoint asks
before it runs a command that is not on the allowlist, and a question nobody answers used to hold
the run until somebody came back to it. Refusing is what a declined question records either way,
so the deadline costs that one tool call and the run carries on.

## Exit codes

A taxonomy rather than zero-or-not: acceptable, not acceptable, invalid request, cancelled,
unavailable, internal error.
