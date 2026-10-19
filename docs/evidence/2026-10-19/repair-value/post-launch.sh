#!/bin/sh
# After one launch has finished, and before the next starts: keep its session blobs beside its
# ledgers (gzipped, for lossless packing), scan its requests for exposure, and score it apart, the
# delivered patch and then every candidate. Nothing here reaches the product or a model.
#
#   sh post-launch.sh <launch dir> <the driver's scratch dir> <scoring scratch dir>
set -eu
launch=$1
scratch=$2
work=$3
here=$(cd "$(dirname "$0")" && pwd)
evidence=$here/../..
sessions=$scratch/home/.swarm/sessions
mkdir -p "$work"
for session in $(ls "$sessions"); do
  mkdir -p "$launch/$session.blobs"
  for blob in "$sessions/$session"/blobs/*; do
    gzip -9 -c "$blob" > "$launch/$session.blobs/$(basename "$blob").gz"
  done
done
# The scan's markers for the retained faulty patch come from that patch, as O1's and O2's did; it
# is read from a record directory of its own, so the launch is not given a seeded.patch it never had.
mkdir -p "$work/exposure"
cp "$launch/exchanges.json.gz" "$work/exposure/"
cp "$evidence/2026-10-16/comparison/stage-a/patches/mime-bugfix-gettype-line-terminators.swarm.patch" \
  "$work/exposure/seeded.patch"
node "$evidence/2026-10-17/planned-check-live/scan-exposure.mjs" --task mime \
  --record "$work/exposure" --out "$launch/exposure.json"
node "$evidence/2026-10-17/repair-trust-live/score.mjs" --task mime \
  --patch "$launch/final.patch" --out "$launch/final-verdict.json"
node "$evidence/2026-10-18/checking-semantics/validate-expanded-audit.mjs" \
  --out "$launch/expanded-audit.json" --patch "$launch/final.patch" --name "$(basename "$launch")"
# The per-candidate scorer reads a launch as the driver wrote it, with its blobs restored.
rm -rf "$work/launch"
mkdir -p "$work/launch"
cp "$launch/summary.json" "$launch/final.patch" "$launch"/*.ledger.jsonl "$work/launch/"
gunzip -c "$launch/exchanges.json.gz" > "$work/launch/exchanges.json"
for session in $(ls "$sessions"); do
  cp -R "$sessions/$session/blobs" "$work/launch/$session.blobs"
done
node "$here/score-launch.mjs" --launch "$work/launch" --out "$launch/candidates"
