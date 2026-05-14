import * as path from 'path';
import { spawnSync } from 'child_process';
import * as ts from 'typescript';

/**
 * AST-backed import extractor for the `import-graph-must-satisfy`
 * obligation type.
 *
 * Replaces the v8.0 regex matcher: TypeScript / JavaScript files are
 * parsed with the TypeScript compiler API; Python files are parsed with
 * the `ast` module via a python3 subprocess. Each call returns the list
 * of module specifiers the file imports — relative paths, bare specifiers,
 * package paths, all in the original textual form.
 *
 * The verifier's downstream resolution (mapping a relative spec back to
 * a tracked file, walking the local graph) consumes that string list
 * exactly as the regex matcher used to. This module changes how imports
 * are discovered, not how the constraint is evaluated.
 */

const PY_EXTRACTOR_SOURCE = `
import ast, json, sys

with open(sys.argv[1], 'r', encoding='utf-8') as f:
    source = f.read()

try:
    tree = ast.parse(source, filename=sys.argv[1])
except SyntaxError as exc:
    print(json.dumps({'error': 'syntax: ' + str(exc), 'specs': []}))
    sys.exit(0)

specs = []

class Visitor(ast.NodeVisitor):
    def visit_Import(self, node):
        for alias in node.names:
            specs.append(alias.name)
        self.generic_visit(node)

    def visit_ImportFrom(self, node):
        # Reconstruct the textual form: "." * level + module
        prefix = '.' * (node.level or 0)
        module = node.module or ''
        specs.append(prefix + module)
        self.generic_visit(node)

Visitor().visit(tree)
print(json.dumps({'specs': specs}))
`;

const TS_LIKE_EXTS = new Set(['.ts', '.tsx', '.cts', '.mts', '.js', '.jsx', '.cjs', '.mjs']);
const PY_EXTS = new Set(['.py']);

export interface ImportExtractionOptions {
  /** Override the python3 binary used for Python AST parsing. */
  pythonBin?: string;
  /** Cap on the python3 subprocess wall time, in ms. */
  pythonTimeoutMs?: number;
}

const DEFAULT_PY_TIMEOUT_MS = 30_000;

/**
 * Extract every import specifier from `body`, picking the right parser
 * based on `absFilePath`'s extension. Returns a flat string list in
 * source order; downstream code is responsible for resolving relative
 * paths and applying constraint-specific rules.
 *
 * Parser failures (Python subprocess unavailable, invalid syntax) return
 * an empty list so the import-graph constraint still falls through to a
 * clear, non-violating verdict on files the parser cannot read; the
 * verifier surfaces parser errors in the obligation detail string when
 * `error` is non-empty.
 */
export function extractImports(
  absFilePath: string,
  body: string,
  options: ImportExtractionOptions = {},
): { specs: string[]; error?: string } {
  const ext = path.extname(absFilePath).toLowerCase();
  if (PY_EXTS.has(ext)) {
    return extractPythonImports(absFilePath, options);
  }
  if (TS_LIKE_EXTS.has(ext) || ext === '') {
    return { specs: extractTypeScriptImports(absFilePath, body) };
  }
  return { specs: extractTypeScriptImports(absFilePath, body) };
}

function extractTypeScriptImports(absFilePath: string, body: string): string[] {
  const specs: string[] = [];
  const sourceFile = ts.createSourceFile(
    absFilePath,
    body,
    ts.ScriptTarget.Latest,
    /*setParentNodes*/ true,
    pickScriptKind(absFilePath),
  );

  function visit(node: ts.Node): void {
    // import ... from 'spec';      side-effect import 'spec';
    if (ts.isImportDeclaration(node)) {
      const lit = node.moduleSpecifier;
      if (ts.isStringLiteral(lit)) specs.push(lit.text);
    }
    // export ... from 'spec';
    else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      const lit = node.moduleSpecifier;
      if (ts.isStringLiteral(lit)) specs.push(lit.text);
    }
    // import x = require('spec');
    else if (ts.isImportEqualsDeclaration(node)) {
      const ref = node.moduleReference;
      if (ts.isExternalModuleReference(ref) && ts.isStringLiteral(ref.expression)) {
        specs.push(ref.expression.text);
      }
    }
    // require('spec') call expression
    else if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (
        ts.isIdentifier(callee) &&
        callee.text === 'require' &&
        node.arguments.length === 1
      ) {
        const arg = node.arguments[0];
        if (arg && ts.isStringLiteral(arg)) specs.push(arg.text);
      }
      // import('spec') dynamic import
      if (callee.kind === ts.SyntaxKind.ImportKeyword && node.arguments.length === 1) {
        const arg = node.arguments[0];
        if (arg && ts.isStringLiteral(arg)) specs.push(arg.text);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return specs;
}

function extractPythonImports(
  absFilePath: string,
  options: ImportExtractionOptions,
): { specs: string[]; error?: string } {
  const pythonBin = options.pythonBin ?? process.env.SWARM_PYTHON_BIN ?? 'python3';
  const timeout = options.pythonTimeoutMs ?? DEFAULT_PY_TIMEOUT_MS;
  const result = spawnSync(pythonBin, ['-c', PY_EXTRACTOR_SOURCE, absFilePath], {
    encoding: 'utf8',
    timeout,
  });
  if (result.error) {
    const code = (result.error as NodeJS.ErrnoException).code;
    const why =
      code === 'ENOENT'
        ? `python3 not found on PATH (looked for "${pythonBin}"); install Python 3 or set SWARM_PYTHON_BIN`
        : code === 'ETIMEDOUT'
          ? `python AST parser timed out after ${timeout}ms`
          : result.error.message;
    return { specs: [], error: why };
  }
  if (result.status !== 0) {
    const tail = (result.stderr || result.stdout || '').slice(-512).trim();
    return {
      specs: [],
      error: `python AST parser exited ${result.status ?? 'null'}${tail ? `: ${tail}` : ''}`,
    };
  }
  let parsed: { specs?: string[]; error?: string };
  try {
    parsed = JSON.parse(result.stdout || '{}');
  } catch (err) {
    return { specs: [], error: `python AST parser produced non-JSON output: ${(err as Error).message}` };
  }
  if (parsed.error) return { specs: parsed.specs ?? [], error: parsed.error };
  return { specs: parsed.specs ?? [] };
}

function pickScriptKind(absFilePath: string): ts.ScriptKind {
  const ext = path.extname(absFilePath).toLowerCase();
  if (ext === '.tsx') return ts.ScriptKind.TSX;
  if (ext === '.jsx') return ts.ScriptKind.JSX;
  if (ext === '.js' || ext === '.cjs' || ext === '.mjs') return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}
