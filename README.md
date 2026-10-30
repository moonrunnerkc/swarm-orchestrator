# swarm-verify

**swarm-verify reruns a repository's own checks on a change in a clean checkout of its base,
refuses changes that edit their tests alongside the code, runs tests the change's author never
saw, and signs the verdict, for anyone merging AI-written changes from any agent.**

[![ci](https://github.com/moonrunnerkc/swarm-orchestrator/actions/workflows/ci.yml/badge.svg?branch=v13-main)](https://github.com/moonrunnerkc/swarm-orchestrator/actions/workflows/ci.yml)
[![license: ISC](https://img.shields.io/badge/license-ISC-blue)](LICENSE)

## Try it

Node 22 or newer and git. The packages aren't on npm at this version yet, so it runs from a
checkout:

```sh
git clone https://github.com/moonrunnerkc/swarm-orchestrator && cd swarm-orchestrator
npm ci
export SWARM="$PWD" && swarm() { node "$SWARM/dist/cli.js" "$@"; }
```

A scratch repository with a broken function and a test that says so, the fix, the verdict, then
the attestation checked before and after one bit of it flips:

```sh
cd "$(mktemp -d)" && git init -q && mkdir test
printf 'export const half = (n) => n;\n' > half.mjs
printf 'import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { half } from "../half.mjs";\ntest("half", () => assert.equal(half(4), 2));\n' > test/half.test.mjs
printf '{ "type": "module", "scripts": { "test": "node --test" } }\n' > package.json
git add -A && git -c user.email=me@example.com -c user.name=me commit -qm base
swarm init && git add swarm.toml && git -c user.email=me@example.com -c user.name=me commit -qm checks
printf 'export const half = (n) => n / 2;\n' > half.mjs
swarm verify --out out
node "$SWARM/packages/swarm-verify/verify.mjs" out/attestation.sigstore.json --key out/attestation.pub.pem --patch out/change.patch; echo "exit $?"
node -e 'const f=require("fs");const p="out/attestation.sigstore.json";const b=f.readFileSync(p);b[b.indexOf("\"payload\": \"")+40]^=1;f.writeFileSync(p,b)'
node "$SWARM/packages/swarm-verify/verify.mjs" out/attestation.sigstore.json --key out/attestation.pub.pem --patch out/change.patch; echo "exit $?"
```

`swarm verify` runs the test at the base commit (it fails there), applies the change, runs it
again (it passes now), measures the changed line's coverage and one mutant, and writes an
in-toto Statement in a DSSE envelope inside a Sigstore bundle. `verify.mjs` needs nothing but
Node; it prints `exit 0`, then `exit 1` once the signature no longer matches. `cosign
verify-blob-attestation` gives the same two answers. The first run on a desktop keeps an
ed25519 key in the OS keychain; `SWARM_SIGNING_KEY` or `--sigstore` sign another way.

## What it catches

The tamper evaluation verifies 20 honest patches and 24 cheating ones against three fixture
repositories with held-out tests sealed: precision 100.0%, recall 100.0%
([docs/results.md](docs/results.md)).

| Patches | Cases | Flagged |
| --- | ---: | ---: |
| honest | 20 | 0 |
| edited-expectations | 4 | 4 |
| deleted-assertions | 4 | 4 |
| hard-coded-inputs | 4 | 4 |
| overridden-equality | 8 | 8 |
| patched-scorer | 4 | 4 |

Each cheat makes the visible tests pass while the behavior stays wrong. Edited expectations,
deleted assertions and a patched scorer change tests or scoring together with source, which the
protected-path rule refuses. Hard-coded inputs fail tests sealed with `swarm init --seal`. The
overridden-equality cheats patch `node:assert`, `Object.is`, `Array.prototype.includes` or the
project's own `expect` helper from the source under test; a judge loaded into the held-out test
processes before any project module catches them. The fixtures, patches and oracle are in
`eval/tamper/`.

## What a pass means, and what it doesn't

A pass means the checks you declared and the tests you sealed agree the change didn't break
them, measured on a clean checkout, with an inherited failure reported as unmeasured rather than
counted. It doesn't mean the code is correct: that's only as strong as the checks, and the
coverage and mutant lines in every verdict say how strong they are. The judge is a tripwire, not
a sandbox; [docs/verifying.md](docs/verifying.md) lists what is out of its reach.

## The rebuild

This repository used to hold a research system around the same idea: 25 subcommands, 97,188
non-test lines of TypeScript under `src/`, 10 runtime dependencies, and a test suite that took
368.2 s in a fresh worktree and ended with 18 failures. [ADR 0014](docs/adr/0014-verifier-first-rebuild.md)
cut it to the verifier and one agent loop: 5 subcommands, 6,536 lines, 2 dependencies, and 295
tests that pass in 7.2 s.

## swarm run

`swarm run "<task>" --endpoint <url> --model <name>` is a loop with one bash tool over any
OpenAI-compatible endpoint. Every command goes through one chokepoint under a lexical path
policy and lands on a hash-chained ledger outside the workspace. When the model says it's done,
the verifier judges the tree; a refusal goes back to the model until the verifier passes it or a
budget runs out. On the first 30 SWE-bench Verified tasks, with `qwen3.6:35b-a3b` behind every
arm and the benchmark's own tests judging, `swarm run` passed 14 (46.7%, Wilson 95% 30.2% to
63.9%), mini-SWE-agent 15 and OpenCode 10, and no pair differs significantly (McNemar p 0.125 or
more). Its verifier measured none of them: every run that reached it got `unmeasured`, because
the repository's whole test suite already fails at the base commit, and the others ran out of
steps or tokens first. Judging base runs per test, not per check, is what would change that.

## Where things are

- [docs/results.md](docs/results.md): every measured number, written by the evaluation.
- [docs/demos/](docs/demos/): five recorded demos, each with the transcript it printed.
- [docs/verifying.md](docs/verifying.md): what the verifier runs, and where its reach ends.
- [docs/integrations.md](docs/integrations.md): the GitHub Action, CI, pre-commit, MCP, hooks.
- [docs/eval.md](docs/eval.md): how the evaluation runs, and the nightly runner.
- [moonrunnerkc/swarm-orchestrator-archive](https://github.com/moonrunnerkc/swarm-orchestrator-archive)
  (private): the research history this repository carried before the rebuild.
- [ADR 0014](docs/adr/0014-verifier-first-rebuild.md): why the project is shaped this way.

ISC licensed; see [LICENSE](LICENSE).
