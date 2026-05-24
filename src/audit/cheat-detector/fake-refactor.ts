// Fake refactor. v2.0 (v10.2-advisory): drops the v1.0 regex-only
// caller scan and uses a TypeScript-compiler-API closure across the
// diff to identify the real cheat pattern.
//
// The cheat is: an exported symbol is renamed in the source, but a
// caller in the same PR (in any other diff-touched file, or even in
// the renaming file itself) still references the old name. The v1.0
// detector approximated this by searching for the old name as a
// substring of the other-file diff lines, which both over- and
// under-fired: any string that happened to contain the old name
// triggered a false-positive, and the absence of the old name as a
// substring missed real cheats where the caller's line had been
// rewritten.
//
// The v2.0 approach:
//
//   1. Walk diff hunks for `export function|class|const|let|var NAME`
//      deletions paired with same-hunk additions of the same export
//      kind. The pair (oldName, newName) is a rename candidate.
//   2. For each non-renaming diff file, parse the joined added text
//      with the TypeScript compiler API and walk the AST for any
//      Identifier whose `text === oldName`. The Identifier is the
//      real callsite signal, not the line substring.
//   3. The renaming file itself can also fail this check (a self-
//      referential caller that wasn't updated when the export was
//      renamed). We include it.
//
// We parse with `ts.ScriptKind.TSX` so the same path covers `.ts`,
// `.tsx`, `.js`, `.jsx`, and `.mjs` source — TSX is a strict superset.
// `ts.createSourceFile` parses fragments without complaining about
// incomplete top-level statements, which is exactly what diff-added
// text is.

import * as ts from 'typescript';
import type { Detector, DetectorContext } from './detector-types';
import type { Finding } from '../types';
import { isTestFile, walkHunks } from './diff-walker';

const VERSION = '2.0.0';

const EXPORT_DECL_RE = /^\s*export\s+(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)/;

interface RenamePair {
  file: string;
  oldName: string;
  newName: string;
  addedLine: number;
  hunkEvidence: string;
}

export const fakeRefactorDetector: Detector = {
  name: 'fake-refactor',
  version: VERSION,
  run(ctx: DetectorContext): Finding[] {
    const hunks = walkHunks(ctx.files);
    const renames = collectRenamePairs(hunks);
    if (renames.length === 0) return [];

    const addedByFile = collectAddedByFile(hunks);
    const findings: Finding[] = [];
    for (const rename of renames) {
      const callers = findCallers(rename, addedByFile);
      if (callers.length === 0) continue;
      findings.push({
        category: 'fake-refactor',
        severity: 'block',
        message:
          `Function "${rename.oldName}" was renamed to "${rename.newName}" in ${rename.file} ` +
          `but ${callers.length} caller reference${callers.length === 1 ? '' : 's'} to ` +
          `"${rename.oldName}" remain in this PR (${callers.join(', ')}).`,
        location: { file: rename.file, line: rename.addedLine },
        evidence: rename.hunkEvidence,
      });
    }
    return findings;
  },
};

function collectRenamePairs(
  hunks: ReturnType<typeof walkHunks>,
): RenamePair[] {
  const out: RenamePair[] = [];
  for (const hunk of hunks) {
    if (isTestFile(hunk.file)) continue;
    for (const del of hunk.deleted) {
      const oldName = del.content.match(EXPORT_DECL_RE)?.[1];
      if (oldName === undefined) continue;
      for (const add of hunk.added) {
        const newName = add.content.match(EXPORT_DECL_RE)?.[1];
        if (newName === undefined || newName === oldName) continue;
        out.push({
          file: hunk.file,
          oldName,
          newName,
          addedLine: add.lineNumber,
          hunkEvidence: `- ${del.content.trim()}\n+ ${add.content.trim()}`,
        });
      }
    }
  }
  return out;
}

/**
 * Concatenate every diff-visible line per file: added lines for the
 * "new caller appeared in the PR" case, and unchanged-context lines
 * for the "the caller line wasn't even edited" case. The within-file
 * recursive-call cheat lives in the second case.
 *
 * Deleted-only lines are skipped: a removed caller is by definition
 * a caller that the PR DID update (it's gone).
 */
function collectAddedByFile(hunks: ReturnType<typeof walkHunks>): Map<string, string> {
  const out = new Map<string, string>();
  for (const hunk of hunks) {
    if (isTestFile(hunk.file)) continue;
    const existing = out.get(hunk.file) ?? '';
    const lines: string[] = [];
    for (const change of hunk.chunk.changes) {
      if (change.type === 'add' || change.type === 'normal') {
        lines.push(change.content.slice(1));
      }
    }
    const addedText = lines.join('\n');
    out.set(hunk.file, existing.length > 0 ? `${existing}\n${addedText}` : addedText);
  }
  return out;
}

function findCallers(rename: RenamePair, addedByFile: ReadonlyMap<string, string>): string[] {
  const out: string[] = [];
  for (const [file, text] of addedByFile) {
    if (text.length === 0) continue;
    // The declaration site of the rename's *new* name is, by
    // definition, not a caller of the old name. But we DO want to
    // catch self-referential within-file callers that the rename
    // missed (e.g., a recursive function whose recursive call was
    // not updated). The AST walk below excludes the rename's own
    // declaration node when it matches the new name, not the old.
    if (referencesIdentifier(text, rename.oldName, file === rename.file ? rename.newName : undefined)) {
      out.push(file);
    }
  }
  return out;
}

/**
 * True iff the TS AST of `text` contains an Identifier whose name
 * is `target`. When `excludeDeclName` is provided, declarations of
 * names matching that string are skipped so the renamed export's
 * own declaration node does not look like a caller of itself.
 *
 * The text is parsed as TSX so the same path covers JS/TS/JSX/TSX
 * without picking a per-file ScriptKind.
 */
function referencesIdentifier(
  text: string,
  target: string,
  excludeDeclName?: string,
): boolean {
  const source = ts.createSourceFile(
    'diff-added.tsx',
    text,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    ts.ScriptKind.TSX,
  );
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isIdentifier(node) && node.text === target) {
      if (excludeDeclName !== undefined) {
        const parent = node.parent;
        if (parent !== undefined && isOwnDeclarationName(parent, node, excludeDeclName)) {
          // skip — this is the export's own declaration name node
        } else {
          found = true;
          return;
        }
      } else {
        found = true;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

function isOwnDeclarationName(parent: ts.Node, ident: ts.Identifier, excludeName: string): boolean {
  if (ident.text !== excludeName) return false;
  // Function/class/variable declarations expose `.name` as the
  // declaration's name node. When the visited Identifier IS that
  // node, the parent is the declaration itself.
  if (ts.isFunctionDeclaration(parent) && parent.name === ident) return true;
  if (ts.isClassDeclaration(parent) && parent.name === ident) return true;
  if (ts.isVariableDeclaration(parent) && parent.name === ident) return true;
  return false;
}
