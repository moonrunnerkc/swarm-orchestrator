# fixed-cli corpus

The `local-mlx` bundles of this campaign, whose payloads were already moved out of the
repository (`blobs.digests.json` in each names them), are packed whole and losslessly in
`packed-derived/fixed-cli-local-mlx`: every ledger, DAG, manifest and embedded verifier, byte for
byte. `node scripts/evidence-pack.mjs restore campaign/campaigns/fixed-cli/corpus/packed-derived/fixed-cli-local-mlx`
writes them to a temporary directory; `node scripts/evidence-pack.mjs verify` checks every pack
against its inventory.
