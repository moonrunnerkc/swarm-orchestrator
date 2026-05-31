// Reader for Maven `pom.xml`. We do not introduce an XML parser
// dep — the schema fields we care about (`<groupId>`, `<artifactId>`
// inside a `<dependency>` block) are line-greppable and the parser
// cost would be high for one detector. We include test-scope and
// provided-scope dependencies because mocks of those are still
// legitimate; the detector only asks "does this dependency exist in
// the project's declared set?" — not whether it would ship at
// runtime.

import * as fs from 'fs';
import { findManifestFiles } from './find-manifests';

const GROUP_RE = /<groupId>\s*([^<\s]+)\s*<\/groupId>/;
const ARTIFACT_RE = /<artifactId>\s*([^<\s]+)\s*<\/artifactId>/;

export function readDependencies(repoRoot: string): Set<string> {
  const out = new Set<string>();
  for (const file of findManifestFiles(repoRoot, 'pom.xml')) {
    const text = fs.readFileSync(file, 'utf8');
    for (const block of extractDependencyBlocks(text)) {
      const group = block.match(GROUP_RE)?.[1];
      const artifact = block.match(ARTIFACT_RE)?.[1];
      if (artifact !== undefined && artifact.length > 0) {
        out.add(artifact);
        if (group !== undefined && group.length > 0) {
          out.add(`${group}:${artifact}`);
          out.add(group);
        }
      }
    }
  }
  return out;
}

function extractDependencyBlocks(text: string): string[] {
  const out: string[] = [];
  const open = /<dependency>/g;
  let openMatch: RegExpExecArray | null;
  while ((openMatch = open.exec(text)) !== null) {
    const closeIdx = text.indexOf('</dependency>', openMatch.index);
    if (closeIdx === -1) break;
    out.push(text.slice(openMatch.index, closeIdx));
  }
  return out;
}
