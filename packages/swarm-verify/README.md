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

Node 22 or newer, and every measurement on Node 22.8 or newer: the changed-line coverage
measurement spawns node's test runner with process isolation named on the command line, in the
spelling the running Node takes. On 22.0 to 22.7 that one measurement reports unmeasured rather
than passing.

Every bundle also carries its own dependency-free verifier, `verify.mjs`, which checks the chain,
the signature and every payload with nothing installed at all. This package adds the installed
verifier's re-derivation of every recorded verdict, the signer judgement, the patch verification
and the gates.

Build and install from source until registry publication is independently verified:

```sh
npm ci
npm run build:verify
npm pack --workspace swarm-verify --pack-destination /tmp
npm install --prefix /tmp/swarm-verifier-install /tmp/swarm-verify-0.2.0.tgz
/tmp/swarm-verifier-install/node_modules/.bin/swarm-verify --help
```

`ci` accepts exactly one of `--patch FILE`, `--branch REF`, or
`--pr OWNER/REPO#NUMBER` (also a github.com pull request URL). Branch comparisons
use the merge base with `HEAD` by default. Supplying `--base REF` requests an exact
base comparison. PR comparisons use the resolved target base and head snapshot;
`--base` explicitly overrides that comparison. Source IDs and patch digests appear
in JSON and evidence. PR metadata needs authenticated `gh`; immutable object fetching
currently uses credential-free HTTPS and refuses inaccessible private objects.

`--summary FILE` writes a bounded Markdown assessment projection; `--json` retains
`swarm.ci.v1` with additive `sourceIdentity`, `changedPaths` and `assessmentDigest` fields.
`--goal-contract FILE` supplies sealed requirement checks; repeated `--package DIR` scopes
Node/Python units. `--require-isolation --isolation docker` refuses an unavailable boundary.
The [broad-use guide](https://github.com/moonrunnerkc/swarm-orchestrator/blob/v13-main/docs/broad-use.md)
covers CLI, HTTP, optional browser checks and explicit measurement limits.
Symlink/submodule changes and quoted or whitespace-bearing patch paths are explicitly
unsupported. Binary patches, deletions and renames represented as deletion/addition
are retained. No checkout changes are applied to the user's working tree.

Browser acceptance requires a sealed `instrument` and an immutable Playwright container runtime.
Project `argv` reports remain unjudged. Unavailable package checks remain visible; missing
required checks prevent complete verification. See the linked broad-use guide for migration.

Publication is separate from source delivery. Only a `swarm-verify-vVERSION` tag
matching this package's version starts its publishing workflow, with gates, packed
content validation and npm provenance. Branch pushes do not publish either package.
