#!/bin/bash
# Usage: run-vera.sh <patch-name> <config-name>
S="${COMPETITORS_DIR:?set to the directory holding fixture/ and bin/}"
P=$1; C=$2
D=$S/runs/vera-$C-$P
rm -rf "$D"; cp -R $S/fixture/base "$D"; cd "$D"
export HOME=$S/vera-home
echo "\$ vera init"; $S/vera-bin/vera init; echo "exit=$?"
if [ "$C" = default ]; then
cat > .vera/goal.yaml <<Y
agent: "fixed-patch"
goal: "Fix sum() so it adds every element"
contracts:
  - type: "exit_code"
    args: ["npm", "test"]
  - type: "readonly"
    args: ["test/*"]
Y
else
cat > .vera/goal.yaml <<Y
agent: "fixed-patch"
goal: "Fix sum() so it adds every element"
contracts:
  - type: "exit_code"
    args: ["npm", "test"]
  - type: "readonly"
    args: ["test/*", "package.json"]
  - type: "yagni_diff"
    args: ["20"]
Y
fi
echo "\$ vera record git apply $S/fixture/patches/$P.patch"
$S/vera-bin/vera record git apply $S/fixture/patches/$P.patch; echo "exit=$?"
echo "\$ vera verify"; $S/vera-bin/vera verify; echo "exit=$?"
