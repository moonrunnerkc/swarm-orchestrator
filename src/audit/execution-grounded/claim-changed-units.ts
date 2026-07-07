// Changed-unit extraction for the claim-differential witness compiler. The
// closure control fails a witness whose import graph does not reach a
// behaviorally-revertable changed source file; a witness written from the PR's
// claim text alone has no way to know which unit to import. This module gives the
// compiler that missing information: for each revertable changed file, the file
// path plus its exported symbol names, read from the provisioned head checkout.
//
// TS/JS exports are read from the TypeScript AST (the `typescript` runtime dep the
// closure resolver already uses); a CommonJS `exports.x =` pass catches the
// hand-written-CJS case the AST misses. Non-TS/JS files contribute their path with
// an empty symbol list: the proof tier is Node-only, so a non-Node changed file is
// still worth naming to the model but carries no extractable export set here.

import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import { getLogger } from '../../logger';

const log = getLogger('audit:execution-grounded:claim-changed-units');

/** A changed source file the witness should import, with its exported symbols. */
export interface ChangedUnit {
  /** Repo-relative path of the changed file. */
  readonly file: string;
  /** Exported symbol names, best-effort; empty for non-TS/JS or on a parse failure. */
  readonly exports: readonly string[];
}

const TS_JS = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/i;

function hasExportModifier(node: ts.Node): boolean {
  const mods = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  return mods?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
}

/**
 * Extract the exported symbol names from a TS/JS source. Covers `export function`
 * / `class` / `const` / `interface` / `type` / `enum`, re-export lists
 * (`export { a, b }`), and CommonJS `exports.x =` assignments. Returns [] for a
 * non-TS/JS path or when the source will not parse.
 *
 * @param source the file's text.
 * @param filePath the path (used only to decide TS/JS and pick the parser flavor).
 * @returns the sorted, de-duplicated export names.
 */
export function extractExportedSymbols(source: string, filePath: string): readonly string[] {
  if (!TS_JS.test(filePath)) return [];
  const names = new Set<string>();
  try {
    const sf = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node): void => {
      if (
        (ts.isFunctionDeclaration(node) ||
          ts.isClassDeclaration(node) ||
          ts.isInterfaceDeclaration(node) ||
          ts.isTypeAliasDeclaration(node) ||
          ts.isEnumDeclaration(node)) &&
        node.name !== undefined &&
        hasExportModifier(node)
      ) {
        names.add(node.name.text);
      }
      if (ts.isVariableStatement(node) && hasExportModifier(node)) {
        for (const decl of node.declarationList.declarations) {
          if (ts.isIdentifier(decl.name)) names.add(decl.name.text);
        }
      }
      if (ts.isExportDeclaration(node) && node.exportClause !== undefined && ts.isNamedExports(node.exportClause)) {
        for (const el of node.exportClause.elements) names.add(el.name.text);
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  } catch (err) {
    log.debug(`export extraction failed for ${filePath}: ${String(err)}`);
  }
  // Hand-written CommonJS the AST scan above does not model as exports.
  for (const m of source.matchAll(/(?:module\.)?exports\.([A-Za-z_$][\w$]*)\s*=/g)) {
    if (m[1] !== undefined) names.add(m[1]);
  }
  return [...names].sort();
}

/**
 * Read each behaviorally-revertable changed file from the head checkout and pair
 * it with its exported symbols, for the witness-compilation prompt.
 *
 * @param revertableFiles repo-relative paths from behaviorallyRevertableSourceFiles.
 * @param headWorkspace the provisioned head (post-PR) checkout root.
 * @returns one ChangedUnit per file; an unreadable file yields an empty export set.
 */
export function extractChangedUnits(
  revertableFiles: readonly string[],
  headWorkspace: string,
): ChangedUnit[] {
  const units: ChangedUnit[] = [];
  for (const rel of revertableFiles) {
    const abs = path.isAbsolute(rel) ? rel : path.join(headWorkspace, rel);
    let source: string;
    try {
      source = fs.readFileSync(abs, 'utf8');
    } catch {
      units.push({ file: rel, exports: [] });
      continue;
    }
    units.push({ file: rel, exports: extractExportedSymbols(source, abs) });
  }
  return units;
}

/**
 * Render the changed-unit context for the witness prompt: the files the witness
 * must import from and the symbols each exports. Empty string when there are no
 * changed units to name (the prompt then omits the section).
 *
 * @param units the changed units from extractChangedUnits.
 * @returns a prompt fragment, or '' when units is empty.
 */
export function renderChangedUnits(units: readonly ChangedUnit[]): string {
  if (units.length === 0) return '';
  const lines = units.map((u) => {
    const syms = u.exports.length > 0 ? ` (exports: ${u.exports.slice(0, 12).join(', ')})` : '';
    return `- ${u.file}${syms}`;
  });
  return ['The PR changed these source files; import at least one and exercise it:', ...lines].join('\n');
}
