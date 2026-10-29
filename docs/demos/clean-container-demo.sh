#!/bin/sh
# Produces an attestation on the host, then checks it inside a node:24 container that has no
# network and no mount of anything: verify.mjs, the bundle, the public key and the patch go in
# over stdin as a tar stream. Run from a checkout of this repository, with docker available:
#
#   sh docs/demos/clean-container-demo.sh
set -u
here=$(cd "$(dirname "$0")/../.." && pwd)
swarm=${SWARM:-"node $here/src/cli.ts"}
image=${IMAGE:-node:24}
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
SWARM_SIGNING_KEY=$(node -e 'console.log(require("crypto").generateKeyPairSync("ed25519").privateKey.export({type:"pkcs8",format:"pem"}))')
SWARM_HOME="$scratch/home"
export SWARM_SIGNING_KEY SWARM_HOME

cd "$scratch" && git init -q -b main demo && cd demo
git config user.email demo@example.com && git config user.name demo
printf 'export const half = (n) => n;\n' > half.mjs
printf 'import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { half } from "./half.mjs";\ntest("half", () => assert.equal(half(4), 2));\n' > half.test.mjs
printf '[checks]\ntest = "node --test"\n' > swarm.toml
git add -A && git commit -qm base
printf 'export const half = (n) => n / 2;\n' > half.mjs
echo '$ swarm verify --out out   (on the host)'
$swarm verify --out out | sed -n '1p'

mkdir "$scratch/carry"
cp "$here/packages/swarm-verify/verify.mjs" out/attestation.sigstore.json out/attestation.pub.pem out/change.patch "$scratch/carry/"
docker pull -q "$image" >/dev/null
echo "\$ tar -c verify.mjs attestation.sigstore.json attestation.pub.pem change.patch | docker run -i --rm --network none $image sh"
tar -C "$scratch/carry" -c . | docker run -i --rm --network none "$image" sh -c '
  mkdir /check && cd /check && tar -x
  step() { printf "\n# %s\n" "$*"; sh -c "$*"; printf "[exit %s]\n" "$?"; }
  step "node --version"
  step "ls /check"
  step "node -e \"fetch(\\\"https://registry.npmjs.org\\\").then(() => console.log(\\\"network reachable\\\"), (e) => console.log(\\\"no network:\\\", e.cause?.code ?? e.message))\""
  step "node verify.mjs attestation.sigstore.json --key attestation.pub.pem --patch change.patch"
  step "node -e \"const f=require(\\\"fs\\\");const b=f.readFileSync(\\\"attestation.sigstore.json\\\");const i=b.indexOf(\\\"\\\\\\\"payload\\\\\\\": \\\\\\\"\\\")+40;b[i]^=1;f.writeFileSync(\\\"attestation.sigstore.json\\\",b);console.log(\\\"flipped one bit of byte\\\",i)\""
  step "node verify.mjs attestation.sigstore.json --key attestation.pub.pem --patch change.patch"
'
