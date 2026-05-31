// Reader for Python `pyproject.toml`. We do not introduce a TOML
// parser dep; the canonical PEP 621 and Poetry layouts are
// line-greppable for the field set we care about.

import * as fs from 'fs';
import { findManifestFiles } from './find-manifests';

const DEP_TABLE_HEADERS = new Set<string>([
  '[tool.poetry.dependencies]',
  '[tool.poetry.dev-dependencies]',
  '[project.optional-dependencies]',
]);

const DEP_ASSIGN_RE = /^([A-Za-z0-9_\-.]+)\s*=/;
const PEP621_ARRAY_RE = /^dependencies\s*=\s*\[(.+)\]$/;
const PEP621_ITEM_NAME_RE = /^['"]?([A-Za-z0-9_\-.]+)/;

export function readDependencies(repoRoot: string): Set<string> {
  const out = new Set<string>();
  for (const file of findManifestFiles(repoRoot, 'pyproject.toml')) {
    const text = fs.readFileSync(file, 'utf8');
    let inDepBlock = false;
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (line.startsWith('[')) {
        inDepBlock = line.includes('dependencies') || DEP_TABLE_HEADERS.has(line);
        continue;
      }
      if (inDepBlock) {
        const m = DEP_ASSIGN_RE.exec(line);
        if (m?.[1] !== undefined && m[1].toLowerCase() !== 'python') out.add(m[1]);
      }
      const arrayMatch = line.match(PEP621_ARRAY_RE);
      if (arrayMatch?.[1]) {
        for (const item of arrayMatch[1].split(',')) {
          const cleaned = item.trim().replace(/^['"]|['"]$/g, '');
          const nameMatch = cleaned.match(PEP621_ITEM_NAME_RE);
          if (nameMatch?.[1]) out.add(nameMatch[1]);
        }
      }
    }
  }
  return out;
}
