# Swarm Verify

Reruns a project's own checks on a change in a clean checkout of its base, refuses changes that
edit their tests or other protected paths alongside source, runs held-out checks the change's
author never saw, measures changed-line coverage and one mutant, and signs the verdict as an
in-toto Statement in a DSSE envelope. It works the same for a change from a coding agent or a
person, and needs no model.

```sh
npx swarm-verify init                             # write swarm.toml from the project's scripts
npx swarm-verify verify                           # the working tree against HEAD
npx swarm-verify verify --range main..feature     # a branch's change
npx swarm-verify verify --patch change.diff       # a patch against HEAD
npx swarm-verify ci --base origin/main            # HEAD against a pull request's base
```

Each run writes `.swarm/verify/attestation.sigstore.json`, the patch it judged and the public
key, and exits 0 for pass, 1 for fail, 2 for a command line it cannot read and 4 when nothing
was measured. `verify.mjs`, shipped in this package, checks an attestation with nothing but
Node:

```sh
node verify.mjs attestation.sigstore.json --key attestation.pub.pem --patch change.patch
```

`cosign verify-blob-attestation --bundle attestation.sigstore.json --key attestation.pub.pem
--type https://swarm-verify.dev/verdict/v1 --insecure-ignore-tlog=true change.patch` checks the
same bundle. `swarm-verify-mcp` (`mcp.mjs`) serves one `verify` tool to an MCP client over
stdio. The GitHub Action manifest is `action.yml` in this package; integrations with
pre-commit, CI jobs and agent hooks are in the source repository's `docs/integrations.md`.

Requires Node 22 or newer and git. ISC licensed. Source:
[moonrunnerkc/swarm-orchestrator](https://github.com/moonrunnerkc/swarm-orchestrator).
