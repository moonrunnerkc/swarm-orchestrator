#!/bin/bash
S="${COMPETITORS_DIR:?set to the directory holding fixture/ and bin/}"
P=$1; D=$S/runs/ci-$P; rm -rf "$D"; cp -R $S/fixture/base "$D"; cd "$D"
echo "\$ git apply $P.patch"; git apply $S/fixture/patches/$P.patch; echo "exit=$?"
echo "\$ npm test"; npm test; echo "exit=$?"
