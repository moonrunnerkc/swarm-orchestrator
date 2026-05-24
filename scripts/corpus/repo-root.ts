// Walks up from `__dirname` to find the swarm-orchestrator repo root.
// Required because the compiled scripts live under `dist/scripts/corpus/`,
// so `path.resolve(__dirname, '..', '..')` lands inside `dist/` rather
// than at the project root.

import * as fs from 'fs';
import * as path from 'path';

export function findRepoRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 8; i += 1) {
    const candidate = path.join(dir, 'package.json');
    if (fs.existsSync(candidate)) {
      const text = fs.readFileSync(candidate, 'utf8');
      if (text.includes('"swarm-orchestrator"')) return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`scripts/corpus: could not locate swarm-orchestrator repo root from ${start}`);
}
