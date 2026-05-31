// Reader for PHP `composer.json`. JSON parse, read the `require` and
// `require-dev` top-level objects. Both are vendor/package maps.

import * as fs from 'fs';
import { SwarmError } from '../../../errors';
import { findManifestFiles } from './find-manifests';

const REQUIRE_KEYS = ['require', 'require-dev'] as const;

export function readDependencies(repoRoot: string): Set<string> {
  const out = new Set<string>();
  for (const file of findManifestFiles(repoRoot, 'composer.json')) {
    const parsed = parseComposerJson(file, fs.readFileSync(file, 'utf8'));
    for (const key of REQUIRE_KEYS) {
      const block = parsed[key];
      if (block !== null && typeof block === 'object' && !Array.isArray(block)) {
        for (const name of Object.keys(block as Record<string, unknown>)) {
          out.add(name);
          // PHP packages are vendor/package; also expose the bare
          // package name and the bare vendor name so mocks written
          // with either resolve.
          const slash = name.indexOf('/');
          if (slash > 0) {
            out.add(name.slice(0, slash));
            out.add(name.slice(slash + 1));
          }
        }
      }
    }
  }
  return out;
}

function parseComposerJson(file: string, text: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    throw new SwarmError(
      `composer.json at ${file} is not a JSON object`,
      'AUDIT_MANIFEST_PARSE',
      { remediation: 'Ensure composer.json contains a top-level JSON object.' },
    );
  } catch (err) {
    if (err instanceof SwarmError) throw err;
    throw new SwarmError(
      `failed to parse composer.json at ${file}: ${(err as Error).message}`,
      'AUDIT_MANIFEST_PARSE',
      {
        cause: err,
        remediation: 'Run `composer validate` to locate the syntax error.',
      },
    );
  }
}
