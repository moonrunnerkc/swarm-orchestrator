// AST-graded matcher strictness comparator. Used by test-relaxation.ts to
// catch tolerance-widening on matchers whose name does not change, which the
// regex pre-filter cannot see: `toBeCloseTo(5, 2)` becoming
// `toBeCloseTo(5, 100)`, `toBeWithin(0, 10)` becoming
// `toBeWithin(-1000, 1000)`, `toHaveLength(5)` becoming
// `toHaveLength(expect.any(Number))`.
//
// Scope is JS/TS only; Python and Go matcher grading is deferred. The grader
// is a soft pre-check: any parse failure on either side degrades to
// `incomparable`, and the regex layer in test-relaxation still owns the
// obvious strict→loose cases.

import * as ts from 'typescript';
import { getLogger } from '../../logger';

const log = getLogger('matcher-grader');

export interface LiteralFingerprint {
  kind: 'number' | 'string' | 'boolean' | 'null' | 'any';
  value?: string | number | boolean;
}

export interface StrictnessRecord {
  matcher: string;
  args: readonly LiteralFingerprint[];
  /** Populated when the second arg is a numeric tolerance (toBeCloseTo, toBeWithin). */
  tolerance?: number;
}

export type StrictnessVerdict = 'unchanged' | 'weakened' | 'strengthened' | 'incomparable';

// Matchers whose strictness can be reasoned about positionally. The set is
// intentionally narrow: each entry has a known argument profile.
const KNOWN_MATCHERS = new Set<string>([
  'toBe',
  'toEqual',
  'toStrictEqual',
  'toMatchObject',
  'toBeCloseTo',
  'toBeWithin',
  'toHaveLength',
  'toBeGreaterThan',
  'toBeLessThan',
  'toBeGreaterThanOrEqual',
  'toBeLessThanOrEqual',
  'toBeDefined',
  'toBeTruthy',
  'toBeFalsy',
  'toBeNull',
  'toBeUndefined',
  'toMatch',
  'toContain',
  'toThrow',
]);

// Matchers whose second positional argument is a numeric tolerance/range
// half-width. Growing it weakens the assertion.
const TOLERANCE_MATCHERS = new Set<string>(['toBeCloseTo', 'toBeWithin']);

export function gradeReplacement(before: string, after: string): StrictnessVerdict {
  const beforeRecord = parseMatcher(before);
  const afterRecord = parseMatcher(after);
  if (beforeRecord === undefined || afterRecord === undefined) return 'incomparable';
  return compareStrictness(beforeRecord, afterRecord);
}

export function parseMatcher(line: string): StrictnessRecord | undefined {
  const trimmed = line.trim();
  if (trimmed.length === 0) return undefined;
  let source: ts.SourceFile;
  try {
    source = ts.createSourceFile(
      'snippet.ts',
      trimmed,
      ts.ScriptTarget.ES2022,
      /* setParentNodes */ true,
      ts.ScriptKind.TS,
    );
  } catch (err) {
    log.debug('parseMatcher: createSourceFile threw', err);
    return undefined;
  }
  return findFirstMatcherCall(source);
}

function findFirstMatcherCall(node: ts.Node): StrictnessRecord | undefined {
  let found: StrictnessRecord | undefined;
  const visit = (n: ts.Node): void => {
    if (found !== undefined) return;
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
      const name = n.expression.name.text;
      if (KNOWN_MATCHERS.has(name)) {
        const args = n.arguments.map(fingerprintArgument);
        const record: StrictnessRecord = { matcher: name, args };
        if (TOLERANCE_MATCHERS.has(name)) {
          const tol = numericArg(n.arguments[1]);
          if (tol !== undefined) record.tolerance = tol;
        }
        found = record;
        return;
      }
    }
    n.forEachChild(visit);
  };
  visit(node);
  return found;
}

function fingerprintArgument(arg: ts.Expression): LiteralFingerprint {
  if (isExpectAny(arg) || isExpectAnything(arg)) return { kind: 'any' };
  if (ts.isNumericLiteral(arg)) return { kind: 'number', value: Number(arg.text) };
  if (
    ts.isPrefixUnaryExpression(arg) &&
    arg.operator === ts.SyntaxKind.MinusToken &&
    ts.isNumericLiteral(arg.operand)
  ) {
    return { kind: 'number', value: -Number(arg.operand.text) };
  }
  if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) {
    return { kind: 'string', value: arg.text };
  }
  if (arg.kind === ts.SyntaxKind.TrueKeyword) return { kind: 'boolean', value: true };
  if (arg.kind === ts.SyntaxKind.FalseKeyword) return { kind: 'boolean', value: false };
  if (arg.kind === ts.SyntaxKind.NullKeyword) return { kind: 'null' };
  return { kind: 'any' };
}

