#!/usr/bin/env node
/**
 * Copy non-TS assets from src/ into dist/ after `tsc -p tsconfig.build.json`.
 *
 * tsc only emits .ts/.tsx output. JSON Schema files under src/rules/schemas/
 * are loaded at runtime (via fs.readFileSync from a sibling __dirname/schemas/
 * lookup), so they must exist next to the compiled .js. Symlinking is avoided
 * for portability across CI runners that mount dist/ as a separate volume.
 */
const fs = require('fs');
const path = require('path');

const PAIRS = [
  {
    src: path.join(__dirname, '..', 'src', 'rules', 'schemas'),
    dst: path.join(__dirname, '..', 'dist', 'src', 'rules', 'schemas'),
    pattern: /\.schema\.json$/,
  },
  {
    // v8 contract obligation schema. The compiled loader at
    // dist/src/contract/schema/loader.js reads v1.json from its sibling
    // directory; the source-tree fallback covers tsx/dev runs.
    src: path.join(__dirname, '..', 'src', 'contract', 'schema'),
    dst: path.join(__dirname, '..', 'dist', 'src', 'contract', 'schema'),
    pattern: /\.json$/,
  },
  {
    // Local-inference grammar files used by LocalSession to constrain
    // FORMAT 1/2/3 output on GBNF-capable backends. Loaded at runtime
    // via __dirname-relative fs.readFileSync.
    src: path.join(__dirname, '..', 'src', 'inference', 'local', 'grammars'),
    dst: path.join(__dirname, '..', 'dist', 'src', 'inference', 'local', 'grammars'),
    pattern: /\.gbnf$/,
  },
  {
    // Falsification adapter prompt templates. Each (adapter, obligation
    // kind) pairing ships as one .md file the profile loads at module
    // init via __dirname-relative fs.readFileSync.
    src: path.join(__dirname, '..', 'src', 'falsification', 'adapters', 'profiles', 'copilot', 'prompts'),
    dst: path.join(__dirname, '..', 'dist', 'src', 'falsification', 'adapters', 'profiles', 'copilot', 'prompts'),
    pattern: /\.md$/,
  },
  {
    src: path.join(__dirname, '..', 'src', 'falsification', 'adapters', 'profiles', 'codex', 'prompts'),
    dst: path.join(__dirname, '..', 'dist', 'src', 'falsification', 'adapters', 'profiles', 'codex', 'prompts'),
    pattern: /\.md$/,
  },
];

function copyMatching(srcDir, dstDir, pattern) {
  if (!fs.existsSync(srcDir)) return 0;
  fs.mkdirSync(dstDir, { recursive: true });
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  let copied = 0;
  for (const entry of entries) {
    if (!entry.isFile() || !pattern.test(entry.name)) continue;
    fs.copyFileSync(path.join(srcDir, entry.name), path.join(dstDir, entry.name));
    copied += 1;
  }
  return copied;
}

let total = 0;
for (const { src, dst, pattern } of PAIRS) {
  total += copyMatching(src, dst, pattern);
}
process.stdout.write(`copy-non-ts-assets: copied ${total} file(s)\n`);
