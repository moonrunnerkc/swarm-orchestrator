// Public surface for the manifest-reader registry. Adds a new
// ecosystem in one place: drop a `<name>.ts` file with a
// `readDependencies(repoRoot)` export, then add it to the `READERS`
// array below.

import type { ManifestReader } from './types';
import { readDependencies as readPackageJson } from './package-json';
import { readDependencies as readRequirementsTxt } from './requirements-txt';
import { readDependencies as readPyprojectToml } from './pyproject-toml';
import { readDependencies as readGoMod } from './go-mod';
import { readDependencies as readCargoToml } from './cargo-toml';
import { readDependencies as readPomXml } from './pom-xml';
import { readDependencies as readGradle } from './gradle';
import { readDependencies as readGemfile } from './gemfile';
import { readDependencies as readComposerJson } from './composer-json';
import { readDependencies as readCsproj } from './csproj';

const READERS: readonly ManifestReader[] = [
  readPackageJson,
  readRequirementsTxt,
  readPyprojectToml,
  readGoMod,
  readCargoToml,
  readPomXml,
  readGradle,
  readGemfile,
  readComposerJson,
  readCsproj,
];

/**
 * Returns the union of every declared dependency name across every
 * supported ecosystem manifest at `repoRoot`. Silently absent
 * manifests contribute nothing; corrupt manifests bubble up the
 * reader's `SwarmError` so the user sees the parse error directly.
 */
export function collectKnownDependencies(repoRoot: string): Set<string> {
  const out = new Set<string>();
  for (const reader of READERS) {
    for (const name of reader(repoRoot)) out.add(name);
  }
  return out;
}

export type { ManifestReader } from './types';
