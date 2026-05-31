// Reader for Ruby: `Gemfile` and `Gemfile.lock`. The lockfile is
// preferred when present because it lists the actual resolved
// dependency tree (transitive included). Falls back to the Gemfile's
// direct declarations otherwise.

import * as fs from 'fs';
import { findManifestFiles } from './find-manifests';

const GEMFILE_LINE_RE = /^\s*gem\s+['"]([A-Za-z0-9_\-.]+)['"]/;
const LOCK_DEP_LINE_RE = /^\s{4}([A-Za-z0-9_\-.]+)\s*(?:\(|$)/;

export function readDependencies(repoRoot: string): Set<string> {
  const out = new Set<string>();
  for (const lockPath of findManifestFiles(repoRoot, 'Gemfile.lock')) {
    readGemfileLock(lockPath, out);
  }
  for (const gemfile of findManifestFiles(repoRoot, 'Gemfile')) {
    readGemfile(gemfile, out);
  }
  return out;
}

function readGemfile(file: string, out: Set<string>): void {
  const text = fs.readFileSync(file, 'utf8');
  for (const raw of text.split(/\r?\n/)) {
    const m = raw.match(GEMFILE_LINE_RE);
    if (m?.[1]) out.add(m[1]);
  }
}

function readGemfileLock(file: string, out: Set<string>): void {
  const text = fs.readFileSync(file, 'utf8');
  let inGemSection = false;
  for (const raw of text.split(/\r?\n/)) {
    // Sections in Gemfile.lock start with non-indented labels.
    if (/^[A-Z]+\s*$/.test(raw) || /^[A-Z][A-Z ]+:$/.test(raw)) {
      inGemSection = raw.trim() === 'GEM';
      continue;
    }
    if (!inGemSection) continue;
    const m = raw.match(LOCK_DEP_LINE_RE);
    if (m?.[1] && m[1].toLowerCase() !== 'specs' && m[1].toLowerCase() !== 'remote') {
      out.add(m[1]);
    }
  }
}
