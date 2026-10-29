#!/bin/sh
# Runs the steps of packages/swarm-verify/action.yml by hand, the way a pull_request job runs
# them: in a full-history clone of a scratch repository, with the pull request's branch checked
# out, and the Verify step's own script under the environment the manifest gives it. The version
# input names this checkout's verifier, packed as npm would publish it. Run from a checkout of
# this repository:
#
#   sh docs/demos/action-demo.sh
set -u
here=$(cd "$(dirname "$0")/../.." && pwd)
manifest="$here/packages/swarm-verify/action.yml"
verifier="$here/packages/swarm-verify/verify.mjs"
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
SWARM_SIGNING_KEY=$(node -e 'console.log(require("crypto").generateKeyPairSync("ed25519").privateKey.export({type:"pkcs8",format:"pem"}))')
SWARM_HOME="$scratch/home"
export SWARM_SIGNING_KEY SWARM_HOME

step() { printf '\n$ %s\n' "$*"; sh -c "$*"; printf '[exit %s]\n' "$?"; }

(cd "$here/packages/swarm-verify" && npm pack --silent --pack-destination "$scratch" >/dev/null 2>&1)
cd "$scratch" && git init -q -b main origin && cd origin
git config user.email demo@example.com && git config user.name demo
mkdir test
printf 'export const half = (n) => n;\n' > half.mjs
printf 'import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { half } from "../half.mjs";\ntest("half", () => assert.equal(half(4), 2));\n' > test/half.test.mjs
printf '[checks]\ntest = "node --test"\n' > swarm.toml
git add -A && git commit -qm base
git checkout -qb fix-half
printf 'export const half = (n) => n / 2;\n' > half.mjs
git commit -qam "Halve the number"
cd "$scratch" && git clone -q origin workspace && cd workspace && git checkout -q fix-half

# Step 1 is actions/setup-node with node-version 24; this machine's Node stands in for it.
step "node --version"
# Step 2 is Verify: the manifest's run script, with the manifest's env and GitHub's own.
run=$(sed -n 's/^ *run: //p' "$manifest")
export GITHUB_BASE_REF=main GITHUB_STEP_SUMMARY="$scratch/summary.md"
export BASE="" VERSION="file:$scratch/swarm-verify-2.0.0.tgz"
printf '\n$ %s\n' "$run"; bash -c "$run"; printf '[exit %s]\n' "$?"
step "ls .swarm/verify"
step "node -p 'require(\"./.swarm/verify/attestation.sigstore.json\").mediaType'"
step "node $verifier .swarm/verify/attestation.sigstore.json --key .swarm/verify/attestation.pub.pem --patch .swarm/verify/change.patch"
step "head -4 $scratch/summary.md"
