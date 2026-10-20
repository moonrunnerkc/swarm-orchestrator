# local-ollama corpus

The `local-ollama` bundles of this campaign, whose payloads were already moved out of the
repository (`blobs.digests.json` in each names them), are packed whole and losslessly in
`packed-derived/local-ollama-corpus`: every ledger, DAG, manifest and embedded verifier, byte for
byte. `node scripts/evidence-pack.mjs restore campaign/corpus/local-ollama/packed-derived/local-ollama-corpus`
writes them to a temporary directory; `node scripts/evidence-pack.mjs verify` checks every pack
against its inventory.
