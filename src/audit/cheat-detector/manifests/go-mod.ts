// Reader for Go `go.mod`. Handles both the single-require form
// (`require foo v1.2.3`) and the parenthesized-block form. Tracks
// require-block state so module-level lines (`module example.com/x`,
// `go 1.22`, `toolchain go1.22.0`) don't get mistaken for deps.

import * as fs from 'fs';
import * as path from 'path';

const SINGLE_REQUIRE_RE = /^require\s+([A-Za-z0-9._\-/]+)\s+v?[\d.]/;
const BLOCK_LINE_RE = /^([A-Za-z0-9._\-/]+)\s+v?[\d.]/;

export function readDependencies(repoRoot: string): Set<string> {
  const out = new Set<string>();
  const file = path.join(repoRoot, 'go.mod');
  if (!fs.existsSync(file)) return out;
  const text = fs.readFileSync(file, 'utf8');
  let inRequireBlock = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const single = line.match(SINGLE_REQUIRE_RE);
    if (single?.[1]) {
      out.add(single[1]);
      continue;
    }
    if (line.startsWith('require (')) {
      inRequireBlock = true;
      continue;
    }
    if (inRequireBlock && line === ')') {
      inRequireBlock = false;
      continue;
    }
    if (!inRequireBlock) continue;
    const block = line.match(BLOCK_LINE_RE);
    if (block?.[1]) out.add(block[1]);
  }
  return out;
}
