import * as path from 'path';
import * as fs from 'fs';
import { getLogger } from '../logger';

const logger = getLogger('session:auto-discover');

const PATCHES_FILENAMES = [
  'patches.jsonl',
  'swarm-patches.jsonl',
] as const;

const PATCHES_DIRNAME = 'patches';

const MAX_DEPTH = 20;

/**
 * Walk from `cwd` upward (up to 20 levels) looking for a patches source.
 * Checks for `patches.jsonl`, `swarm-patches.jsonl`, and a `patches/`
 * directory (in that order at each level). Returns the absolute path of
 * the first match found, or `undefined` if nothing is found.
 */
export function findPatchesSource(cwd: string): string | undefined {
  let dir = path.resolve(cwd);
  for (let i = 0; i < MAX_DEPTH; i += 1) {
    for (const filename of PATCHES_FILENAMES) {
      const candidate = path.join(dir, filename);
      try {
        if (fs.existsSync(candidate)) {
          const abs = path.resolve(candidate);
          logger.debug(`auto-detected patches source at ${abs}`);
          return abs;
        }
      } catch {
        // ignore permission errors, etc.
      }
    }
    // Check for patches/ directory
    const patchesDir = path.join(dir, PATCHES_DIRNAME);
    try {
      const stat = fs.statSync(patchesDir);
      if (stat.isDirectory()) {
        const abs = path.resolve(patchesDir);
        logger.debug(`auto-detected patches source at ${abs}`);
        return abs;
      }
    } catch {
      // not found or not a directory — ignore
    }

    const parent = path.dirname(dir);
    if (parent === dir) break; // reached fs root
    dir = parent;
  }
  return undefined;
}