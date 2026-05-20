import * as path from 'path';
import { spawnSync } from 'child_process';
import * as ts from 'typescript';

/**
 * AST-backed signature checker for the `function-must-have-signature`
 * obligation type.
 *
 * Replaces the v8.0 substring matcher: TypeScript / JavaScript files are
 * parsed with the TypeScript compiler API; Python files are parsed with the
 * `ast` module via a python3 subprocess. The check finds every function or
 * method declared with the requested name (including arrow functions and
 * function expressions assigned to a const, and method declarations on
 * classes/object literals), then compares the declared signature to the
 * obligation's expected signature.
 *
 * Comparison is whitespace-insensitive: parameter lists and return types
 * are collapsed to a canonical form before equality. Overload sets and
 * multiple same-name declarations both pass when at least one declaration
 * matches.
 *
 * The expected signature is a string of the form `(<params>): <return>`,
 * e.g. `(req: Request): Promise<Response>` for TS or `(x: int) -> bool`
 * for Python. Either form is parsed in the corresponding language; the
 * file extension picks the parser.
 */

const TS_LIKE_EXTS = new Set(['.ts', '.tsx', '.cts', '.mts', '.js', '.jsx', '.cjs', '.mjs']);
const PY_EXTS = new Set(['.py']);

const PY_EXTRACTOR_SOURCE = `
import ast, json, sys

with open(sys.argv[1], 'r', encoding='utf-8') as f:
    source = f.read()

target_name = sys.argv[2]

try:
    tree = ast.parse(source, filename=sys.argv[1])
except SyntaxError as exc:
    print(json.dumps({'error': 'syntax: ' + str(exc)}))
    sys.exit(0)


def render_args(args_node):
    parts = []
    posonly = list(getattr(args_node, 'posonlyargs', []))
    pos = list(args_node.args)
    defaults = list(args_node.defaults or [])
    n_defaults = len(defaults)
    n_required = len(posonly) + len(pos) - n_defaults

    flat = posonly + pos
    for i, a in enumerate(flat):
        s = a.arg
        if a.annotation is not None:
            s += ': ' + ast.unparse(a.annotation)
        default_index = i - n_required
        if default_index >= 0 and default_index < n_defaults:
            s += '=' + ast.unparse(defaults[default_index])
        parts.append(s)
        if i == len(posonly) - 1 and posonly:
            parts.append('/')

    if args_node.vararg is not None:
        v = '*' + args_node.vararg.arg
        if args_node.vararg.annotation is not None:
            v += ': ' + ast.unparse(args_node.vararg.annotation)
        parts.append(v)
    elif args_node.kwonlyargs:
        parts.append('*')

    for i, a in enumerate(args_node.kwonlyargs):
        s = a.arg
        if a.annotation is not None:
            s += ': ' + ast.unparse(a.annotation)
        d = args_node.kw_defaults[i] if i < len(args_node.kw_defaults) else None
        if d is not None:
            s += '=' + ast.unparse(d)
        parts.append(s)

    if args_node.kwarg is not None:
        s = '**' + args_node.kwarg.arg
        if args_node.kwarg.annotation is not None:
            s += ': ' + ast.unparse(args_node.kwarg.annotation)
        parts.append(s)

    return ', '.join(parts)


def render_signature(node):
    params = render_args(node.args)
    ret = ''
    if node.returns is not None:
        ret = ' -> ' + ast.unparse(node.returns)
    return '(' + params + ')' + ret


found = []

class Visitor(ast.NodeVisitor):
    def visit_FunctionDef(self, node):
        if node.name == target_name:
            found.append(render_signature(node))
        self.generic_visit(node)

    def visit_AsyncFunctionDef(self, node):
        if node.name == target_name:
            found.append(render_signature(node))
        self.generic_visit(node)

Visitor().visit(tree)
print(json.dumps({'signatures': found}))
`;

export interface SignatureCheckResult {
  matched: boolean;
  /** True if at least one function/method with the requested name was found. */
  nameFound: boolean;
  /** Normalized form of the obligation's expected signature. */
  expectedNormalized: string;
  /** Normalized form of every declared signature for the requested name. */
  observedNormalized: string[];
  /** Free-form diagnostic — non-empty when an internal error stopped the check. */
  error?: string;
}

export interface CheckSignatureOptions {
  /** Override the python3 binary used for Python AST parsing. */
  pythonBin?: string;
  /** Cap on the python3 subprocess wall time, in ms. */
  pythonTimeoutMs?: number;
}

const DEFAULT_PY_TIMEOUT_MS = 30_000;

/**
 * Check whether the file at `absFilePath` declares a function or method
 * named `name` with the supplied `expectedSignature`. The file's contents
 * are read by the per-language parser (the TS path takes the in-memory
 * `body` to avoid a second filesystem read).
 */
