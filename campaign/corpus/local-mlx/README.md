# local-mlx corpus

The `local-mlx` bundles of this campaign, whose payloads were already moved out of the
repository (`blobs.digests.json` in each names them), are packed whole and losslessly in
`packed-derived/local-mlx-corpus`: every ledger, DAG, manifest and embedded verifier, byte for
byte. `node scripts/evidence-pack.mjs restore campaign/corpus/local-mlx/packed-derived/local-mlx-corpus`
writes them to a temporary directory; `node scripts/evidence-pack.mjs verify` checks every pack
against its inventory.
