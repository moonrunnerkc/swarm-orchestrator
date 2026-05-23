// Project-level audit configuration. Read from `.swarm/audit-config.yaml`
// at the repo root (when present); silently absent otherwise. The single
// supported field is `excludePaths`, a list of glob patterns that should
// be exempted from cheat detection on top of the engine's built-in
// subject-path filter.
//
// The intended use is for repos whose own source code legitimately
// contains literal cheat patterns: detector tests with embedded
// fixture diffs, rule packs that quote `if (false)` as documentation,
// generator scripts that emit broken patches by design. Without this
// hook those files force the dogfood audit to self-block on every
// commit and there is no way to fix the root cause without rewriting
// the detector to be AST-aware (out of scope for the regex engine).
//
// The glob syntax is minimal on purpose: `*` matches a path segment
// except `/`, `**` matches any number of segments. Anchored at the
// repo root unless the pattern begins with `**/`. Patterns are
// case-sensitive (paths on Linux/macOS are case-sensitive; Windows
// callers should write patterns to match).

import * as fs from 'fs';
import * as path from 'path';

const CONFIG_FILE = path.join('.swarm', 'audit-config.yaml');

export interface AuditConfig {
  excludePaths: readonly string[];
}

const EMPTY_CONFIG: AuditConfig = { excludePaths: [] };

export function loadAuditConfig(repoRoot: string): AuditConfig {
  const file = path.join(repoRoot, CONFIG_FILE);
  if (!fs.existsSync(file)) return EMPTY_CONFIG;
  const text = fs.readFileSync(file, 'utf8');
  const excludePaths = parseExcludePaths(text);
  return { excludePaths };
}

// Hand-rolled tiny YAML scan for the one supported field. Avoids a
// runtime YAML dep on a hot-path for what is effectively a list of
// strings; the project already keeps its YAML loader scoped to
// contract parsing.
function parseExcludePaths(text: string): readonly string[] {
  const lines = text.split(/\r?\n/);
  let inExcludeBlock = false;
  const out: string[] = [];
  for (const rawLine of lines) {
    const line = rawLine.replace(/#.*$/, '');
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    if (/^excludePaths\s*:/.test(trimmed)) {
      inExcludeBlock = true;
      continue;
    }
    if (inExcludeBlock) {
      const m = trimmed.match(/^-\s*(['"]?)(.+?)\1\s*$/);
      if (m && m[2] !== undefined) {
        out.push(m[2]);
        continue;
      }
      // Any non-list line ends the block.
      if (!trimmed.startsWith('-')) inExcludeBlock = false;
    }
  }
  return out;
}

export function buildExcludeMatcher(
  patterns: readonly string[],
): (filePath: string) => boolean {
  if (patterns.length === 0) return () => false;
  const regexes = patterns.map(globToRegex);
  return (filePath: string) => {
    const normalized = filePath.replace(/\\/g, '/');
    return regexes.some((re) => re.test(normalized));
  };
}

function globToRegex(glob: string): RegExp {
  let i = 0;
  let pattern = '';
  while (i < glob.length) {
    const ch = glob[i];
    if (ch === '*' && glob[i + 1] === '*') {
      // `**/` matches zero or more path segments
      if (glob[i + 2] === '/') {
        pattern += '(?:.*/)?';
        i += 3;
      } else {
        pattern += '.*';
        i += 2;
      }
    } else if (ch === '*') {
      pattern += '[^/]*';
      i += 1;
    } else if (ch === '?') {
      pattern += '[^/]';
      i += 1;
    } else if (ch !== undefined && /[.+^$()|{}\[\]\\]/.test(ch)) {
      pattern += `\\${ch}`;
      i += 1;
    } else {
      pattern += ch ?? '';
      i += 1;
    }
  }
  return new RegExp(`^${pattern}$`);
}
