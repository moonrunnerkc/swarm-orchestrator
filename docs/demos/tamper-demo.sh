#!/bin/sh
# Verifies a change on a scratch repository, checks the attestation with verify.mjs and cosign,
# flips one byte of it, and checks again. Run from a checkout of this repository:
#
#   sh docs/demos/tamper-demo.sh
#
# SWARM names the swarm command (default: this checkout's src/cli.ts).
set -u
here=$(cd "$(dirname "$0")/../.." && pwd)
swarm=${SWARM:-"node $here/src/cli.ts"}
verifier="$here/packages/swarm-verify/verify.mjs"
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
cd "$scratch"
# A throwaway signing key, so the demo never touches the OS keychain.
SWARM_SIGNING_KEY=$(node -e 'console.log(require("crypto").generateKeyPairSync("ed25519").privateKey.export({type:"pkcs8",format:"pem"}))')
SWARM_HOME="$scratch/home"
export SWARM_SIGNING_KEY SWARM_HOME

step() { printf '\n$ %s\n' "$*"; sh -c "$*"; printf '[exit %s]\n' "$?"; }

git init -q -b main demo && cd demo
git config user.email demo@example.com && git config user.name demo
mkdir test
printf 'export const half = (n) => n;\n' > half.mjs
printf 'import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { half } from "../half.mjs";\ntest("half", () => assert.equal(half(4), 2));\n' > test/half.test.mjs
printf '{ "type": "module", "scripts": { "test": "node --test" } }\n' > package.json
git add -A && git commit -qm base

step "$swarm init"
git add swarm.toml && git commit -qm "declare checks"
step "printf 'export const half = (n) => n / 2;\n' > half.mjs"
step "$swarm verify --out out"
step "node $verifier out/attestation.sigstore.json --key out/attestation.pub.pem --patch out/change.patch"
if command -v cosign >/dev/null 2>&1; then
  step "cosign verify-blob-attestation --bundle out/attestation.sigstore.json --key out/attestation.pub.pem --type https://swarm-verify.dev/verdict/v1 --insecure-ignore-tlog=true out/change.patch"
fi
step "node -e 'const f=require(\"fs\");const b=f.readFileSync(\"out/attestation.sigstore.json\");const i=b.indexOf(\"\\\"payload\\\": \\\"\")+40;b[i]^=1;f.writeFileSync(\"out/attestation.sigstore.json\",b);console.log(\"flipped one bit of byte\",i)'"
step "node $verifier out/attestation.sigstore.json --key out/attestation.pub.pem --patch out/change.patch"
if command -v cosign >/dev/null 2>&1; then
  step "cosign verify-blob-attestation --bundle out/attestation.sigstore.json --key out/attestation.pub.pem --type https://swarm-verify.dev/verdict/v1 --insecure-ignore-tlog=true out/change.patch"
fi
