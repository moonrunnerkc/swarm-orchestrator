# Swarm Orchestrator

**swarm-verify reruns a project's own checks on a change in a clean checkout of its base, refuses
changes that edit their tests or other protected paths alongside source, runs held-out checks the
change's author never saw, and signs the verdict as an in-toto attestation anyone can check
offline.**

It does not care who wrote the change: a coding agent, a person, or `swarm run`, the small agent
loop in this repository that calls it. [ADR 0014](docs/adr/0014-verifier-first-rebuild.md) says
why the project is shaped this way.

## Install

Node 22 or newer and git. Until 15.0.0 and swarm-verify 2.0.0 are published, run from a checkout:

```sh
git clone https://github.com/moonrunnerkc/swarm-orchestrator && cd swarm-orchestrator
npm install && npm run build
export SWARM_CHECKOUT="$PWD"
alias swarm="node $SWARM_CHECKOUT/dist/cli.js"
```

## Five commands on a scratch repository

A throwaway repository with a broken function and a test that says so:

```sh
mkdir demo && cd demo && git init -q && mkdir test
printf 'export const half = (n) => n;\n' > half.mjs
printf 'import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { half } from "../half.mjs";\ntest("half", () => assert.equal(half(4), 2));\n' > test/half.test.mjs
printf '{ "type": "module", "scripts": { "test": "node --test" } }\n' > package.json
git add -A && git -c user.email=me@example.com -c user.name=me commit -qm base
```

Then:

```sh
swarm init && git add swarm.toml && git -c user.email=me@example.com -c user.name=me commit -qm checks
printf 'export const half = (n) => n / 2;\n' > half.mjs
swarm verify --out out
node "$SWARM_CHECKOUT/packages/swarm-verify/verify.mjs" out/attestation.sigstore.json --key out/attestation.pub.pem --patch out/change.patch; echo "exit $?"
node -e 'const f=require("fs");const p="out/attestation.sigstore.json";const b=f.readFileSync(p);b[b.indexOf("\"payload\": \"")+40]^=1;f.writeFileSync(p,b)' && node "$SWARM_CHECKOUT/packages/swarm-verify/verify.mjs" out/attestation.sigstore.json --key out/attestation.pub.pem --patch out/change.patch; echo "exit $?"
```

`swarm init` writes `swarm.toml` from the scripts the project declares. `swarm verify` clones the
base commit into a temporary directory, applies the working tree's change, runs the checks,
measures changed-line coverage and one mutant, and writes `out/attestation.sigstore.json`, the
patch it judged and the public key. `verify.mjs` needs nothing but Node: it checks the DSSE
signature and recomputes the patch digest, and exits 0. After one bit of the attestation is
flipped it exits 1. `cosign verify-blob-attestation --bundle out/attestation.sigstore.json --key
out/attestation.pub.pem --type https://swarm-verify.dev/verdict/v1 --insecure-ignore-tlog=true
out/change.patch` gives the same two answers.

The first run on a desktop stores an ed25519 signing key in the OS keychain; set
`SWARM_SIGNING_KEY` to a PEM private key to use your own, or pass `--sigstore` to sign keylessly
through cosign.

## What the verdict covers

- **Checks** come from the base commit's `swarm.toml` (or the base's manifests), never from the
  change, and run in a clean checkout under an environment built without the caller's
  credentials.
- **Protected paths** (tests, CI configuration, lockfiles, package manifests, `swarm.toml`) may
  change on their own, but a change that touches them together with source is refused unless
  `[protect] allow` in the base's `swarm.toml` names that category.
- **Held-out checks**: `swarm init --seal '<glob>'` moves test files out of the workspace into a
  sealed store. The verifier runs them against the base's test harness and reports the visible
  pass rate, the held-out pass rate and the gap between them.
- **Coverage and mutation**: changed-line coverage through V8 for Node and coverage.py for
  pytest, and one mutant of a changed line, killed or survived.
- **Unmeasured** is its own result. Whatever could not be measured is listed in the statement
  and never counts as a pass.

The predicate type is `https://swarm-verify.dev/verdict/v1`; its schema is
`src/verify/predicate.ts`. Exit codes: 0 pass, 1 fail, 2 a command line it cannot read, 4
nothing measured. `swarm ci` verifies `HEAD` against a pull request's base;
[docs/integrations.md](docs/integrations.md) shows the GitHub Action, pre-commit, CI jobs and
agent hooks, all calling the same command.

## swarm run

`swarm run "<task>" --endpoint <url> --model <name>` is a single-bash-tool agent loop over any
OpenAI-compatible chat endpoint. Each turn the model writes one command; it runs through one
chokepoint under a lexical path policy and its output goes back, after the task, `git status
--short` and the verifier's last refusal, all verbatim. When the model says it is done, the
verifier judges the working tree against the commit the run started from; a refusal goes back to
the model and the loop continues until the verifier passes or a step or token budget runs out.
Every command, output and verdict is recorded on an append-only, hash-chained ledger outside the
workspace.

## Measurements

[docs/results.md](docs/results.md) is the only page that states measured numbers: the three-arm
evaluation (mini-SWE-agent, OpenCode and `swarm run` on frozen SWE-bench Verified and
Terminal-Bench 2.0 task lists, same model) and the tamper evaluation of the verifier. The
recorded demos, including verification in a `node:24` container with no network, are in
[docs/demos/](docs/demos/).

## License

ISC. See [LICENSE](LICENSE).
