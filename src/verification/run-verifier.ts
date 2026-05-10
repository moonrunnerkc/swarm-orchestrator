import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Shell to use for verification commands (build, test, predicates,
 * benchmarks). LLM-authored property predicates routinely use bash-only
 * syntax — process substitution `<(...)`, `[[ ]]`, `$'...'`. Node's default
 * `shell: true` resolves to `/bin/sh` on POSIX, which doesn't accept those
 * forms and aborts with `syntax error near unexpected token '('`. Forcing
 * bash here keeps the verifier from rejecting otherwise-valid predicates.
 * `/bin/bash` exists on macOS, mainstream Linux distros, and CI runners.
 */
const VERIFICATION_SHELL = '/bin/bash';
import type {
  CoverageMustExceedObligation,
  FunctionMustHaveSignatureObligation,
  ImportGraphMustSatisfyObligation,
  ObligationV1,
  PerformanceMustNotRegressObligation,
} from '../contract/types';
import { checkFunctionSignature } from './ast-signature';
import { extractImports as extractImportsAst } from './ast-imports';

/**
 * Per-obligation verification result. Phase 2's verifier is the
 * post-generation, pre-commit checker described in
 * `v8-overhaul-guide.md` §5.5. Streaming and post-merge checks come in
 * Phase 6. Phase 7 (impl guide §10) extends the verifier with five new
 * obligation types: `function-must-have-signature`, `property-must-hold`,
 * `import-graph-must-satisfy`, `coverage-must-exceed`,
 * `performance-must-not-regress`.
 */
export interface VerificationResult {
  satisfied: boolean;
  detail: string;
}

export interface VerifyOptions {
  /** Repo root the command runs in / file paths are resolved against. */
  repoRoot: string;
  /** Cap on each command's wall time, in ms. */
  commandTimeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Verify a single obligation against the repository on disk. Switch is
 * exhaustive over the v1 obligation union; new obligation types added in
 * Phase 7 each implement their own verifier branch below.
 */
export function verifyObligation(
  obligation: ObligationV1,
  options: VerifyOptions,
): VerificationResult {
  switch (obligation.type) {
    case 'file-must-exist':
      return verifyFileExists(obligation.path, options.repoRoot);
    case 'build-must-pass':
    case 'test-must-pass':
      return verifyCommand(obligation.command, options);
    case 'function-must-have-signature':
      return verifyFunctionSignature(obligation, options.repoRoot);
    case 'property-must-hold':
      return verifyCommand(obligation.predicate, options, obligation.target);
    case 'import-graph-must-satisfy':
      return verifyImportGraph(obligation, options.repoRoot);
    case 'coverage-must-exceed':
      return verifyCoverage(obligation, options.repoRoot);
    case 'performance-must-not-regress':
      return verifyPerformance(obligation, options);
  }
}

function verifyFileExists(relPath: string, repoRoot: string): VerificationResult {
  const abs = path.isAbsolute(relPath) ? relPath : path.join(repoRoot, relPath);
  try {
    const stat = fs.statSync(abs);
    if (stat.isFile()) {
      return { satisfied: true, detail: `file exists at ${relPath}` };
    }
    return { satisfied: false, detail: `${relPath} exists but is not a regular file` };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return { satisfied: false, detail: `file ${relPath} does not exist under ${repoRoot}` };
    }
    return {
      satisfied: false,
      detail: `stat ${relPath} failed: ${(err as Error).message}`,
    };
  }
}

function verifyCommand(
  command: string,
  options: VerifyOptions,
  contextLabel?: string,
): VerificationResult {
  const timeout = options.commandTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  const result = spawnSync(command, {
    cwd: options.repoRoot,
    shell: VERIFICATION_SHELL,
    encoding: 'utf8',
    timeout,
    env: process.env,
  });

  const label = contextLabel ? `${contextLabel}: ` : '';

  if (result.error) {
    const errCode = (result.error as NodeJS.ErrnoException).code;
    if (errCode === 'ETIMEDOUT') {
      return {
        satisfied: false,
        detail: `${label}command "${command}" timed out after ${timeout}ms`,
      };
    }
    return {
      satisfied: false,
      detail: `${label}command "${command}" failed to start: ${result.error.message}`,
    };
  }

  if (result.status === 0) {
    return { satisfied: true, detail: `${label}command "${command}" exited 0` };
  }
  const tail = (result.stderr || result.stdout || '').slice(-512).trim();
  return {
    satisfied: false,
    detail:
      `${label}command "${command}" exited ${result.status ?? 'null'}` +
      (tail ? `; tail: ${tail}` : ''),
  };
}

