// Reader for npm-ecosystem `package.json`. Collects dependencies from
// all four standard dependency blocks so mock-of-hallucination can
// resolve test-only mocks (devDependencies) the same way it resolves
// runtime mocks.

import * as fs from 'fs';
import * as path from 'path';
import { SwarmError } from '../../../errors';

const DEP_KEYS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
] as const;

export function readDependencies(repoRoot: string): Set<string> {
  const out = new Set<string>();
  const file = path.join(repoRoot, 'package.json');
  if (!fs.existsSync(file)) return out;
  const parsed = parsePackageJson(file, fs.readFileSync(file, 'utf8'));
  for (const key of DEP_KEYS) {
    const block = parsed[key];
    if (block !== null && typeof block === 'object') {
      for (const name of Object.keys(block as Record<string, unknown>)) {
        out.add(name);
      }
    }
  }
  return out;
}

function parsePackageJson(file: string, text: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    throw new SwarmError(
      `package.json at ${file} is not a JSON object`,
      'AUDIT_MANIFEST_PARSE',
      { remediation: 'Ensure package.json contains a top-level JSON object.' },
    );
  } catch (err) {
    if (err instanceof SwarmError) throw err;
    throw new SwarmError(
      `failed to parse package.json at ${file}: ${(err as Error).message}`,
      'AUDIT_MANIFEST_PARSE',
      {
        cause: err,
        remediation: 'Run `node -e "JSON.parse(require(\'fs\').readFileSync(\'package.json\',\'utf8\'))"` to locate the syntax error.',
      },
    );
  }
}
