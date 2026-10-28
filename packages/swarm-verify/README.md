# Swarm Verify

A verifier for software changes from any source, AI coding agents or people. It reruns a
project's declared checks on a change in a clean checkout of the base and reports what the
change did to them, without a model, a key or a configuration file.

```sh
npx swarm-verify ci --branch HEAD --base main     # verify a branch's change against main
npx swarm-verify ci --patch change.diff           # verify a patch against HEAD
npx swarm-verify verify <bundle>                  # check a recorded bundle offline
```

This package is being rebuilt around in-toto Statements in DSSE envelopes
([ADR 0014](https://github.com/moonrunnerkc/swarm-orchestrator/blob/v13-main/docs/adr/0014-verifier-first-rebuild.md)).
Integrations (GitHub Action, pre-commit, agent hooks, MCP clients) are described in the
source repository's `docs/integrations.md`.

Requires Node 22 or newer and git.

ISC licensed. Source: [moonrunnerkc/swarm-orchestrator](https://github.com/moonrunnerkc/swarm-orchestrator).
