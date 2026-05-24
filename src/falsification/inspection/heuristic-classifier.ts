/**
 * Heuristic pre-classifier for falsifier candidates.
 *
 * Hand inspections of grep-style predicates found roughly 33% of
 * machine-claimed yields were "predicate-gaming" — text that the
 * predicate counted as a violation but a human would not consider a
 * real instance. The AST-backed verifier filters most string-literal
 * gaming, but operator inspection is still required. This classifier
 * supports that step by pre-labelling each candidate as `likely-real`,
 * `likely-gaming`, or `ambiguous`, with a one-line reason.
 *
 * The classifier is **heuristic, not authoritative**. Operator verdict
 * has the final word; this module's labels appear in `inspection.md`
 * skeletons as a starting point, never as a substitute for inspection.
 *
 * Implementation discipline: parse with the TypeScript compiler API for
 * TS/JS files; compare AST node kinds, not regex. The "is this string
 * only inside a comment / string literal / template string?" check is
 * also AST-driven (TypeScript exposes trivia and parent-node kinds).
 */

import * as path from 'path';
import * as ts from 'typescript';
import type {
  FunctionMustHaveSignatureObligation,
  ImportGraphMustSatisfyObligation,
} from '../../contract/types';

export type HeuristicLabel = 'likely-real' | 'likely-gaming' | 'ambiguous';

export interface HeuristicClassification {
  readonly label: HeuristicLabel;
  /** One-line human-readable explanation of why this label was chosen. */
  readonly reason: string;
}

/**
 * Candidate file payload mirrors the shape adapters emit
 * (`CounterExampleInput.files[i]`).
 */
export interface CandidateFile {
  readonly relPath: string;
  readonly bytes: string;
}

/**
 * Pick a TypeScript ScriptKind for the candidate's extension. Defaults
 * to TS for unknown extensions so we still get a parse tree.
 */
