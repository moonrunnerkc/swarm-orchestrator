#!/bin/sh
# Saves the working tree's change against a base as a control patch, new files included.
#   save-control.sh <checkout> <base> <out.patch>
set -e
cd "$1"
git add -A
git diff --cached --binary "$2" -- . ':(exclude)node_modules' ':(exclude)acceptance' > "$3"
git reset -q
echo "$(wc -c < "$3") bytes -> $3"
