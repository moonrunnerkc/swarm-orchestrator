// Reader for .NET project files (`*.csproj`). Matches:
//   <PackageReference Include="Newtonsoft.Json" Version="13.0.1" />
//   <PackageReference Include="Moq"><Version>4.20.0</Version></PackageReference>

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

// csproj files don't have a single canonical filename (each project
// names its own), so we walk the tree with a suffix match rather than
// the shared findManifestFiles helper which matches by exact filename.
function findCsprojFiles(repoRoot: string): string[] {
  const out: string[] = [];
  const SKIP = new Set<string>([
    '.git', 'node_modules', 'bin', 'obj', 'dist', 'build', 'target',
    '__pycache__', '.venv', 'venv', '.gradle', '.idea', '.vscode',
  ]);
  function walk(dir: string, depth: number): void {
    if (depth > 5 || out.length >= 64) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (out.length >= 64) return;
      if (entry.isDirectory()) {
        if (SKIP.has(entry.name)) continue;
        if (entry.name.startsWith('.') && entry.name !== '.github') continue;
        walk(path.join(dir, entry.name), depth + 1);
      } else if (entry.isFile() && entry.name.endsWith('.csproj')) {
        out.push(path.join(dir, entry.name));
      }
    }
  }
  walk(repoRoot, 0);
  return out;
}
