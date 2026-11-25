# Reference

`swarm --help` prints the same command list. Every command takes `--workspace <dir>`; the
default is the current directory.

## Commands

| Command | What it does |
| --- | --- |
| `swarm run "<task>"` | Make the change, check each requirement, report what is complete. |
| `swarm doctor [--fix] [--offline]` | Report what owns the installed `swarm` command; `--fix` repairs a broken install. |
| `swarm doctor --models [--context <tokens>]` | Probe every installed model and show its verdict and record. |
| `swarm verify`, `swarm init`, `swarm ci` | Swarm Verify's own commands, described in [its documentation](https://github.com/moonrunnerkc/swarm-verify/blob/main/docs/verifying.md). |

## `swarm run` options

Model:

| Option | Default | Meaning |
| --- | --- | --- |
| `--model <name>` | `auto` | A model by name, or `auto` to discover one. |
| `--endpoint <url>` | Ollama on localhost | An OpenAI-compatible server. Also `SWARM_ENDPOINT` or `[agent] endpoint`. |
| `--context <tokens>` | 65536, then 32768, for a discovered model; 32768 for a named one | The context window to use. |
| `--profile <name>` | the machine's default record | Read and write a named model record instead. Also `SWARM_PROFILE`. |
| `--no-record` | off | Read the record, write nothing. |

Requirements and checks:

| Option | Meaning |
| --- | --- |
| `--require "<words of the task>"` | Set a phrase of the task apart as a required requirement of its own. Repeatable. Must quote the task. |
| `--accept [R<n>=\|keep=]<path>` | Your test file, directory, or JSON array of structure claims. Witnesses R1 unless named. Repeatable. |
| `--accept-cmd [R<n>=\|keep=]<command>` | Your check as a command. Repeatable. |
| `--write-checks <dir>` | Draft checks into a directory outside the repository and stop. |
| `--review-checks` | Show each drafted check for approval at a terminal. |
| `--accept-authored` | Use the drafted checks as written. |
| `--authorize-behavior-change` | Allow the change to alter what existing tests expect. The report names each one. |
| `--review` | After completion, ask for one counterexample in a fresh context. Only a failing command reopens the work. |

Limits and execution:

| Option | Default | Meaning |
| --- | --- | --- |
| `--max-steps <n>` | 50 | Model turns for the whole run. |
| `--max-tokens <n>` | steps times context | Tokens for the whole run, check drafting and review included. |
| `--turn-tokens <n>` | 16384 | Cap on one reply. |
| `--max-minutes <n>` | none | Wall time for the whole run, final verification included. |
| `--approve ask\|auto` | `ask` | Whether a person approves commands off the allowlist. With nobody at a terminal, `ask` refuses them. |
| `--host` | off | Run checks on this machine instead of a container. |
| `--linked-dependencies` | off | With `--host`: verify against the workspace's installed dependencies. Reported as not reproducible. |
| `--no-apply` | off | Leave the result as a patch file. |

## Configuration

`swarm.toml` at the repository root is optional. Its `[checks]` table belongs to Swarm Verify.
The agent reads `[agent]`:

```toml
[agent]
model = "gemma4:31b"          # or "auto"
endpoint = "http://127.0.0.1:8000/v1"
api_key_env = "SWARM_API_KEY" # the variable's name, never the key
max_steps = 50
max_tokens = 2000000
turn_tokens = 16384
approval = "ask"              # or "auto"
```

A command-line option wins over the file. Environment variables:

| Variable | Meaning |
| --- | --- |
| `SWARM_HOME` | Where sessions, sealed checks and model records live. Default `~/.swarm`. |
| `SWARM_ENDPOINT` | The OpenAI-compatible endpoint. |
| `SWARM_PROFILE` | The model record to use, as `--profile`. |
| `SWARM_API_KEY` | The endpoint's key, unless `api_key_env` names another variable. |
| `SWARM_SIGNING_KEY` | A PEM private key to sign verifications with, instead of the OS keychain's. |

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Complete. |
| 1 | Incomplete with a failed requirement, or an unexpected error. |
| 2 | The command line could not be read. |
| 4 | Incomplete with nothing failed: something is unverified. |
| 5 | Blocked: no model was ready, or the run stopped before its first edit. |

## Stop reasons

The summary's `stop` line says what ended the loop. The state is always decided afterwards, by
verifying the delivered tree.

| Stop | Meaning |
| --- | --- |
| `complete` | The verifier found the tree complete. |
| `incomplete` | Only independent evidence is missing, which no edit can supply. |
| `blocked` | The verifier, or the check stage, could not proceed. |
| `no-progress` | Turns in a row changed neither the tree nor any check's result, or repeated a command or a reply. |
| `unusable-replies` | Four replies in a row followed no reply form. |
| `step-budget`, `token-budget`, `time-budget` | A limit was reached. Time is held back for final verification. |
| `model-error` | The model server failed after retries. |
| `cancelled`, `interrupted` | A signal or an internal error ended the run; the tree it left is still snapshotted and reported. |

## Model records

`~/.swarm/profiles/<host>.json` keeps probe results and, per model, how finished runs ended. A
run counts as `complete` or against the model only when its final verification ran and the stop
was the model's own (no progress, unusable replies, a step or token limit, or a completion the
verifier measured as failed). Runs that ended for another reason (cancelled, blocked, a server
error, a time limit, missing evidence) are tallied as unattributed and never move selection.
Records written before this distinction are carried forward unchanged and marked as such; the
old file is kept beside the new one as `<host>.v1.json`.
