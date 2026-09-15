# swarm-verify

The verification path of [swarm-orchestrator](https://github.com/moonrunnerkc/swarm-orchestrator)
on its own. Three commands, no model, no provider key, no local backend:

```sh
swarm-verify verify <bundle> [--signer <fingerprint>]   # check a bundle, and who signed it
swarm-verify ci --patch <file> [--oracle <command>]     # verify a patch in a fresh checkout of its base
swarm-verify gates [--workspace <dir>]                  # run a workspace's gates and bond each pass
```

Each command is the same code `swarm` runs under the same name, so an invocation reads the same
through either binary; what this package leaves out is the agent. The walkthrough, with every
transcript captured from the command it sits under, is
[docs/verify-only.md](https://github.com/moonrunnerkc/swarm-orchestrator/blob/v13-main/docs/verify-only.md).

Node 22 or newer. Node 24 or newer is recommended: the changed-line coverage measurement spawns
node's test runner with `--test-isolation=process`, which Node 22 rejects, and below 24 that one
measurement reports unmeasured rather than passing.

Every bundle also carries its own dependency-free verifier, `verify.mjs`, which checks the chain,
the signature and every payload with nothing installed at all. This package adds the installed
verifier's re-derivation of every recorded verdict, the signer judgement, the patch verification
and the gates.
