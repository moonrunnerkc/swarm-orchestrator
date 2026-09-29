<a id="readme-top"></a>

<div align="center">

<h1>Swarm Verify</h1>

<p><strong>Swarm Verify runs a project's checks and records evidence showing what passed, what failed, and what remains unverified.</strong></p>

</div>

This is the main source repository for Swarm Verify, maintained under the swarm-orchestrator
repository name. It also contains the optional beta coding agent. The separate
[moonrunnerkc/swarm-verify](https://github.com/moonrunnerkc/swarm-verify) repository distributes
the GitHub Action.

![A bundle verifies, one byte is changed, and the verifier refuses it with the broken link named](docs/evidence/2026-09-27/verifier-first/tamper-demo.gif)

The recording is a real run of the published package over a committed evidence bundle: it
verifies, one byte of one record is changed, and the altered bundle is refused with the broken
link named. That is integrity. Who signed a bundle, and whether the tests it records measured
the right thing, are separate questions the verifier answers separately
([transcript](docs/evidence/2026-09-27/verifier-first/tamper-demo-transcript.txt),
[script](docs/evidence/2026-09-27/verifier-first/tamper-demo.sh)).

```sh
npx swarm-verify
```

Run it in a git repository whose dependencies are installed (`npm ci`, `pnpm install
--frozen-lockfile` or `uv sync`; it names the missing step and exits 4 when they are not). It
reads the checks the project declares, runs them unattended the way a CI job would, and reports
apart: whether the command ran, what each check found, how the commands were contained, and
what it did not judge. By default it does not challenge the checks and does not judge whether
the work is correct: a pass is a regression-only pass, and the result line says so. A failed
check exits 1 and names the check; a check whose result cannot be trusted, such as a pass
reported by a test configuration the change itself edited, exits 4 and says why.

It creates no `swarm.toml` and keeps its evidence outside the repository, under
`~/.swarm/sessions` by default. While it runs it briefly adds, then removes, its own
`swarm-falsification-bond.*` fixtures to show each passing check can fail, and the project's
own commands may write build output, caches or other files as they always do. No model, key
or configuration is needed.

Needs Node 22 or newer, git, and `uv` for a Python project. Linux and macOS run every command;
Windows runs bundle and verdict verification only. Locally, commands run on the host with a
built environment and no credentials, which is a policy and not a sandbox; the Action runs
them in a network-disabled container.

[![gates](https://img.shields.io/github/actions/workflow/status/moonrunnerkc/swarm-orchestrator/gates.yml?branch=v13-main&style=for-the-badge&label=gates)](https://github.com/moonrunnerkc/swarm-orchestrator/actions/workflows/gates.yml)
[![verifier matrix](https://img.shields.io/github/actions/workflow/status/moonrunnerkc/swarm-orchestrator/verifier-matrix.yml?branch=v13-main&style=for-the-badge&label=node%2022%20%7C%2024)](https://github.com/moonrunnerkc/swarm-orchestrator/actions/workflows/verifier-matrix.yml)
[![npm](https://img.shields.io/npm/v/swarm-verify?style=for-the-badge&label=swarm-verify&color=CB3837)](https://www.npmjs.com/package/swarm-verify)
[![license](https://img.shields.io/badge/license-ISC-blue?style=for-the-badge)](LICENSE)

## In CI

One job, one Action, the permissions a signed comment needs
([the complete workflow](docs/examples/swarm-verification.yml)):

```yaml
name: swarm-verify
on:
  pull_request:
permissions:
  contents: read
  pull-requests: write
  id-token: write
  attestations: write
  artifact-metadata: write
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: moonrunnerkc/swarm-verify@v1
        with:
          install: true # install from the lockfile, scripts off, then run skipped scripts offline; omit for a project with no dependencies
```

The Action fetches the pull request's head and base by commit id into a checkout it owns, runs
the project's checks in a network-disabled container, signs the verdict as a GitHub artifact
attestation, and posts one comment bound to the head that says what was measured and what was
not. A route for forks and Dependabot is [documented](docs/examples/swarm-verification-forks.yml);
what has been exercised on a real fork is recorded in
[the completion index](docs/verifier-first/README.md). Inputs, outputs and how to verify a
signed verdict from outside the run are in [the broad-use guide](docs/broad-use.md#github-action).

## What it says, and what it does not

`regression: pass` means no check failed because of the change. It does not mean every check
passed: a failure the base commit already had, the same way and in the same tests, is shown as
inherited and does not count against the change, and the report names those failing tests. It
does not mean the work was done either.

A requirement contract (`swarm-verify ci --goal-contract`) defines what the work must do, and
the contract's checks are the evidence for each requirement. Neither the contract nor a
signature proves the code is semantically correct. `--challenges report` asks whether each
requirement's check could have caught wrong work (does it reject the tree before the change,
mechanical mutations of the change, a fixture sealed as a violation) and reports gaps;
`--challenges required` refuses on a gap; `off` asks nothing.

Every run exports a bundle carrying its own dependency-free verifier. Integrity, signer
identity, execution trust, regression, task acceptance and challenge coverage are reported as
separate answers, and `unmeasured` is one of them.

## Where to go next

| You want to | Read |
| --- | --- |
| verify a patch, branch or pull request from any author, with a contract or without | [docs/verify-only.md](docs/verify-only.md), [docs/broad-use.md](docs/broad-use.md) |
| check what a bundle establishes, and who signed it | [docs/verify-only.md](docs/verify-only.md#swarm-verify-a-bundle-and-who-signed-it) |
| route an agent's test command through the ledger, from Claude Code, an MCP client or a git hook | [docs/integrations.md](docs/integrations.md) |
| every command, flag and exit code | [docs/cli.md](docs/cli.md) |
| every public claim and the artifact behind it, and what may not be said | [docs/claims.md](docs/claims.md) |
| the coding agent this verifier was built for, an advanced beta mode | [docs/agent.md](docs/agent.md) |
| the verifier-first campaign, its baseline, evidence and open items | [docs/verifier-first/README.md](docs/verifier-first/README.md) |

The full documentation index is [docs/README.md](docs/README.md).

## Contributing

The bar is the one the tool applies to itself: `npm run gates` green with the output shown, new
behaviour covered by a test that failed first, and no claim in a document that its linked artifact
does not establish.

1. Fork the project
2. Create a branch (`git checkout -b feature/amazing-feature`)
3. Run `npm run gates` and paste the real output in the pull request
4. Commit (`git commit -m 'Add an amazing feature'`)
5. Push (`git push origin feature/amazing-feature`)
6. Open a pull request

<p align="right">(<a href="#readme-top">back to top</a>)</p>
