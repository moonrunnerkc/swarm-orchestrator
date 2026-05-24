// Reader for .NET project files (`*.csproj`). Matches:
//   <PackageReference Include="Newtonsoft.Json" Version="13.0.1" />
//   <PackageReference Include="Moq"><Version>4.20.0</Version></PackageReference>
// Walks the repo root plus one level deep (project files often live
// under per-project subdirs in a multi-project solution).

import * as fs from 'fs';
import * as path from 'path';

const PACKAGE_REF_RE = /<PackageReference\s+[^>]*Include\s*=\s*"([^"]+)"/gi;

export function readDependencies(repoRoot: string): Set<string> {
  const out = new Set<string>();
  for (const file of findCsprojFiles(repoRoot)) {
    const text = fs.readFileSync(file, 'utf8');
    let m: RegExpExecArray | null;
    PACKAGE_REF_RE.lastIndex = 0;
    while ((m = PACKAGE_REF_RE.exec(text)) !== null) {
      const name = m[1];
      if (name !== undefined && name.length > 0) out.add(name);
    }
  }
  return out;
}

function findCsprojFiles(repoRoot: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(repoRoot)) return out;
  // Root-level matches.
  for (const entry of fs.readdirSync(repoRoot, { withFileTypes: true })) {
    const full = path.join(repoRoot, entry.name);
    if (entry.isFile() && entry.name.endsWith('.csproj')) {
      out.push(full);
    } else if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
      try {
        for (const inner of fs.readdirSync(full, { withFileTypes: true })) {
          if (inner.isFile() && inner.name.endsWith('.csproj')) {
            out.push(path.join(full, inner.name));
          }
        }
      } catch {
        // skip subdirs we can't read; csproj detection is best-effort
      }
    }
  }
  return out;
}