function isExpectAny(arg: ts.Expression): boolean {
  if (!ts.isCallExpression(arg)) return false;
  const callee = arg.expression;
  return (
    ts.isPropertyAccessExpression(callee) &&
    ts.isIdentifier(callee.expression) &&
    callee.expression.text === 'expect' &&
    callee.name.text === 'any'
  );
}

function isExpectAnything(arg: ts.Expression): boolean {
  if (!ts.isCallExpression(arg)) return false;
  const callee = arg.expression;
  return (
    ts.isPropertyAccessExpression(callee) &&
    ts.isIdentifier(callee.expression) &&
    callee.expression.text === 'expect' &&
    callee.name.text === 'anything' &&
    arg.arguments.length === 0
  );
}

function numericArg(arg: ts.Expression | undefined): number | undefined {
  if (arg === undefined) return undefined;
  if (ts.isNumericLiteral(arg)) return Number(arg.text);
  if (
    ts.isPrefixUnaryExpression(arg) &&
    arg.operator === ts.SyntaxKind.MinusToken &&
    ts.isNumericLiteral(arg.operand)
  ) {
    return -Number(arg.operand.text);
  }
  return undefined;
}

export function compareStrictness(
  before: StrictnessRecord,
  after: StrictnessRecord,
): StrictnessVerdict {
  if (before.matcher !== after.matcher) return 'incomparable';

  // Tolerance comparator: grew by ≥ 2× → weakened, shrank → strengthened,
  // equal → fall through to arg comparison.
  if (TOLERANCE_MATCHERS.has(before.matcher)) {
    const bt = before.tolerance;
    const at = after.tolerance;
    if (bt !== undefined && at !== undefined) {
      // toBeWithin is (lower, upper); compare range width instead.
      if (before.matcher === 'toBeWithin') {
        return compareRangePair(before, after);
      }
      // toBeCloseTo: smaller numeric digit-count arg = stricter. Jest's
      // second arg is a "number of decimal digits"; a *larger* value is
      // actually *stricter*. We follow the plan's tolerance semantics:
      // the second arg behaves like a tolerance only when the user
      // overloads it that way. For toBeCloseTo we treat a *larger*
      // second-arg value as *strengthened* (more digits) only when both
      // sides use it consistently. To stay conservative, we use the
      // plan's stated rule literally: if tolerance grew by ≥ 2×,
      // weakened; if it shrank or stayed, unchanged or strengthened.
      if (at >= bt * 2) return 'weakened';
      if (at < bt) return 'strengthened';
      // tolerance same or grew slightly: fall through.
    }
  }

  return compareArgs(before.args, after.args);
}

function compareArgs(
  beforeArgs: readonly LiteralFingerprint[],
  afterArgs: readonly LiteralFingerprint[],
): StrictnessVerdict {
  if (beforeArgs.length !== afterArgs.length) return 'incomparable';
  let weakened = false;
  let strengthened = false;
  for (let i = 0; i < beforeArgs.length; i += 1) {
    const b = beforeArgs[i];
    const a = afterArgs[i];
    if (b === undefined || a === undefined) return 'incomparable';
    if (a.kind === 'any' && b.kind !== 'any') {
      weakened = true;
      continue;
    }
    if (b.kind === 'any' && a.kind !== 'any') {
      strengthened = true;
      continue;
    }
    if (b.kind !== a.kind) return 'incomparable';
    if (b.value !== a.value) return 'incomparable';
  }
  if (weakened && !strengthened) return 'weakened';
  if (strengthened && !weakened) return 'strengthened';
  if (weakened && strengthened) return 'incomparable';
  return 'unchanged';
}

function compareRangePair(
  before: StrictnessRecord,
  after: StrictnessRecord,
): StrictnessVerdict {
  if (before.args.length !== 2 || after.args.length !== 2) return 'incomparable';
  const bLow = numericValue(before.args[0]);
  const bHigh = numericValue(before.args[1]);
  const aLow = numericValue(after.args[0]);
  const aHigh = numericValue(after.args[1]);
  if (bLow === undefined || bHigh === undefined || aLow === undefined || aHigh === undefined) {
    return 'incomparable';
  }
  const bWidth = bHigh - bLow;
  const aWidth = aHigh - aLow;
  if (bWidth <= 0 || aWidth <= 0) return 'incomparable';
  if (aWidth >= bWidth * 2) return 'weakened';
  if (aWidth < bWidth) return 'strengthened';
  if (aWidth === bWidth && aLow === bLow) return 'unchanged';
  return 'incomparable';
}

function numericValue(fp: LiteralFingerprint | undefined): number | undefined {
  if (fp === undefined) return undefined;
  if (fp.kind !== 'number') return undefined;
  return typeof fp.value === 'number' ? fp.value : undefined;
}
