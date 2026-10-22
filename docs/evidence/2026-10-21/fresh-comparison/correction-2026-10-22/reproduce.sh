#!/bin/sh
# Rebuilds the four trees of the correction from the public repository and reruns its checks.
# Usage: reproduce.sh <scratch dir> <dir holding the two published alias patches>
# The patches are payloads/patches/mocha-bugfix-long-prefix-short-alias.{opencode,swarm}.patch of
# the stage's pack (node scripts/evidence-pack.mjs restore docs/evidence/2026-10-21/fresh-comparison/packed-derived/payloads).
set -eu
scratch=$1
patches=$2
here=$(cd "$(dirname "$0")" && pwd)
base=bb2e69a953645fa12b534d20182a5ca5fbbc995b
reference=12279398f98942f21eeca7c1df5967f5f3bbe83f
mkdir -p "$scratch"
cd "$scratch"
[ -d mirror.git ] || git clone --quiet --bare https://github.com/mochajs/mocha.git mirror.git
for tree in base reference opencode swarm; do
  rm -rf "$tree"
  git clone --quiet mirror.git "$tree"
done
git -C base checkout --quiet "$base"
git -C reference checkout --quiet "$reference"
for arm in opencode swarm; do
  git -C "$arm" checkout --quiet "$base"
  git -C "$arm" apply "$patches/mocha-bugfix-long-prefix-short-alias.$arm.patch"
done
(cd base && npm ci --no-audit --no-fund --ignore-scripts > /dev/null)
(cd reference && npm ci --no-audit --no-fund --ignore-scripts > /dev/null)
ln -s ../base/node_modules opencode/node_modules
ln -s ../base/node_modules swarm/node_modules
for tree in base reference opencode swarm; do
  echo "== $tree $(git -C "$tree" rev-parse HEAD)"
  node "$here/expanded-check.mjs" "$tree" || true
  (cd "$tree" && npx --no-install eslint lib/cli/parse-args.js test/node-unit/cli/parse-args.spec.js) || true
done
# The order dependence of the project's lint, on the untouched base: run 1 passes, later runs fail.
for run in 1 2 3; do
  (cd base && npm run --loglevel=error lint:knip-docs > /dev/null 2>&1) && echo "knip-docs run $run: exit 0" || echo "knip-docs run $run: exit 1"
done
