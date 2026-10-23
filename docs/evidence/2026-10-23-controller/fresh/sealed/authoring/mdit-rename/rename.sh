#!/bin/zsh
# Alternative rename: git mv every src module, then rewrite only module specifiers.
set -e
setopt extended_glob
for f in $(git ls-files 'src/*.mjs'); do git mv "$f" "${f%.mjs}.ts"; done
for f in src/**/*.ts; do sed -i '' -E "s#((from|import) '\.{1,2}/[^']*)\.mjs'#\1.ts'#g" "$f"; done
for f in test/**/*.mjs support/*.mjs support/demo_template/index.mjs benchmark/*.mjs benchmark/implementations/current*/index.mjs; do
  sed -i '' -E "s#('(\.\./)+src/[^']*)\.mjs'#\1.ts'#g" "$f"
done
sed -i '' "s#entry: 'src/index.mjs'#entry: 'src/index.ts'#" support/build-dist.mjs
