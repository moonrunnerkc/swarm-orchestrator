#!/bin/bash
# Copies what a run's record needs into an archive directory: no model blobs, no keys, no clones.
#   collect.sh <runs dir> <destination dir>
set -u
src=$1 dst=$2
for run in "$src"/*/; do
  name=$(basename "$run")
  out=$dst/$name
  mkdir -p "$out"
  for f in start.txt wall.txt run.out run.err report.md report.json patch.diff replay.out judge.json \
           drafted-security.json generated-test.txt learn.out approve.out conventions.out proposal.toml OPERATOR-NOTE.txt; do
    [ -f "$run/$f" ] && cp "$run/$f" "$out/$f"
  done
  # The signed verifications: statement, manifest and signature of each, and the session's ledger
  # (record headers and digests only; the payload blobs stay out).
  for v in "$run"/home/sessions/*/verifications/*/; do
    [ -f "$v/statement.json" ] || continue
    n=$(basename "$v")
    mkdir -p "$out/verifications/$n"
    cp "$v/statement.json" "$v/manifest.json" "$v/attestation.sigstore.json" "$v/attestation.pub.pem" "$out/verifications/$n/" 2>/dev/null
  done
  cp "$run"/home/sessions/*/ledger.jsonl "$out/ledger.jsonl" 2>/dev/null
done
du -sh "$dst" | cut -f1
