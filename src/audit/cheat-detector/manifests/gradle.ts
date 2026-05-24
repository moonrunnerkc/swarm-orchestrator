// Reader for Gradle: `build.gradle` (Groovy DSL) and `build.gradle.kts`
// (Kotlin DSL). Matches the common declaration shapes:
//   implementation 'group:name:version'
//   api "group:name:version"
//   testImplementation('group:name:version')
//   testImplementation("group:name:version")
// Extracts both the full `group:name` coordinate and the bare `name`
// so a mock target written as either resolves cleanly.

import * as fs from 'fs';
import * as path from 'path';

const CONFIGURATIONS = [
  'implementation',
  'api',
  'compileOnly',
  'runtimeOnly',
  'testImplementation',
  'testCompileOnly',
  'testRuntimeOnly',
  'androidTestImplementation',
  'kapt',
  'ksp',
];

const FILE_NAMES = ['build.gradle', 'build.gradle.kts'];

export function readDependencies(repoRoot: string): Set<string> {
  const out = new Set<string>();
  for (const name of FILE_NAMES) {
    const file = path.join(repoRoot, name);
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    collectFromText(text, out);
  }
  return out;
}

function collectFromText(text: string, out: Set<string>): void {
  for (const cfg of CONFIGURATIONS) {
    // Match `implementation 'group:name:version'` and parenthesized variants,
    // single or double quotes.
    const re = new RegExp(`\\b${cfg}\\b\\s*\\(?\\s*['"]([^'"]+)['"]`, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const coord = m[1];
      if (coord === undefined) continue;
      const parts = coord.split(':');
      if (parts.length >= 2) {
        const group = parts[0];
        const name = parts[1];
        if (group !== undefined && group.length > 0) out.add(group);
        if (name !== undefined && name.length > 0) {
          out.add(name);
          if (group !== undefined && group.length > 0) out.add(`${group}:${name}`);
        }
      } else {
        out.add(coord);
      }
    }
  }
}
