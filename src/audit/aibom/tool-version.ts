// The swarm-audit tool version, read from the nearest package.json. Shared by
// the CycloneDX and SPDX emitters and the evidence-pack CLI so the version
// stamped in an AIBOM, folded into the replay-identical identity, and written
// to the MANIFEST are all the same string.

import * as fs from 'fs';
import * as path from 'path';

/**
 * Resolve the tool version by walking up from this module's directory to the
 * nearest package.json with a `version`. Returns '0.0.0' if none is found, so a
 * missing manifest degrades to a stable placeholder rather than throwing.
 *
 * @param startDir directory to start the upward search from (defaults to this
 *   module's directory). Injectable for tests.
 * @returns the package version string, or '0.0.0'.
 */
export function readToolVersion(startDir: string = __dirname): string {
  let dir = startDir;
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = path.join(dir, 'package.json');
    if (fs.existsSync(candidate)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(candidate, 'utf8')) as { version?: string };
        if (typeof parsed.version === 'string') return parsed.version;
      } catch (err) {
        throw new Error(`failed to read package.json at ${candidate}: ${(err as Error).message}`, {
          cause: err,
        });
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return '0.0.0';
}