export function checkFunctionSignature(
  absFilePath: string,
  body: string,
  name: string,
  expectedSignature: string,
  options: CheckSignatureOptions = {},
): SignatureCheckResult {
  const ext = path.extname(absFilePath).toLowerCase();
  if (PY_EXTS.has(ext)) {
    return checkPythonSignature(absFilePath, name, expectedSignature, options);
  }
  if (TS_LIKE_EXTS.has(ext) || ext === '') {
    return checkTypeScriptSignature(absFilePath, body, name, expectedSignature);
  }
  return checkTypeScriptSignature(absFilePath, body, name, expectedSignature);
}

function checkTypeScriptSignature(
  absFilePath: string,
  body: string,
  name: string,
  expectedSignature: string,
): SignatureCheckResult {
  const expectedNorm = normalizeTsSignature(expectedSignature);
  const sourceFile = ts.createSourceFile(
    absFilePath,
    body,
    ts.ScriptTarget.Latest,
    /*setParentNodes*/ true,
    pickScriptKind(absFilePath),
  );

  const observed: string[] = [];

  function recordSignature(node: ts.SignatureDeclaration): void {
    observed.push(renderTsSignature(node, sourceFile));
  }

  function visit(node: ts.Node): void {
    if (ts.isFunctionDeclaration(node) && node.name && node.name.text === name) {
      recordSignature(node);
    } else if (ts.isFunctionExpression(node) && node.name && node.name.text === name) {
      recordSignature(node);
    } else if (
      (ts.isMethodDeclaration(node) || ts.isMethodSignature(node)) &&
      node.name &&
      memberNameText(node.name) === name
    ) {
      recordSignature(node);
    } else if (ts.isVariableDeclaration(node) && node.name && ts.isIdentifier(node.name)) {
      if (node.name.text === name) {
        const fn = unwrapInitializerToFunctionNode(node.initializer);
        if (fn) recordSignature(fn);
      }
    } else if (ts.isPropertyDeclaration(node) && node.name) {
      if (memberNameText(node.name) === name) {
        const fn = unwrapInitializerToFunctionNode(node.initializer);
        if (fn) recordSignature(fn);
      }
    } else if (ts.isPropertyAssignment(node) && node.name) {
      if (memberNameText(node.name) === name) {
        const fn = unwrapInitializerToFunctionNode(node.initializer);
        if (fn) recordSignature(fn);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);

  const observedNormalized = observed.map(normalizeTsSignature);
  const matched = observedNormalized.some((s) => s === expectedNorm);
  return {
    matched,
    nameFound: observed.length > 0,
    expectedNormalized: expectedNorm,
    observedNormalized,
  };
}

/**
 * Resolve `const name = <initializer>` to the function node whose
 * signature represents the named binding's call shape. Supports:
 *   - direct arrow: `const x = (req, res) => {}` → ArrowFunction
 *   - direct expr: `const x = function(req, res) {}` → FunctionExpression
 *   - one-arg wrapper call: `const x = catchAsync((req, res) => {})`
 *     → ArrowFunction inside the call's single argument
 *
 * The wrapper-call form is the dominant Express idiom (catchAsync,
 * asyncHandler, expressAsync, etc.). The verifier used to ignore it
 * because the initializer is a CallExpression, not a function literal —
 * which meant the entire express-controller pattern flunked the
 * function-must-have-signature check even when the signature was
 * exactly right.
 *
 * Returns null when no function node is reachable in one hop.
 */
function unwrapInitializerToFunctionNode(
  initializer: ts.Expression | undefined,
): ts.SignatureDeclaration | null {
  if (!initializer) return null;
  if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) {
    return initializer;
  }
  if (ts.isCallExpression(initializer) && initializer.arguments.length === 1) {
    const arg = initializer.arguments[0];
    if (arg && (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg))) {
      return arg;
    }
  }
  return null;
}

function memberNameText(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name)) return name.text;
  if (ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  return undefined;
}

