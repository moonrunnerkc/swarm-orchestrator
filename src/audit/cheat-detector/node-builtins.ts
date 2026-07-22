// Node builtin-module recognition for the mock-of-hallucination
// detector. A mock target like `node:child_process`, bare `fs`, or a
// subpath such as `node:fs/promises` refers to the Node.js runtime, not
// to an npm package, so no project manifest can (or should) declare it.
// Treating builtins as undeclared produced block-severity false
// positives on real PRs (cloudflare/workers-sdk#14091 mocked
// `node:child_process` and was flagged as a hallucinated package).

import { builtinModules } from 'node:module';

function buildBuiltinSet(): Set<string> {
  const out = new Set<string>();
  for (const name of builtinModules) {
    out.add(name);
    // Recent Node versions list prefix-only modules (e.g. `node:test`)
    // with the prefix attached; index both spellings.
    if (name.startsWith('node:')) out.add(name.slice('node:'.length));
  }
  return out;
}

const BUILTINS: ReadonlySet<string> = buildBuiltinSet();

/**
 * True when a mock target specifier resolves to a Node.js builtin
 * module. The specifier is normalized before lookup: the `node:` prefix
 * is stripped, and a subpath specifier (`fs/promises`) also resolves to
 * its root (`fs`). Membership is checked against `builtinModules` from
 * `node:module`, so every builtin counts as declared for the npm
 * ecosystem.
 */
export function isNodeBuiltinMockTarget(target: string): boolean {
  const bare = target.startsWith('node:') ? target.slice('node:'.length) : target;
  if (BUILTINS.has(bare)) return true;
  const slash = bare.indexOf('/');
  if (slash === -1) return false;
  return BUILTINS.has(bare.slice(0, slash));
}
