# Swarm Orchestrator

`swarm` is a command-line coding agent for git repositories. You describe a change in plain
words; it edits your working tree with a local or hosted model, runs your project's checks,
repairs failures within a fixed number of attempts, and reports what was actually established,
with a signed record of every command it ran. A loop that hits its step limit before it reports
the task done is continued once, from the same attempts and allowances, once the checks are
green; the report says whether that happened and what the test files add against the base.

```sh
swarm "make slugify in slug.js turn each run of spaces into one dash, and add a test for it" \
  --model local:qwen3.6:35b-a3b
```

## Why use it

Use it when "done" should be decided by checks, not by the model's summary. A repair may not
delete tests to turn a check green, and a requirement no trusted check covers is reported as not
established, never as passed.

## What you need

- Node 22 or newer (24 recommended), git, and a repository whose tests run with one command.
- A model: this page is verified with [Ollama](https://ollama.com/download) serving
  `qwen3.6:35b-a3b` (about 24 GB of memory). For hosted models, see
  [docs/cli.md](docs/cli.md#choosing-a-model).

## Install

`npm install -g swarm-orchestrator` installs release 14.4.0, which predates this page. Build the
source instead:

```sh
git clone https://github.com/moonrunnerkc/swarm-orchestrator.git
cd swarm-orchestrator
npm ci
npm pack
npm install -g ./swarm-orchestrator-*.tgz
swarm --version
```

The version line should say `source build`.

## Try it on a scratch repository

```sh
ollama pull qwen3.6:35b-a3b
mkdir slug-demo && cd slug-demo && git init -q
echo '{ "type": "module", "scripts": { "test": "node --test" } }' > package.json
echo 'export const slugify = (text) => text.toLowerCase();' > slug.js
cat > slug.test.js <<'EOF'
import test from "node:test";
import assert from "node:assert/strict";
import { slugify } from "./slug.js";
test("lowercases", () => assert.equal(slugify("Hello"), "hello"));
EOF
git add -A && git commit -qm "start"
swarm "make slugify in slug.js turn each run of spaces into one dash, and add a test for it" \
  --model local:qwen3.6:35b-a3b
```

On a terminal, the first run asks once whether to approve unlisted commands automatically.

## Reading the result

Swarm edits files in place and does not commit: review with `git diff`, then commit or
`git restore .` (and delete any new files `git status` lists). The outcome block's first line
is one of:

- **accepted** (exit 0): every requirement you supplied in a
  [goal contract](docs/broad-use.md) was met by its checks; the scope line says what they cover.
- **gates passed; the task itself was not judged** (exit 0): your checks passed but nothing
  tested the task, as in the plain run above.
- **partially checked**, **unresolved**, **not accepted** (exit 1) or **unverified** (exit 4):
  a supplied requirement went undecided, a model-written check disagrees, a check refused the
  change, or the model or verification environment was unavailable. The block says which, and
  what to do next.

The run ends by printing its evidence bundle's path. `node <bundle>/verify.mjs <bundle>` checks,
with nothing installed, that the record is intact and its verdicts follow from it; it does not
say the code is correct. If a first run fails, see
[troubleshooting](docs/using.md#when-a-first-run-fails).

## Limitations

Swarm is experimental. On small registered blocks of fresh public tasks with one local model it
has not shown a general advantage over OpenCode: on the latest block of three tasks (two samples
each) Swarm completed one of six launches and OpenCode none, at about 1.7 times OpenCode's wall
time; on the block before it Swarm completed one of four and OpenCode two, three after an
evaluator audit ([latest](docs/evidence/2026-10-23-controller/README.md),
[previous](docs/evidence/2026-10-22-adaptive/README.md)). Swarm's verdict can still accept a
change that misses a stated edge case no check exercises, and can refuse a refactor whose
required configuration edit its anti-tampering rule rejects. Model-written checks
(`--plan-checks`) guide repair but cannot establish a requirement alone. Commands run on your
machine under a path policy, not a sandbox, unless you pass `--isolation`.

## Learn more

- [docs/using.md](docs/using.md): the workflow
- [docs/cli.md](docs/cli.md): commands, flags, settings, exit codes
- [docs/verifying.md](docs/verifying.md): verification, and what is not claimed
- [docs/agent.md](docs/agent.md): measurements, an example run, version history
- [SECURITY.md](SECURITY.md): execution boundaries
- [Swarm Verify](packages/swarm-verify/README.md): the verifier alone, no model needed
- Contributing: [docs/build-guide.md](docs/build-guide.md); `npm run gates` must pass

ISC licensed. Contact: bradkinnard@proton.me.

Experimental controller work and its limits: [execution-guided delivery study](docs/capability-study-2026-10-22.md).