function pickScriptKind(absFilePath: string): ts.ScriptKind {
  const ext = path.extname(absFilePath).toLowerCase();
  if (ext === '.tsx') return ts.ScriptKind.TSX;
  if (ext === '.jsx') return ts.ScriptKind.JSX;
  if (ext === '.js' || ext === '.cjs' || ext === '.mjs') return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function renderTsSignature(node: ts.SignatureDeclaration, sourceFile: ts.SourceFile): string {
  const params = node.parameters.map((p) => p.getText(sourceFile)).join(', ');
  const ret = node.type ? `: ${node.type.getText(sourceFile)}` : '';
  return `(${params})${ret}`;
}

/**
 * Normalize a TS-shaped signature string into a canonical form for
 * equality. Accepts both styles:
 *
 *   - Declaration tail: `(params): Return`
 *   - Function-type literal: `(params) => Return`
 *
 * Both normalize to `(<params>):<return>`. Falls back to a whitespace
 * strip if neither parse produces a usable shape (preserving the
 * pre-AST substring-matcher behaviour for malformed obligations).
 */
function normalizeTsSignature(sig: string): string {
  const trimmed = sig.trim();
  // Prefer the type-alias parse when arrow syntax is present; otherwise
  // prefer the function-declaration parse. Either parse that yields a
  // return-type wins over one that does not.
  const preferArrow = /=>/.test(trimmed);
  const attempts: Array<() => { params: string; ret: string } | null> = preferArrow
    ? [() => parseAsTypeLiteral(trimmed), () => parseAsFunctionDecl(trimmed)]
    : [() => parseAsFunctionDecl(trimmed), () => parseAsTypeLiteral(trimmed)];
  for (const attempt of attempts) {
    const parsed = attempt();
    if (parsed && (parsed.params.length > 0 || parsed.ret.length > 0)) {
      const ret = parsed.ret ? `:${parsed.ret}` : '';
      return `(${parsed.params})${ret}`;
    }
  }
  return stripWhitespace(trimmed);
}

function parseAsFunctionDecl(sig: string): { params: string; ret: string } | null {
  try {
    const sf = ts.createSourceFile(
      '__decl__.ts',
      `function __probe__${sig} {}`,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const stmt = sf.statements[0];
    if (stmt && ts.isFunctionDeclaration(stmt)) {
      const params = stmt.parameters.map((p) => stripWhitespace(p.getText(sf))).join(',');
      const ret = stmt.type ? stripWhitespace(stmt.type.getText(sf)) : '';
      return { params, ret };
    }
  } catch {
    /* fall through */
  }
  return null;
}

function parseAsTypeLiteral(sig: string): { params: string; ret: string } | null {
  try {
    const sf = ts.createSourceFile(
      '__type__.ts',
      `type __probe__ = ${sig};`,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const stmt = sf.statements[0];
    if (stmt && ts.isTypeAliasDeclaration(stmt) && ts.isFunctionTypeNode(stmt.type)) {
      const ft = stmt.type;
      const params = ft.parameters.map((p) => stripWhitespace(p.getText(sf))).join(',');
      const ret = ft.type ? stripWhitespace(ft.type.getText(sf)) : '';
      return { params, ret };
    }
  } catch {
    /* fall through */
  }
  return null;
}

function stripWhitespace(s: string): string {
  return s.replace(/\s+/g, '');
}

function checkPythonSignature(
  absFilePath: string,
  name: string,
  expectedSignature: string,
  options: CheckSignatureOptions,
): SignatureCheckResult {
  const pythonBin = options.pythonBin ?? process.env.SWARM_PYTHON_BIN ?? 'python3';
  const timeout = options.pythonTimeoutMs ?? DEFAULT_PY_TIMEOUT_MS;
  const expectedNorm = normalizePySignature(expectedSignature);
  const result = spawnSync(pythonBin, ['-c', PY_EXTRACTOR_SOURCE, absFilePath, name], {
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
    return {
      matched: false,
      nameFound: false,
      expectedNormalized: expectedNorm,
      observedNormalized: [],
      error: why,
    };
  }
  if (result.status !== 0) {
    const tail = (result.stderr || result.stdout || '').slice(-512).trim();
    return {
      matched: false,
      nameFound: false,
      expectedNormalized: expectedNorm,
      observedNormalized: [],
      error: `python AST parser exited ${result.status ?? 'null'}${tail ? `: ${tail}` : ''}`,
    };
  }
  let parsed: { signatures?: string[]; error?: string };
  try {
    parsed = JSON.parse(result.stdout || '{}');
  } catch (err) {
    return {
      matched: false,
      nameFound: false,
      expectedNormalized: expectedNorm,
      observedNormalized: [],
      error: `python AST parser produced non-JSON output: ${(err as Error).message}`,
    };
  }
  if (parsed.error) {
    return {
      matched: false,
      nameFound: false,
      expectedNormalized: expectedNorm,
      observedNormalized: [],
      error: parsed.error,
    };
  }
  const observed = (parsed.signatures ?? []).map(normalizePySignature);
  return {
    matched: observed.some((s) => s === expectedNorm),
    nameFound: observed.length > 0,
    expectedNormalized: expectedNorm,
    observedNormalized: observed,
  };
}

/**
 * Normalize a Python-shaped signature `(<params>) -> <return>` into a
 * whitespace-insensitive canonical form. Python's `ast.unparse` already
 * emits a stable single-line shape so a whitespace strip is enough; we
 * normalize the arrow to ` -> ` first so `()->X` and `() -> X` collide.
 */
function normalizePySignature(sig: string): string {
  return stripWhitespace(sig.trim().replace(/\s*->\s*/g, '->'));
}