function pickScriptKind(relPath: string): ts.ScriptKind {
  const ext = path.extname(relPath).toLowerCase();
  if (ext === '.tsx') return ts.ScriptKind.TSX;
  if (ext === '.jsx') return ts.ScriptKind.JSX;
  if (ext === '.js' || ext === '.cjs' || ext === '.mjs') return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function parseSource(file: CandidateFile): ts.SourceFile {
  return ts.createSourceFile(
    file.relPath,
    file.bytes,
    ts.ScriptTarget.Latest,
    /*setParentNodes*/ true,
    pickScriptKind(file.relPath),
  );
}

/**
 * Whether `text` appears in `source.text` in any form *not* parsed as
 * code — i.e., inside a JSDoc / line comment / block comment / string
 * literal / template literal. Used to decide between
 * `likely-gaming` (the constraint pattern only shows up in comments or
 * strings) and `ambiguous` (the pattern is absent from both code and
 * trivia).
 */
function containsNonCodeMention(source: ts.SourceFile, needle: string): boolean {
  if (needle.length === 0) return false;
  let found = false;

  // 1. String literals + template strings: AST nodes whose `text`
  //    contains the needle.
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      if (node.text.includes(needle)) {
        found = true;
        return;
      }
    } else if (ts.isTemplateExpression(node)) {
      if (node.head.text.includes(needle)) {
        found = true;
        return;
      }
      for (const span of node.templateSpans) {
        if (span.literal.text.includes(needle)) {
          found = true;
          return;
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (found) return true;

  // 2. Comments: TypeScript exposes comment ranges via the scanner.
  const fullText = source.getFullText();
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    /*skipTrivia*/ false,
    source.languageVariant,
    fullText,
  );
  let token = scanner.scan();
  while (token !== ts.SyntaxKind.EndOfFileToken) {
    if (
      token === ts.SyntaxKind.SingleLineCommentTrivia ||
      token === ts.SyntaxKind.MultiLineCommentTrivia
    ) {
      const text = fullText.slice(scanner.getTokenStart(), scanner.getTokenEnd());
      if (text.includes(needle)) return true;
    }
    token = scanner.scan();
  }
  return false;
}

/**
 * Classify an `import-graph-must-satisfy` candidate.
 *
 * Real = at least one import edge at AST level (ImportDeclaration,
 * ExportDeclaration with moduleSpecifier, ImportEqualsDeclaration with
 * external module reference, dynamic `import('...')`, or `require('...')`).
 *
 * Gaming = no import edge at AST level, but the constraint's import
 * pattern (the literal `"import"`, or specifically the relative path
 * pattern for `no-upward-imports` / cycle hint) appears only inside
 * comments / string literals / template strings.
 *
 * Ambiguous = no import edge AND no plausible non-code mention; the
 * candidate may falsify via some other mechanism the heuristic cannot
 * detect (e.g., the file is just present and the constraint relies on
 * a path-shape rule rather than an import edge).
 *
 * Implementation note: re-exports (`export { x } from './y'`) count as
 * import edges per the AST shape — the obligation is about the *graph*
 * regardless of whether the edge is an import or a re-export.
 */
export function classifyImportGraphCandidate(
  file: CandidateFile,
  obligation: ImportGraphMustSatisfyObligation,
): HeuristicClassification {
  const source = parseSource(file);
  const importEdges: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      const lit = node.moduleSpecifier;
      if (ts.isStringLiteral(lit)) importEdges.push(`import '${lit.text}'`);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier !== undefined) {
      const lit = node.moduleSpecifier;
      if (ts.isStringLiteral(lit)) importEdges.push(`export from '${lit.text}'`);
    } else if (ts.isImportEqualsDeclaration(node)) {
      const ref = node.moduleReference;
      if (ts.isExternalModuleReference(ref) && ts.isStringLiteral(ref.expression)) {
        importEdges.push(`import = require('${ref.expression.text}')`);
      }
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (
        ts.isIdentifier(callee) &&
        callee.text === 'require' &&
        node.arguments.length === 1
      ) {
        const arg = node.arguments[0];
        if (arg !== undefined && ts.isStringLiteral(arg)) {
          importEdges.push(`require('${arg.text}')`);
        }
      }
      if (
        callee.kind === ts.SyntaxKind.ImportKeyword &&
        node.arguments.length === 1
      ) {
        const arg = node.arguments[0];
        if (arg !== undefined && ts.isStringLiteral(arg)) {
          importEdges.push(`import('${arg.text}')`);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  if (importEdges.length > 0) {
    return {
      label: 'likely-real',
      reason: `AST contains ${importEdges.length} import edge(s): ${importEdges
        .slice(0, 3)
        .join(', ')}${importEdges.length > 3 ? ', …' : ''}`,
    };
  }

  // No code-level edges. Look for "import" mentions in trivia.
  const triviaMention = containsNonCodeMention(source, 'import');
  if (triviaMention) {
    return {
      label: 'likely-gaming',
      reason: `no AST-level import edge; "import" appears only inside comments or string literals`,
    };
  }

  // For no-upward-imports the constraint can also be falsified by an
  // import path containing `..`; with no AST edges at all and no
  // mention in trivia, the candidate likely relies on a different
  // mechanism (path-based file presence, etc.) — operator decides.
  const constraintHint =
    obligation.constraint === 'no-upward-imports'
      ? '..'
      : obligation.constraint === 'no-cycles'
        ? './'
        : '';
  if (constraintHint.length > 0 && containsNonCodeMention(source, constraintHint)) {
    return {
      label: 'ambiguous',
      reason: `no AST-level import edge; constraint hint "${constraintHint}" appears in trivia (operator decides whether the candidate falsifies via a different mechanism)`,
    };
  }
  return {
    label: 'ambiguous',
    reason: 'no AST-level import edge and no obvious trivia-mention of the constraint pattern',
  };
}

/**
 * Walk every named function-like declaration in `source`, returning a
 * (name, signature) pair for each. Covers function declarations,
 * method declarations, class methods, arrow functions assigned to
 * named variables, and `name = (…) => …` shapes.
 */
interface FoundFunction {
  readonly name: string;
  readonly signature: string;
  readonly kind: string;
}

function collectFunctions(source: ts.SourceFile): FoundFunction[] {
  const found: FoundFunction[] = [];
  const renderSignature = (
    params: ts.NodeArray<ts.ParameterDeclaration>,
    returnType: ts.TypeNode | undefined,
  ): string => {
    const paramText = params
      .map((p) => p.getText(source))
      .join(', ');
    const ret = returnType !== undefined ? `: ${returnType.getText(source)}` : '';
    return `(${paramText})${ret}`;
  };
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name !== undefined) {
      found.push({
        name: node.name.text,
        signature: renderSignature(node.parameters, node.type),
        kind: 'function',
      });
    } else if (
      (ts.isMethodDeclaration(node) ||
        ts.isMethodSignature(node) ||
        ts.isFunctionExpression(node)) &&
      node.name !== undefined &&
      ts.isIdentifier(node.name)
    ) {
      found.push({
        name: node.name.text,
        signature: renderSignature(node.parameters, node.type),
        kind: ts.isMethodDeclaration(node)
          ? 'method'
          : ts.isMethodSignature(node)
            ? 'method-signature'
            : 'function-expression',
      });
    } else if (ts.isVariableDeclaration(node) && node.initializer !== undefined) {
      const init = node.initializer;
      if (ts.isIdentifier(node.name) && ts.isArrowFunction(init)) {
        found.push({
          name: node.name.text,
          signature: renderSignature(init.parameters, init.type),
          kind: 'arrow',
        });
      } else if (ts.isIdentifier(node.name) && ts.isFunctionExpression(init)) {
        found.push({
          name: node.name.text,
          signature: renderSignature(init.parameters, init.type),
          kind: 'function-expression',
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, '');
}

/**
 * Classify a `function-must-have-signature` candidate.
 *
 * Real = a function declaration / method / arrow with the obligation's
 * name AND a signature substring matching the obligation's expected
 * signature (whitespace-insensitive).
 *
 * Gaming = no matching declaration, but the obligation's name appears
 * inside comments or string literals.
 *
 * Ambiguous = no matching declaration and no trivia mention. The
 * candidate may falsify via "the file no longer exists" or some other
 * shape the heuristic cannot directly detect.
 *
 * For falsification of the obligation specifically (drift the
 * signature so it no longer matches), the candidate is "real-as-
 * falsifier" iff there's a declaration whose name matches but whose
 * signature does NOT match. We surface that as `likely-real` with a
 * note that the signature drifted.
 */
export function classifyFunctionSignatureCandidate(
  file: CandidateFile,
  obligation: FunctionMustHaveSignatureObligation,
): HeuristicClassification {
  const source = parseSource(file);
  const fns = collectFunctions(source);
  const matchingName = fns.filter((f) => f.name === obligation.name);
  if (matchingName.length === 0) {
    if (containsNonCodeMention(source, obligation.name)) {
      return {
        label: 'likely-gaming',
        reason: `no AST-level declaration of "${obligation.name}"; the name appears only inside comments or string literals`,
      };
    }
    return {
      label: 'ambiguous',
      reason: `no AST-level declaration of "${obligation.name}" and no trivia mention; candidate may falsify by removing the file or via another mechanism`,
    };
  }
  // A declaration with the right name exists. Does its signature
  // match the obligation's expected signature?
  const expected = collapseWhitespace(obligation.signature);
  const matchingSignature = matchingName.find(
    (f) => collapseWhitespace(f.signature) === expected,
  );
  if (matchingSignature !== undefined) {
    // Declaration matches BOTH name and signature. The candidate did
    // *not* drift the signature; it may still falsify the obligation
    // if the obligation's predicate is "exact match" and the candidate
    // changes other surrounding code, but that is unusual. Surface as
    // ambiguous with the matching pair noted.
    return {
      label: 'ambiguous',
      reason: `declaration of "${obligation.name}" matches the expected signature \`${matchingSignature.signature}\`; the candidate did not drift the signature — operator should check whether the obligation falsifies via a different mechanism`,
    };
  }
  // The declaration exists but the signature is different — that *is*
  // a real signature drift, which is what
  // function-must-have-signature falsification looks like.
  const observed = matchingName[0]!;
  return {
    label: 'likely-real',
    reason: `declaration of "${obligation.name}" present but signature drifted: expected \`${obligation.signature}\`, observed \`${observed.signature}\``,
  };
}

/**
 * Convenience entry point: classify a candidate based on its
 * obligation type. Any other obligation type returns `ambiguous` with
 * a "no heuristic available" reason; the inspection workflow can still
 * pre-populate the operator-verdict field for those candidates.
 */
export function classifyCandidate(
  file: CandidateFile,
  obligation:
    | ImportGraphMustSatisfyObligation
    | FunctionMustHaveSignatureObligation,
): HeuristicClassification {
  if (obligation.type === 'import-graph-must-satisfy') {
    return classifyImportGraphCandidate(file, obligation);
  }
  return classifyFunctionSignatureCandidate(file, obligation);
}