/**
 * function-must-have-signature verifier. Reads the named file, parses it
 * with the per-language AST (TypeScript compiler API for .ts/.tsx/.js/.jsx/
 * .cjs/.mjs/.cts/.mts; Python `ast` module via python3 subprocess for
 * .py), collects every declared function/method/arrow-function with the
 * obligation's name, and compares each declaration's parameter list and
 * return type to the obligation's expected signature.
 *
 * Comparison is whitespace-insensitive — both sides are re-rendered
 * through the AST and stripped of whitespace before equality, so
 * formatter variation (`(req, res)` vs `( req , res )`) is irrelevant
 * but param types and return types are compared structurally rather
 * than as raw substrings. Overload sets and multiple same-name
 * declarations pass when at least one declaration matches.
 */
function verifyFunctionSignature(
  obligation: FunctionMustHaveSignatureObligation,
  repoRoot: string,
): VerificationResult {
  const abs = path.isAbsolute(obligation.file)
    ? obligation.file
    : path.join(repoRoot, obligation.file);
  let body: string;
  try {
    body = fs.readFileSync(abs, 'utf8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return {
        satisfied: false,
        detail: `file ${obligation.file} does not exist under ${repoRoot}`,
      };
    }
    return {
      satisfied: false,
      detail: `read ${obligation.file} failed: ${(err as Error).message}`,
    };
  }
  const check = checkFunctionSignature(abs, body, obligation.name, obligation.signature);
  if (check.error) {
    return {
      satisfied: false,
      detail:
        `signature check for ${obligation.name} in ${obligation.file} could not run: ${check.error}`,
    };
  }
  if (check.matched) {
    return {
      satisfied: true,
      detail: `signature for ${obligation.name} matches in ${obligation.file}`,
    };
  }
  if (!check.nameFound) {
    return {
      satisfied: false,
      detail:
        `${obligation.name} is not declared in ${obligation.file}; ` +
        `expected signature ${obligation.signature}`,
    };
  }
  const observed = check.observedNormalized.length > 0
    ? `observed ${check.observedNormalized.map((s) => `"${s}"`).join(', ')}`
    : 'no signature recovered';
  return {
    satisfied: false,
    detail:
      `signature for ${obligation.name} in ${obligation.file} does not match; ` +
      `expected "${check.expectedNormalized}", ${observed}`,
  };
}

/**
 * import-graph-must-satisfy verifier. Walks `.ts/.tsx/.js/.jsx/.mjs/.cjs/
 * .cts/.mts/.py` files under the obligation's scope, parses each file
 * with the per-language AST (TypeScript compiler API for JS/TS, Python
 * `ast` module via python3 subprocess for `.py`), and evaluates the
 * named structural constraint.
 *
 * Constraints:
 *   - `no-upward-imports`: any relative import containing `../` is a
 *     violation.
 *   - `no-cycles`: depth-first search over the local import graph; a
 *     back-edge into the active stack is a cycle. Imports that don't
 *     resolve to a tracked file (external packages, missing files) are
 *     ignored.
 *
 * Parser-error files (Python subprocess unavailable, syntax errors) are
 * surfaced in the obligation's failure detail so the caller can fix the
 * upstream cause rather than silently dropping unparseable files.
 */
