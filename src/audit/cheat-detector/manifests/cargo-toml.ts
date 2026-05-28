// Reader for Rust `Cargo.toml`. Reads the `[dependencies]` and
// `[dev-dependencies]` tables. No TOML parser dep — the field set we
// care about is line-greppable.

import * as fs from 'fs';
import { findManifestFiles } from './find-manifests';

const DEP_TABLES = new Set<string>(['[dependencies]', '[dev-dependencies]', '[build-dependencies]']);
const NAME_RE = /^([A-Za-z0-9_\-]+)\s*=/;

export function readDependencies(repoRoot: string): Set<string> {
  const out = new Set<string>();
  for (const file of findManifestFiles(repoRoot, 'Cargo.toml')) {
    const text = fs.readFileSync(file, 'utf8');
    let inDepBlock = false;
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (line.startsWith('[')) {
        inDepBlock = DEP_TABLES.has(line);
        continue;
      }
      if (!inDepBlock) continue;
      const m = line.match(NAME_RE);
      if (m?.[1]) out.add(m[1]);
    }
  }
  return out;
}
