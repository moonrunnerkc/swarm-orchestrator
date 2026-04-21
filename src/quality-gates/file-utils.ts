import * as fs from 'fs';
import * as path from 'path';
import { ProjectFile } from './types';

function to_posix(relPath: string): string {
  return relPath.split(path.sep).join('/');
}

/**
 * Parse a .gitignore file into directory names and path-prefix patterns.
 * Only handles the patterns quality gates care about: bare directory names
 * (e.g. "venv", "__pycache__") and directory prefixes ("venv/", "lib/").
 * Does not implement full gitignore globbing; the goal is to catch the
 * obvious third-party trees that should never be scanned.
 */
export function parse_gitignore_dirs(projectRoot: string): Set<string> {
  const dirs = new Set<string>();
  const gitignorePath = path.join(projectRoot, '.gitignore');

  if (!fs.existsSync(gitignorePath)) {
    return dirs;
  }

  let content: string;
  try {
    content = fs.readFileSync(gitignorePath, 'utf8');
  } catch {
    return dirs;
  }

  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    // Negation patterns (e.g. "!important/") are intentionally skipped;
    // they would need full gitignore semantics to handle correctly
    if (line.startsWith('!')) {
      continue;
    }
    // Strip trailing slash if present: "venv/" -> "venv"
    const cleaned = line.endsWith('/') ? line.slice(0, -1) : line;
    // Only treat simple names (no globs, no path separators) as directory excludes.
    // Patterns like "*.pyc" or "build/output" are too complex for this fast path.
    if (cleaned && !cleaned.includes('*') && !cleaned.includes('?') && !cleaned.includes('/')) {
      dirs.add(cleaned);
    }
  }

  return dirs;
}

export function list_project_files(projectRoot: string, excludeDirNames: string[]): ProjectFile[] {
  const files: ProjectFile[] = [];
  const exclude = new Set(excludeDirNames);

  // Merge directory names from .gitignore so project-specific exclusions
  // (like "venv", "lib", ".eggs") are honored without hardcoding every variant
  const gitignoreDirs = parse_gitignore_dirs(projectRoot);
  for (const dir of gitignoreDirs) {
    exclude.add(dir);
  }

  function walk(absDir: string): void {
    const entries = fs.readdirSync(absDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.name === '.DS_Store') {
        continue;
      }

      const absPath = path.join(absDir, entry.name);
      const relPath = to_posix(path.relative(projectRoot, absPath));

      if (entry.isDirectory()) {
        if (exclude.has(entry.name)) {
          continue;
        }
        walk(absPath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      let sizeBytes: number;
      try {
        sizeBytes = fs.statSync(absPath).size;
      } catch {
        // ignore unreadable
        continue;
      }

      files.push({
        path: absPath,
        relativePath: relPath,
        sizeBytes
      });
    }
  }

  walk(projectRoot);
  return files;
}

export function maybe_read_text(file: ProjectFile, maxBytes: number): string | undefined {
  if (file.sizeBytes > maxBytes) {
    return undefined;
  }

  try {
    const buf = fs.readFileSync(file.path);

    // crude binary sniff
    if (buf.includes(0)) {
      return undefined;
    }

    return buf.toString('utf8');
  } catch {
    return undefined;
  }
}

export function compile_regexes(regexes: string[]): RegExp[] {
  return regexes.map(r => new RegExp(r, 'i'));
}

export function is_excluded_by_regex(relPath: string, regexes: RegExp[]): boolean {
  return regexes.some(r => r.test(relPath));
}
