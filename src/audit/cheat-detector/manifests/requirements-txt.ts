// Reader for Python `requirements.txt`. One package per line in the
// PEP 508 form; we read only the distribution name and drop the
// version specifier and any extras / markers.

import * as fs from 'fs';
import * as path from 'path';

export function readDependencies(repoRoot: string): Set<string> {
  const out = new Set<string>();
  const file = path.join(repoRoot, 'requirements.txt');
  if (!fs.existsSync(file)) return out;
  const text = fs.readFileSync(file, 'utf8');
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith('#')) continue;
    const name = line.split(/[<>=!~ ;[]/)[0]?.trim();
    if (name !== undefined && name.length > 0) out.add(name);
  }
  return out;
}
