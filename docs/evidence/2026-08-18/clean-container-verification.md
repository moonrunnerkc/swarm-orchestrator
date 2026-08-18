# Clean-environment verification: NOT-RUN

## Reason

No container runtime exists on this machine. Checked by name and by application bundle:

    docker   absent
    podman   absent
    nerdctl  absent
    lima     absent
    colima   absent
    orbctl   absent

`/Applications` holds no Docker Desktop, OrbStack, Podman Desktop or Rancher Desktop, and
there is no `~/.docker`. Nothing was installed to close this gap, because installing a
runtime is a change to the machine rather than to the tree, and the run's rule is that a
missing artifact recorded honestly beats a synthesized one.

## What this does and does not leave proven

Not proven: that the bundle verifies on a machine that has never seen this repository. That
claim needs the container and stays unmade until one runs. It is on the external-actions
list.

What is proven, and is less: the verifier ran against both bundles from a working directory
outside the repository, using only the copy of `verify.mjs` inside the bundle, with no
import from `src/` and no `npm install`. That is in `live-tasks.md` and in
`tamper-demo/README.md`. It shows the verifier needs nothing from the tree it was built
from. It does not show the bundle needs nothing from this machine, which is the part a
clean container tests and the part that stays open.

`src/evidence/verifier-parity.test.ts` asserts the embedded verifier and the in-tree one
agree, so the gap is narrower than untested. It is still a test-suite assertion rather than
a demonstrated fact, which is exactly the distinction this item exists to close.

## The command to run when a runtime exists

    docker run --rm -v "$PWD/docs/evidence/2026-08-18/live-frontier:/bundle:ro" \
      node:24 node /bundle/verify.mjs /bundle

Nothing else is mounted: no repository, no `node_modules`, no `npm install`.
