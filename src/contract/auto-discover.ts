import * as path from 'path';
import * as fs from 'fs';
import { getLogger } from '../logger';

const logger = getLogger('contract:auto-discover');

const CONTRACT_FILENAMES = [
  'contract.yaml',
  'contract.json',
  'swarm-contract.yaml',
  'swarm-contract.json',
  '.swarm/contract.yaml',
  '.swarm/contract.json',
] as const;

const MAX_DEPTH = 20;

/**
 * Walk from `cwd` upward (up to 20 levels) looking for a contract file.
 * Returns the absolute path of the first file found, or `undefined` if
 * nothing is found.
 */
export function findContractFile(cwd: string): string | undefined {
  let dir = path.resolve(cwd);
  for (let i = 0; i < MAX_DEPTH; i += 1) {
    for (const filename of CONTRACT_FILENAMES) {
      const candidate = path.join(dir, filename);
      try {
        if (fs.existsSync(candidate)) {
          const abs = path.resolve(candidate);
          logger.debug(`auto-detected contract file at ${abs}`);
          return abs;
        }
      } catch {
        // ignore permission errors, etc.
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break; // reached fs root
    dir = parent;
  }
  return undefined;
}