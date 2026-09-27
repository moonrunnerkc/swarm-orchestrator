# swarm-verify

Independently check what an AI-written change actually ran, whether the checks it passed
could have caught wrong work, and what stays unverified. No model, no API key, no
configuration.

```sh
npx swarm-verify
```

Run it in a repository and it discovers the declared test command from the manifests, runs it
the way a CI job would, and prints five conclusions apart: whether the command ran, what the
checks found, how the commands were contained, whether any requirement was judged, and whether
any check was challenged. A pass is a regression-only pass and is printed as one. Nothing is
written into the repository.

Needs Node 22 or newer and git. Every measurement runs on Node 22.8 or newer; on 22.0 to 22.7
the changed-line coverage measurement reports unmeasured by name. Linux and macOS run every
command; Windows runs bundle verification.

## In CI

One job, one Action, the permissions a signed comment needs:

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
```

The Action fetches the pull request's head and base by commit id into a checkout it owns, runs
the verification with candidate commands in a network-disabled container, signs the verdict as
a GitHub artifact attestation, and posts one comment bound to the head. Forks and Dependabot
have a documented trusted route. Everything is in
[the broad-use guide](https://github.com/moonrunnerkc/swarm-orchestrator/blob/v13-main/docs/broad-use.md#github-action).

## The commands

```sh
swarm-verify                                   # check the current directory (the same as `check`)
swarm-verify check [--explain] [--json]        # plan or run the declared checks unattended
swarm-verify ci --patch <file> | --branch <ref> | --pr <owner/repo#n>
                [--goal-contract <file>] [--challenges off|report|required]
swarm-verify verify <bundle> [--signer <fp>]   # check a bundle, and who signed it
swarm-verify verdict <verdict.json> [--repo <owner/repo>] [--signer-workflow <ref>]
swarm-verify gates [--workspace <dir>]         # run a workspace's gates and bond each pass
```

`ci` verifies a change in a fresh checkout of its base and answers two questions apart:
`regression`, whether the repository's own suite still passes, and `task`, whether the work was
done, which only a requirement contract or an oracle can say. With a goal contract,
`--challenges` asks whether the contract's checks could have caught wrong work: a base control
per requirement, mechanical mutations of the changed lines witnessed by the repository suite,
sealed fixtures, and named missing obligations. `required` refuses on a gap.

Every run exports a signed bundle carrying its own dependency-free verifier, `verify.mjs`,
which checks the chain, the signature and every recorded verdict with nothing installed.
`verify` adds the installed re-derivation and the signer judgement; `verdict` binds a signed
verdict document to the evidence beside it and hands the signer question to
`gh attestation verify` against Sigstore's public trust root.

Exit codes: 0 acceptable, 1 not acceptable, 2 an unreadable command line, 3 cancelled,
4 incomplete or unavailable, 5 internal error. `check` prints a regression-only pass as 0 and a
missing prerequisite, an ambiguous workspace, a watch-mode script or a manifest-less directory
as 4, each with the exact next step.

The same commands ship inside [swarm-orchestrator](https://github.com/moonrunnerkc/swarm-orchestrator),
the coding agent this verifier was built for, which is an advanced beta mode and is never
needed to use this package. The walkthrough with captured transcripts is
[docs/verify-only.md](https://github.com/moonrunnerkc/swarm-orchestrator/blob/v13-main/docs/verify-only.md).

Publication is separate from source delivery: only a `swarm-verify-vVERSION` tag matching this
package's version starts its publishing workflow, with gates, packed content validation and
npm provenance. A prerelease version publishes under the `next` dist-tag; `latest` only moves
to a validated stable version.