function verifyImportGraph(
  obligation: ImportGraphMustSatisfyObligation,
  repoRoot: string,
): VerificationResult {
  const scopeAbs = path.isAbsolute(obligation.scope)
    ? obligation.scope
    : path.join(repoRoot, obligation.scope);
  if (!fs.existsSync(scopeAbs)) {
    return {
      satisfied: false,
      detail: `import-graph scope ${obligation.scope} does not exist under ${repoRoot}`,
    };
  }
  const stat = fs.statSync(scopeAbs);
  if (!stat.isDirectory()) {
    return {
      satisfied: false,
      detail: `import-graph scope ${obligation.scope} is not a directory`,
    };
  }

  const files = walkSourceFiles(scopeAbs);
  const violations: string[] = [];
  const parserErrors: string[] = [];
  const graph = new Map<string, string[]>();

  for (const abs of files) {
    const text = safeReadFile(abs);
    if (text === null) continue;
    const extraction = extractImportsAst(abs, text);
    if (extraction.error) {
      parserErrors.push(`${path.relative(repoRoot, abs)}: ${extraction.error}`);
    }
    const resolvedNeighbors: string[] = [];
    for (const spec of extraction.specs) {
      if (obligation.constraint === 'no-upward-imports' && spec.startsWith('..')) {
        violations.push(
          `${path.relative(repoRoot, abs)} imports "${spec}" (escapes its directory)`,
        );
      }
      const resolved = resolveLocalImport(abs, spec, files);
      if (resolved) resolvedNeighbors.push(resolved);
    }
    graph.set(abs, resolvedNeighbors);
  }

  if (parserErrors.length > 0) {
    return {
      satisfied: false,
      detail:
        `import-graph parser error(s) in ${parserErrors.length} file(s); ` +
        parserErrors.slice(0, 3).join('; '),
    };
  }

  if (obligation.constraint === 'no-upward-imports') {
    if (violations.length === 0) {
      return {
        satisfied: true,
        detail: `no upward imports in ${files.length} file(s) under ${obligation.scope}`,
      };
    }
    return {
      satisfied: false,
      detail:
        `import-graph violation (no-upward-imports): ${violations.length} offender(s); ` +
        violations.slice(0, 3).join('; '),
    };
  }

  // no-cycles
  const cycle = findCycle(graph);
  if (cycle === null) {
    return {
      satisfied: true,
      detail: `no import cycles across ${files.length} file(s) under ${obligation.scope}`,
    };
  }
  const rendered = cycle.map((p) => path.relative(repoRoot, p)).join(' -> ');
  return {
    satisfied: false,
    detail: `import-graph violation (no-cycles): ${rendered}`,
  };
}


const SOURCE_EXTS = new Set([
  '.ts',
  '.tsx',
  '.cts',
  '.mts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.py',
]);

function walkSourceFiles(root: string): string[] {
  const out: string[] = [];
  const stack: string[] = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    if (!dir) break;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      // Skip noisy directories that aren't part of the source graph.
      if (
        ent.isDirectory() &&
        (ent.name === 'node_modules' ||
          ent.name === '.git' ||
          ent.name === 'dist' ||
          ent.name === 'build' ||
          ent.name === '__pycache__' ||
          ent.name === '.venv')
      ) {
        continue;
      }
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        stack.push(abs);
      } else if (ent.isFile() && SOURCE_EXTS.has(path.extname(ent.name))) {
        out.push(abs);
      }
    }
  }
  return out.sort();
}

function safeReadFile(abs: string): string | null {
  try {
    return fs.readFileSync(abs, 'utf8');
  } catch {
    return null;
  }
}

function resolveLocalImport(
  fromAbs: string,
  spec: string,
  files: readonly string[],
): string | null {
  // Only resolve relative specs to local files; bare specifiers and
  // path aliases are out of scope.
  if (!spec.startsWith('.')) return null;
  const fromDir = path.dirname(fromAbs);
  const target = path.resolve(fromDir, spec);
  const candidates = [
    target,
    `${target}.ts`,
    `${target}.tsx`,
    `${target}.cts`,
    `${target}.mts`,
    `${target}.js`,
    `${target}.jsx`,
    `${target}.mjs`,
    `${target}.cjs`,
    `${target}.py`,
    path.join(target, 'index.ts'),
    path.join(target, 'index.tsx'),
    path.join(target, 'index.cts'),
    path.join(target, 'index.mts'),
    path.join(target, 'index.js'),
    path.join(target, '__init__.py'),
  ];
  const set = new Set(files);
  for (const c of candidates) {
    if (set.has(c)) return c;
  }
  return null;
}

