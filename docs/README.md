# Documentation

| Document | What it holds |
| --- | --- |
| [`../README.md`](../README.md#install) | install, and a first run from `npm install -g` to an opened review page |
| [`using.md`](using.md) | sessions, several workers, the screen, and `swarm.toml` |
| [`claims.md`](claims.md) | every public claim and the committed artifact behind it, and what may not be said |
| [`build-guide.md`](build-guide.md) | the design, the non-goals, and the residuals that ship open |
| [`ratchet-inputs.md`](ratchet-inputs.md) | every input the ratchet reads, who can author it, and what was moved |
| [`security-coverage.md`](security-coverage.md) | the fuzzed boundaries and the instrumented coverage numbers |
| [`empty-turn-diagnosis.md`](empty-turn-diagnosis.md) | the empty assistant turns of August, instrumented, replayed, and located |
| [`tech-debt.md`](tech-debt.md) | what the tree carries that it would rather not, with what closing each would take |
| [`evidence/`](evidence) | dated runs, bundles, and reports, each verified by the verifier it carries |
| [`state/`](state) | the state file of each unattended pass, with what was done and what was not |
| [`RELEASE-COMPLETION-PROMPT.md`](RELEASE-COMPLETION-PROMPT.md) | the plan an earlier release was built to |

## Restoring offloaded artifacts

Every evidence bundle in this tree verifies from a clone: `cd` into one and run `node verify.mjs`.

Large *derived* artifacts, rendered review pages mostly, are kept outside the repository, with
their digests left behind in the bundle's `blobs.digests.json`. A bundle regenerates those from
its own records, so their absence does not stop it verifying. To put them back from the session
store of the machine that produced the run:

    node scripts/restore-bundle-blobs.mjs                 # every bundle under docs/evidence
    node scripts/restore-bundle-blobs.mjs <dir>...        # named bundles
    node scripts/restore-bundle-blobs.mjs --store <dir>   # default ~/.swarm/sessions

A file is written only where its content hashes to the digest the manifest names, so a store
holding the wrong thing under the right name is reported rather than copied over the top.

Record payloads are never offloaded. A bundle without them cannot verify, and one that does not
verify is not evidence.
