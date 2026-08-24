# The package on the npm registry, 2026-08-24

`npm install -g swarm-orchestrator` served the v12 pull-request auditor for the whole of the
v13 release run. This is the record of it serving v13 instead, of the two defects that had to
be fixed to get there, and of the install checked from the registry rather than from the
workflow's own report of itself.

## What is published

    $ npm view swarm-orchestrator dist-tags --json
    { "alpha": "7.0.0-alpha.0", "latest": "13.1.3" }

    $ npm view swarm-orchestrator versions --json
    [ "7.0.0-alpha.0", "11.2.0", "12.0.0", "13.1.3" ]

    $ npm view swarm-orchestrator@13.1.3 version dist.shasum dist.unpackedSize repository.url
    version           = '13.1.3'
    dist.shasum       = 'e6af5e07c3ff79a206f3c8de1129967133e86612'
    dist.unpackedSize = 1268609
    repository.url    = 'git+https://github.com/moonrunnerkc/swarm-orchestrator.git'

Published by CI run `32751820534` from tag `v13.1.3`, commit
`31e7ca1aedf7b2d5044f0c134841dfc5d46c6db9`. The shasum the registry serves is the one
`npm pack --dry-run` printed in that same run before the publish step, `e6af5e07...`, so the
artifact on the registry is the artifact that run assembled.

No 13.0.0, 13.1.0, 13.1.1 or 13.1.2 exists on the registry. Each of those was tagged, and each
was refused for a reason recorded below. They are left as tags rather than moved onto the tree
that finally published, because they name real trees and the refusals are part of the record.

## Two defects, both found by publishing rather than by reading

**The runner's credential could not write.** Every publish attempt through 2026-08-23 and the
first two of 2026-08-24 ended the same way:

    npm error code E404
    npm error 404 Not Found - PUT https://registry.npmjs.org/swarm-orchestrator - Not found

That is what the registry answers for an authenticated request without write access on the
package, rather than the 403 it reads as. The `NPM_TOKEN` repository secret dated from
2026-06-10 and no longer carried the right. The replacement was checked before it was used, by
name and by right rather than by trying a publish with it:

    $ curl -H "Authorization: Bearer $TOKEN" https://registry.npmjs.org/-/whoami
    {"username":"bradkinnard"}
    $ curl -H "Authorization: Bearer $TOKEN" \
        https://registry.npmjs.org/-/package/swarm-orchestrator/collaborators
    {"bradkinnard":"write"}

A local `npm login` does not reach the runner and was not the fix. The secret was.

**The manifest named no repository, so the signed publish was refused.** With the credential
right, run `32751395215` on `v13.1.2` got past the write check and failed on the next one:

    npm notice publish Signed provenance statement with source and build information from GitHub Actions
    npm notice publish Provenance statement published to transparency log: .../logIndex=2581445523
    npm error code E422
    npm error 422 Unprocessable Entity - PUT https://registry.npmjs.org/swarm-orchestrator -
      Error verifying sigstore provenance bundle: Failed to validate repository information:
      package.json: "repository.url" is "", expected to match
      "https://github.com/moonrunnerkc/swarm-orchestrator" from provenance

`--provenance` signs a statement naming the repository the tarball was built from, and the
registry compares that to `repository.url` before accepting the write. The field was absent.
The statement named this repository, the manifest named nothing, and the two did not agree.

Worth reading twice: the provenance reached the public transparency log at index `2581445523`
and then the publish failed. A refused publish is not a publish that left no trace.

Nothing in the source tree surfaces either defect, which is the difficulty with a packaging
bug: the tree is correct and the artifact is not. So the manifest field is now asserted by a
test in `scripts/build-dist.test.mjs`, next to the one covering the `prepare` hook after a git
install produced a package with no binary. Both tests exist because the defect they cover
shipped once.

## Installed from the registry, into a directory holding nothing else

Not the source tree, not the tarball beside it, not `npm link`. A directory with a stub
`package.json` and nothing more, on 2026-08-24, after the publish:

    $ npm install swarm-orchestrator
    added 55 packages, and audited 56 packages in 2s
    found 0 vulnerabilities

    $ node -e "console.log(require('swarm-orchestrator/package.json').version)"
    13.1.3

    $ ls -l node_modules/.bin/swarm
    node_modules/.bin/swarm -> ../swarm-orchestrator/dist/cli.js

`dist/cli.js` is present in a registry install because `prepublishOnly` builds it before the
pack, and present in a git-ref install because `prepare` builds it there. Those are two
different hooks and the package now declares both. Declaring only the second is what made
`npm install github:moonrunnerkc/swarm-orchestrator#v13.1.0` resolve, report success, and leave
no binary at all.

The binary runs:

    $ ./node_modules/.bin/swarm --help
    swarm [--model <provider:id>] [--workspace <dir>] [--bundle <dir>] [--base <ref>]
      [--attempts <n>] [--max-steps <n>] [--local-endpoint <url>] "<task>"

      swarm gates [--workspace <dir>] [--base <ref>]   run the gates, no model
      swarm select [--shortlist <file|url|bundled>]    probe this machine, recommend a model
      swarm calibrate [--models <a,b>] [--repeats <n>] measure models on the golden set
      swarm calibrate --add-case "<task>" --seed <a,b> --gate "<command>"
      swarm routing                                    what the reward log adds up to
      swarm parallel --tasks <file>                    one worker per line, then a merge queue
      swarm review <bundle directory>                  what a run produced, and open it
      swarm replay <bundle directory>                  read a bundle back
    ...
    exit 0

What a task looks like end to end from a packaged install, with the bundles verified from
outside both directories, is a separate and earlier record:
`evidence/2026-08-23/installed-package-run.md`. That was the 13.1.0 tarball. Nothing about the
run changed between it and 13.1.3; the manifest did.

## The provenance attestation, checked from the install

    $ npm audit signatures
    audited 55 packages in 1s
    55 packages have verified registry signatures
    18 packages have verified attestations

    $ npm audit signatures --json --include-attestations   # filtered to this package
    verified  swarm-orchestrator 13.1.3
      attestations.url: https://registry.npmjs.org/-/npm/v1/attestations/swarm-orchestrator@13.1.3
      predicateType:    https://slsa.dev/provenance/v1

Transparency log entry for the accepted publish: `2581448583`.

Say what that buys and no more. It ties the tarball on the registry to this repository, this
commit and this workflow run, so a tarball uploaded from somewhere else under this name would
not carry it. It says nothing about whether the code is correct, and it is a different
mechanism from the ed25519 signature over a run's ledger chain that `verify.mjs` checks inside
a bundle. Two signatures, two different things: one covers how the package reached the
registry, the other covers whether a run's evidence was altered after it left the machine that
produced it.

## What is not shown here

- No task was run through the registry-installed binary in this record. `--help` and the
  resolved bin are what was checked. The end-to-end task evidence is the 13.1.0 tarball run
  named above.
- The publish was made possible by rotating a credential. The token is recorded by name,
  `NPM_TOKEN`, and no value appears in this repository or in this file.