function findCycle(graph: Map<string, string[]>): string[] | null {
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  const parent = new Map<string, string | null>();
  for (const k of graph.keys()) {
    color.set(k, WHITE);
    parent.set(k, null);
  }

  for (const start of graph.keys()) {
    if (color.get(start) !== WHITE) continue;
    const stack: Array<{ node: string; iter: Iterator<string> }> = [
      { node: start, iter: (graph.get(start) ?? []).values() },
    ];
    color.set(start, GRAY);
    while (stack.length > 0) {
      const top = stack[stack.length - 1];
      if (!top) break;
      const next = top.iter.next();
      if (next.done) {
        color.set(top.node, BLACK);
        stack.pop();
        continue;
      }
      const neighbor = next.value;
      const neighborColor = color.get(neighbor) ?? WHITE;
      if (neighborColor === GRAY) {
        // Back-edge — reconstruct cycle from `neighbor` up to top.node.
        const cycle: string[] = [neighbor];
        for (let i = stack.length - 1; i >= 0; i -= 1) {
          const frame = stack[i];
          if (!frame) break;
          cycle.unshift(frame.node);
          if (frame.node === neighbor) break;
        }
        // The unshift above duplicates `neighbor` at the front; trim.
        if (cycle.length > 1 && cycle[0] === cycle[cycle.length - 1]) {
          // Already closed loop; keep it.
        } else {
          cycle.push(neighbor);
        }
        return cycle;
      }
      if (neighborColor === WHITE) {
        color.set(neighbor, GRAY);
        parent.set(neighbor, top.node);
        stack.push({ node: neighbor, iter: (graph.get(neighbor) ?? []).values() });
      }
    }
  }
  return null;
}

/**
 * Phase 7: coverage-must-exceed verifier. Reads a JSON document shaped
 * like Istanbul/c8's `coverage-summary.json` (`total[metric].pct`) and
 * compares against the obligation threshold. Missing files / fields fail
 * the obligation with an actionable detail string.
 */
function verifyCoverage(
  obligation: CoverageMustExceedObligation,
  repoRoot: string,
): VerificationResult {
  const abs = path.isAbsolute(obligation.scope)
    ? obligation.scope
    : path.join(repoRoot, obligation.scope);
  let raw: string;
  try {
    raw = fs.readFileSync(abs, 'utf8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return {
        satisfied: false,
        detail: `coverage report ${obligation.scope} not found under ${repoRoot}`,
      };
    }
    return {
      satisfied: false,
      detail: `read ${obligation.scope} failed: ${(err as Error).message}`,
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return {
      satisfied: false,
      detail: `coverage report ${obligation.scope} is not valid JSON: ${(err as Error).message}`,
    };
  }
  const pct = readCoveragePct(parsed, obligation.metric);
  if (pct === null) {
    return {
      satisfied: false,
      detail: `coverage report ${obligation.scope} is missing total.${obligation.metric}.pct`,
    };
  }
  if (pct >= obligation.threshold) {
    return {
      satisfied: true,
      detail: `coverage ${obligation.metric}=${pct.toFixed(2)}% >= threshold ${obligation.threshold}%`,
    };
  }
  return {
    satisfied: false,
    detail: `coverage ${obligation.metric}=${pct.toFixed(2)}% < threshold ${obligation.threshold}%`,
  };
}

function readCoveragePct(doc: unknown, metric: string): number | null {
  if (typeof doc !== 'object' || doc === null) return null;
  const total = (doc as Record<string, unknown>)['total'];
  if (typeof total !== 'object' || total === null) return null;
  const slot = (total as Record<string, unknown>)[metric];
  if (typeof slot !== 'object' || slot === null) return null;
  const pct = (slot as Record<string, unknown>)['pct'];
  return typeof pct === 'number' && Number.isFinite(pct) ? pct : null;
}

