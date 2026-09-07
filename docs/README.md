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

**Every bundle a document calls verified verifies from a clone.** `cd` into one and run `node
verify.mjs`. `node scripts/check-cited-bundles-verify.mjs` holds all fourteen of them to that on
every push, because for a while none of them did and nothing noticed.

Two kinds of thing are kept outside the repository, with their digests left behind in the
bundle's `blobs.digests.json`:

- **Large derived artifacts**, rendered review pages mostly. A bundle regenerates those from its
  own records, so their absence does not stop it verifying.
- **The record payloads of bulk run archives that nothing cites as evidence**, which today means
  the eighteen runs under `evidence/2026-09-04/real-repos/`. Those bundles do *not* verify until
  the payloads are restored, and they are kept so their recorded patches can be re-scored, which
  reads `runs.jsonl` and `diff.patch` rather than the ledger. A cited bundle is never offloaded
  this way: a reader who follows a claim to its evidence and gets exit 1 has been told something
  false.

To put either back from the session store of the machine that produced the run:

    node scripts/restore-bundle-blobs.mjs                 # every bundle under docs/evidence
    node scripts/restore-bundle-blobs.mjs <dir>...        # named bundles
    node scripts/restore-bundle-blobs.mjs --store <dir>   # default ~/.swarm/sessions

A file is written only where its content hashes to the digest the manifest names, so a store
holding the wrong thing under the right name is reported rather than copied over the top.

`scripts/offload-bundle-blobs.mjs` moves derived artifacts out by default and needs `--payloads`
before it will touch a record payload, so removing the thing a bundle verifies against is a
decision somebody typed rather than a side effect of tidying.
