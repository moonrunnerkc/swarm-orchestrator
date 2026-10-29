#!/bin/sh
# Installs the pre-commit entry from docs/integrations.md as a scratch repository's git hook,
# then commits twice: a change that edits a test together with source, which the hook blocks,
# and an honest fix, which it lets through. The repository has this checkout's verifier
# installed, so `npx --yes swarm-verify` resolves to it. Run from a checkout of this repository:
#
#   sh docs/demos/pre-commit-demo.sh
set -u
here=$(cd "$(dirname "$0")/../.." && pwd)
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
SWARM_SIGNING_KEY=$(node -e 'console.log(require("crypto").generateKeyPairSync("ed25519").privateKey.export({type:"pkcs8",format:"pem"}))')
SWARM_HOME="$scratch/home"
export SWARM_SIGNING_KEY SWARM_HOME

step() { printf '\n$ %s\n' "$*"; sh -c "$*"; printf '[exit %s]\n' "$?"; }

(cd "$here/packages/swarm-verify" && npm pack --silent --pack-destination "$scratch" >/dev/null 2>&1)
cd "$scratch" && git init -q -b main demo && cd demo
git config user.email demo@example.com && git config user.name demo
mkdir test
printf 'export const half = (n) => n;\n' > half.mjs
printf 'import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { half } from "../half.mjs";\ntest("half", () => assert.equal(half(4), 2));\n' > test/half.test.mjs
printf '[checks]\ntest = "node --test"\n' > swarm.toml
printf 'node_modules/\n.swarm/\n' > .gitignore
git add -A && git commit -qm base
npm install --no-save --silent "$scratch/swarm-verify-2.0.0.tgz" >/dev/null 2>&1

# The entry from docs/integrations.md, run as the hook pre-commit would run it.
entry=$(sed -n "s/^ *entry: //p" "$here/docs/integrations.md")
printf '#!/bin/sh\n%s\n' "$entry" > .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit
step "cat .git/hooks/pre-commit"

step "printf 'export const half = () => 2;\n' > half.mjs && sed -i.bak 's/half(4), 2/half(4), half(4)/' test/half.test.mjs && rm test/half.test.mjs.bak"
step "git add half.mjs test/half.test.mjs && git commit -qm 'Make the test pass'"
step "git log --oneline"

step "git reset -q && git checkout -q -- test/half.test.mjs && printf 'export const half = (n) => n / 2;\n' > half.mjs"
step "git add half.mjs && git commit -qm 'Halve the number'"
step "git log --oneline"