/**
 * Phase 7: performance-must-not-regress verifier. Spawns the benchmark
 * command, takes the last numeric token of stdout as the current value,
 * compares to the baseline file's `value`, and fails the obligation
 * when current > baseline * (1 + threshold). Lower-is-better convention
 * matches typical wall-time / latency benchmarks.
 */
function verifyPerformance(
  obligation: PerformanceMustNotRegressObligation,
  options: VerifyOptions,
): VerificationResult {
  const timeout = options.commandTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  const baselineAbs = path.isAbsolute(obligation.baseline)
    ? obligation.baseline
    : path.join(options.repoRoot, obligation.baseline);
  let baselineRaw: string;
  try {
    baselineRaw = fs.readFileSync(baselineAbs, 'utf8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return {
        satisfied: false,
        detail: `baseline file ${obligation.baseline} not found under ${options.repoRoot}`,
      };
    }
    return {
      satisfied: false,
      detail: `read ${obligation.baseline} failed: ${(err as Error).message}`,
    };
  }
  let baselineDoc: unknown;
  try {
    baselineDoc = JSON.parse(baselineRaw);
  } catch (err) {
    return {
      satisfied: false,
      detail: `baseline file ${obligation.baseline} is not valid JSON: ${(err as Error).message}`,
    };
  }
  const baselineValue = readBaselineValue(baselineDoc);
  if (baselineValue === null) {
    return {
      satisfied: false,
      detail: `baseline file ${obligation.baseline} is missing numeric "value"`,
    };
  }

  const result = spawnSync(obligation.benchmark, {
    cwd: options.repoRoot,
    shell: VERIFICATION_SHELL,
    encoding: 'utf8',
    timeout,
    env: process.env,
  });
  if (result.error) {
    const errCode = (result.error as NodeJS.ErrnoException).code;
    if (errCode === 'ETIMEDOUT') {
      return {
        satisfied: false,
        detail: `benchmark "${obligation.benchmark}" timed out after ${timeout}ms`,
      };
    }
    return {
      satisfied: false,
      detail: `benchmark "${obligation.benchmark}" failed to start: ${result.error.message}`,
    };
  }
  if (result.status !== 0) {
    const tail = (result.stderr || result.stdout || '').slice(-512).trim();
    return {
      satisfied: false,
      detail:
        `benchmark "${obligation.benchmark}" exited ${result.status ?? 'null'}` +
        (tail ? `; tail: ${tail}` : ''),
    };
  }
  const stdout = (result.stdout ?? '').toString();
  const current = lastNumericToken(stdout);
  if (current === null) {
    return {
      satisfied: false,
      detail: `benchmark "${obligation.benchmark}" emitted no numeric output`,
    };
  }
  const ceiling = baselineValue * (1 + obligation.threshold);
  if (current <= ceiling) {
    return {
      satisfied: true,
      detail:
        `benchmark current=${current.toFixed(4)} <= baseline*(1+threshold)=${ceiling.toFixed(4)} ` +
        `(baseline=${baselineValue.toFixed(4)}, threshold=${(obligation.threshold * 100).toFixed(1)}%)`,
    };
  }
  return {
    satisfied: false,
    detail:
      `benchmark current=${current.toFixed(4)} > baseline*(1+threshold)=${ceiling.toFixed(4)} ` +
      `(baseline=${baselineValue.toFixed(4)}, regression=${(((current - baselineValue) / baselineValue) * 100).toFixed(2)}%)`,
  };
}

function readBaselineValue(doc: unknown): number | null {
  if (typeof doc !== 'object' || doc === null) return null;
  const value = (doc as Record<string, unknown>)['value'];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function lastNumericToken(stdout: string): number | null {
  // Match the last decimal number in the output (with optional sign and exponent).
  const matches = stdout.match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g);
  if (!matches || matches.length === 0) return null;
  const tail = matches[matches.length - 1];
  if (!tail) return null;
  const n = Number(tail);
  return Number.isFinite(n) ? n : null;
}
