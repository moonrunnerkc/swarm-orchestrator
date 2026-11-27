# Reference

`swarm --help` prints the same command list. Every command takes `--workspace <dir>`; the
default is the current directory.

## Commands

| Command | What it does |
| --- | --- |
| `swarm run "<task>"` | Make the change, check each requirement, report what is complete. |
| `swarm doctor [--fix] [--offline]` | Report what owns the installed `swarm` command; `--fix` repairs a broken install. |
| `swarm doctor --models [--context <tokens>]` | Probe every installed model and show its verdict and record. |
| `swarm doctor --conventions` | Show the approved conventions: global, this project's, and what a run here works under. |
| `swarm init --learn [<path>...]` | Propose conventions from the files or directories given, or the repository's own sources. Writes a proposal; approves nothing. |
| `swarm init --approve <proposal> [--global]` | Put a proposal in effect for this repository, or as the default for every repository. |
| `swarm init --set <rule>=<value> [--global]`, `--forget <rule>` | Correct or remove one rule. `--set guidance="<text>"` adds guidance; `--forget guidance` clears it. |
| `swarm verify`, `swarm init`, `swarm ci` | Swarm Verify's own commands, described in [its documentation](https://github.com/moonrunnerkc/swarm-verify/blob/main/docs/verifying.md). |

## `swarm run` options

Model:

| Option | Default | Meaning |
| --- | --- | --- |
| `--model <name>` | `auto` | A model by name, or `auto` to discover one. |
| `--endpoint <url>` | Ollama on localhost | An OpenAI-compatible server. Also `SWARM_ENDPOINT`. |
| `--context <tokens>` | 65536, then 32768, for a discovered model; 32768 for a named one | The context window to use. |
| `--profile <name>` | the machine's default record | Read and write a named model record instead. Also `SWARM_PROFILE`. |
| `--no-record` | off | Read the record, write nothing. |

Requirements and checks:

| Option | Meaning |
| --- | --- |
| `--require "<words of the task>"` | Set a phrase of the task apart as a required requirement of its own. Repeatable. Must quote the task. |
| `--accept [R<n>=\|keep=]<path>` | Your test file, directory, or JSON array of structure claims. Witnesses R1 unless named. Repeatable. |
| `--accept-cmd [R<n>=\|keep=]<command>` | Your check as a command. Repeatable. |
| `--write-checks <dir>` | Draft the checks, a security binding included, into a directory outside the repository and stop. The default where no terminal is attached. |
| `--review-checks` | Show each drafted check and binding for approval at a terminal. The default at a terminal. |
| `--accept-authored` | Use the drafted checks and binding as written. Nobody has read them, and the report says so. |
| `--authorize-behavior-change` | Allow the change to alter what existing tests expect. The report names each one. |
| `--review` | After completion, ask for one counterexample in a fresh context. Only a failing command reopens the work. |

Security:

| Option | Meaning |
| --- | --- |
| `--security <obligation>` | Say an obligation applies: `ownership`, `single-use-token` or `duplicate-operation`. Repeatable. |
| `--no-security <obligation>` | Say it does not. The report records that you excluded it. |
| `--security-check <file>` | Your binding for the checks. Without it one is drafted from the repository, tried at the base with real requests, and then handled as any drafted check is: reviewed, written out, or used unread only under `--accept-authored`. |

Limits and execution:

| Option | Default | Meaning |
| --- | --- | --- |
| `--max-steps <n>` | 50 | Model turns for the whole run. |
| `--max-tokens <n>` | steps times context | Tokens for the whole run, check drafting and review included. |
| `--turn-tokens <n>` | 16384 | Cap on one reply. |
| `--max-minutes <n>` | none | Wall time for the whole run, final verification included. |
| `--approve ask\|auto` | `ask` | Whether a person approves commands off the allowlist. With nobody at a terminal, `ask` refuses them. |
| `--host` | off | Run the model's commands and the checks on this machine instead of in containers. Reported as `host, not isolated`. |
| `--linked-dependencies` | off | With `--host`: verify against the workspace's installed dependencies. Reported as not reproducible. |
| `--no-apply` | off | Leave the result as a patch file. |

## Configuration

`swarm.toml` at the repository root is optional. Its `[checks]` table belongs to Swarm Verify.
The agent reads `[agent]`:

```toml
[agent]
model = "gemma4:31b"          # or "auto"
max_steps = 50
max_tokens = 2000000
turn_tokens = 16384
```

A command-line option wins over the file. The file is committed with the repository, so it
cannot choose what only you may: approval of commands (`--approve`), the server a key is sent to
(`--endpoint`, `SWARM_ENDPOINT`) or the variable the key is read from (always `SWARM_API_KEY`).
A file that sets `approval`, `endpoint` or `api_key_env` is refused with where each goes now.
Environment variables:

| Variable | Meaning |
| --- | --- |
| `SWARM_HOME` | Where sessions, sealed checks and model records live. Default `~/.swarm`. |
| `SWARM_ENDPOINT` | The OpenAI-compatible endpoint. |
| `SWARM_PROFILE` | The model record to use, as `--profile`. |
| `SWARM_API_KEY` | The endpoint's key. |
| `SWARM_SIGNING_KEY` | A PEM private key to sign verifications with, instead of the OS keychain's. |

## Conventions

A profile is a JSON file under `SWARM_HOME/conventions` (`global.json`, and one per repository
under `projects/`), versioned `swarm.conventions/v1`. It holds rules, guidance, and the path and
digest of each sample a rule was learned from, never the samples' text. A file that does not
validate stops the run that would read it.

| Rule | Values |
| --- | --- |
| `exports` | `named`, `default` |
| `function-names`, `variable-names` | `camelCase`, `snake_case` |
| `type-names` | `PascalCase` |
| `file-names` | `kebab-case`, `camelCase`, `snake_case`, `PascalCase` |
| `explicit-any` | `forbidden` |
| `exported-return-types` | `explicit` |
| `empty-catch` | `forbidden` |
| `thrown-values` | `error-objects` |
| `exported-docs` | `documented` |
| `test-location` | `beside-sources`, `tests-directory` |

Rules are measured in `.js`, `.jsx`, `.mjs`, `.cjs`, `.ts`, `.tsx`, `.mts` and `.cts` files. A
rule holds where no file the run adds or changes breaks it more often than its base version did.
Precedence: the harness's command policy, container boundary and acceptance rules are never a
profile's to change; then the task's own words; then the project's profile; then the global one.
A run reads its profile once, at the start, and its digest is in the report and in the signed
statement's `producer.profile`.

## Security binding

```json
{
  "target": { "start": "node src/server.ts", "port": 3000, "env": {}, "ready": { "path": "/health" } },
  "checks": [
    { "class": "ownership",
      "resource": { "method": "GET", "path": "/invoices/inv-1/download" },
      "owner": { "authorization": "Bearer token-ada" },
      "other": { "authorization": "Bearer token-grace" },
      "otherRole": { "authorization": "Bearer token-sam" },
      "signedIn": { "method": "GET", "path": "/invoices" },
      "ownerSees": ["INV-2026-0001"] },
    { "class": "single-use-token",
      "issue": { "method": "POST", "path": "/reset", "body": { "email": "ada@example.test" } },
      "tokenAt": "token",
      "redeem": { "method": "POST", "path": "/reset/{{token}}" },
      "expiresAfterMs": 1500 },
    { "class": "duplicate-operation",
      "operation": { "method": "POST", "path": "/payments", "headers": { "idempotency-key": "k-{{run}}" } },
      "observe": { "method": "GET", "path": "/balance" },
      "valueAt": "balance",
      "by": -10 }
  ]
}
```

`start` must keep running and listen on `port`, which it is also given as `PORT`. Use synthetic
users and tokens. For `expiresAfterMs`, start the server with a short token life in `env`, by a
variable the application reads, and give a little more than that life. Without it no token is
redeemed after its lifetime: the case "an expired token is refused" is recorded as not exercised
and the token requirement stays unverified, so the run is not complete, whoever wrote the
binding. An application with no lifetime setting cannot have expiry checked this way; nothing
waits out a long-lived token, and no variable is invented.
`signedIn` is a request the API already answers for any signed-in user and refuses without
credentials: it shows that each user the binding names is one the server knows. Without it, a
credential that names nobody is refused like a stranger's, which reads as the restriction
working; a drafted binding must have it. A binding is refused outright where it could not show
what it claims: the other user is the owner, `redeem` never uses `{{token}}`, `by` is 0.

Before the first edit the binding, yours or a draft, is tried at the base: the server is started
and the requests are sent. A server that does not come up, or a named user the server does not
know, stops the run (yours) or sends the draft back to be mended with what was observed. A draft
must also use only credentials, values and `env` variable names found in the repository files it
was shown. The report
gives the binding's sha256 and what each case did at the base.

| Obligation | Cases, each a real request |
| --- | --- |
| `ownership` | Each named user is signed in (with `signedIn`); another user, another role (with `otherRole`) and an unauthenticated request are refused, and none of them sees `ownerSees`; then the owner is served. |
| `single-use-token` | A valid token is redeemed; a redeemed or unknown one is refused; one redeemed after `expiresAfterMs` is refused (not exercised, and the requirement unverified, without it); of several redemptions at once exactly one succeeds. |
| `duplicate-operation` | The operation is applied; replayed, or sent several times at once, it changes the observed value once. A repeat may be answered with the first result. |

Every set holds a legitimate use that must succeed, so refusing everything fails it. These are
the supported checks. Anything else, and any project that is not a JavaScript or TypeScript HTTP
API, gets none, and the report says so.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Complete. |
| 1 | Incomplete with a failed requirement, or an unexpected error. |
| 2 | The command line could not be read. |
| 3 | Cancelled by a signal. The run still finalizes and reports what it had. |
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
