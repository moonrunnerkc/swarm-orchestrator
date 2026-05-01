/**
 * Generator selection for the property gate.
 *
 * Maps a Python type-hint or TypeScript type expression to a Hypothesis
 * strategy or fast-check arbitrary respectively, so the harness builders
 * in property-gate.ts can emit `@given(...)` and `fc.property(...)` with
 * one generator per parameter — matching the function's actual arity and
 * parameter shape — instead of the previous hardcoded
 * `@given(st.integers(), st.integers())` / `fc.property(fc.anything(),
 * fc.anything(), ...)` which crashed on every arity ≠ 2 or non-int target.
 *
 * The mapping is intentionally conservative: any type the mapper does not
 * recognize returns undefined, and the property gate skips that function
 * with a clear advisory note rather than feeding it junk data.
 */

/** One parameter of a discovered function plus its derived strategy. */
export interface PropertyParameter {
  /** Source-order parameter name. */
  name: string;
  /** Raw type expression as it appeared in the signature, or '' when untyped. */
  rawType: string;
  /**
   * Generator expression the harness will pass to `@given` (Python) or
   * `fc.property` (TypeScript). Undefined when the type was unrecognized;
   * the discoverer marks the whole target unsupported in that case.
   */
  strategy?: string;
}

const PYTHON_DIRECT_TYPES: ReadonlyMap<string, string> = new Map([
  ['int', 'st.integers()'],
  ['str', 'st.text()'],
  ['float', 'st.floats(allow_nan=False, allow_infinity=False)'],
  ['bool', 'st.booleans()'],
  ['bytes', 'st.binary()'],
  ['none', 'st.none()'],
  ['nonetype', 'st.none()'],
]);

const TS_DIRECT_TYPES: ReadonlyMap<string, string> = new Map([
  ['number', 'fc.integer()'],
  ['string', 'fc.string()'],
  ['boolean', 'fc.boolean()'],
  ['bigint', 'fc.bigInt()'],
  ['null', 'fc.constant(null)'],
  ['undefined', 'fc.constant(undefined)'],
  ['void', 'fc.constant(undefined)'],
]);

/**
 * Split a comma-separated argument list while respecting `[`, `(`, `<`,
 * and `{` nesting depth. Used both to split a function's parameter list
 * and to split inner type arguments inside a generic like
 * `Union[int, list[str]]`. A naive `.split(',')` would mangle the inner
 * `list[str]` into two pieces.
 *
 * @param input - Argument list contents (without the enclosing brackets).
 * @returns Trimmed top-level pieces in source order. Empty input → [].
 */
export function splitTopLevelArgs(input: string): string[] {
  const trimmed = input.trim();
  if (trimmed === '') return [];
  const out: string[] = [];
  let depth = 0;
  let buf = '';
  for (const ch of trimmed) {
    if (ch === '[' || ch === '(' || ch === '<' || ch === '{') depth += 1;
    else if (ch === ']' || ch === ')' || ch === '>' || ch === '}') depth -= 1;
    else if (ch === ',' && depth === 0) {
      out.push(buf.trim());
      buf = '';
      continue;
    }
    buf += ch;
  }
  if (buf.trim() !== '') out.push(buf.trim());
  return out;
}

/**
 * Map a Python type expression to a Hypothesis strategy expression.
 * Returns undefined for unrecognized types so the caller can skip the
 * function with an actionable advisory rather than emit a `st.integers()`
 * fallback that would silently misrepresent the function's contract.
 *
 * Supported shapes (case-insensitive on the outer constructor name):
 * - `int`, `str`, `float`, `bool`, `bytes`, `None` / `NoneType`
 * - `list[T]`, `List[T]`, `tuple[T, ...]`, `Tuple[T, ...]`,
 *   `set[T]`, `Set[T]`, `frozenset[T]`, `FrozenSet[T]`
 * - `dict[K, V]`, `Dict[K, V]`
 * - `Optional[T]`
 * - `Union[A, B, ...]`, including PEP 604 `A | B` syntax
 *
 * @param rawType - The trimmed type expression from the source.
 * @returns Strategy expression, or undefined when the type is not mappable.
 */
export function pythonTypeToStrategy(rawType: string): string | undefined {
  const t = rawType.trim();
  if (t === '') return undefined;

  // PEP 604 union syntax: `int | str | None`. Split before checking the
  // direct map so `int | None` does not match the direct `int` entry.
  if (containsTopLevel(t, '|')) {
    const parts = splitTopLevel(t, '|');
    const strategies = parts.map((p) => pythonTypeToStrategy(p));
    if (strategies.some((s) => s === undefined)) return undefined;
    return `st.one_of(${strategies.join(', ')})`;
  }

  const direct = PYTHON_DIRECT_TYPES.get(t.toLowerCase());
  if (direct) return direct;

  const generic = parseGeneric(t);
  if (!generic) return undefined;
  const outer = generic.outer.toLowerCase();
  const innerArgs = splitTopLevelArgs(generic.inner);

  if (outer === 'list' || outer === 'set' || outer === 'frozenset') {
    if (innerArgs.length !== 1) return undefined;
    const inner = pythonTypeToStrategy(innerArgs[0]!);
    if (!inner) return undefined;
    if (outer === 'list') return `st.lists(${inner})`;
    if (outer === 'set') return `st.sets(${inner})`;
    return `st.frozensets(${inner})`;
  }
  if (outer === 'tuple') {
    // tuple[T, ...] and tuple[T1, T2, T3] both map to lists; Hypothesis'
    // tuples() requires positional strategies and we keep the contract
    // wide. The trailing `...` Python sugar is treated as "homogenous".
    if (innerArgs.length === 2 && innerArgs[1] === '...') {
      const inner = pythonTypeToStrategy(innerArgs[0]!);
      return inner ? `st.lists(${inner})` : undefined;
    }
    const inner = innerArgs.map(pythonTypeToStrategy);
    if (inner.some((s) => s === undefined)) return undefined;
    return `st.tuples(${inner.join(', ')})`;
  }
  if (outer === 'dict') {
    if (innerArgs.length !== 2) return undefined;
    const k = pythonTypeToStrategy(innerArgs[0]!);
    const v = pythonTypeToStrategy(innerArgs[1]!);
    if (!k || !v) return undefined;
    return `st.dictionaries(${k}, ${v})`;
  }
  if (outer === 'optional') {
    if (innerArgs.length !== 1) return undefined;
    const inner = pythonTypeToStrategy(innerArgs[0]!);
    return inner ? `st.one_of(st.none(), ${inner})` : undefined;
  }
  if (outer === 'union') {
    const inner = innerArgs.map(pythonTypeToStrategy);
    if (inner.some((s) => s === undefined)) return undefined;
    return `st.one_of(${inner.join(', ')})`;
  }
  return undefined;
}

/**
 * Map a TypeScript type expression to a fast-check arbitrary expression.
 * Same conservative philosophy as the Python mapper: unknown types
 * return undefined and the caller skips with a clear advisory.
 *
 * Supported shapes:
 * - `number`, `string`, `boolean`, `bigint`, `null`, `undefined`, `void`
 * - `T[]`, `Array<T>`, `ReadonlyArray<T>`
 * - `Record<string, V>`, `Record<number, V>`
 * - `T | undefined`, `T | null`, broader unions A | B | C
 *
 * @param rawType - The trimmed type expression from the source.
 * @returns Arbitrary expression, or undefined when not mappable.
 */
export function tsTypeToArbitrary(rawType: string): string | undefined {
  const t = rawType.trim();
  if (t === '') return undefined;

  if (containsTopLevel(t, '|')) {
    const parts = splitTopLevel(t, '|');
    const arbs = parts.map((p) => tsTypeToArbitrary(p));
    if (arbs.some((a) => a === undefined)) return undefined;
    return `fc.oneof(${arbs.join(', ')})`;
  }

  const direct = TS_DIRECT_TYPES.get(t);
  if (direct) return direct;

  // `T[]` array shorthand. Must come before generic parsing because the
  // brackets are postfix, not parameterizing.
  if (t.endsWith('[]')) {
    const inner = tsTypeToArbitrary(t.slice(0, -2).trim());
    return inner ? `fc.array(${inner})` : undefined;
  }

  const generic = parseGeneric(t);
  if (!generic) return undefined;
  const outer = generic.outer;
  const innerArgs = splitTopLevelArgs(generic.inner);

  if (outer === 'Array' || outer === 'ReadonlyArray') {
    if (innerArgs.length !== 1) return undefined;
    const inner = tsTypeToArbitrary(innerArgs[0]!);
    return inner ? `fc.array(${inner})` : undefined;
  }
  if (outer === 'Record') {
    // Record<K, V> requires K to be string|number|symbol. fast-check's
    // dictionary uses string keys; we accept Record<string, V> and
    // Record<number, V> (the latter coerces to string in JS at runtime).
    if (innerArgs.length !== 2) return undefined;
    if (innerArgs[0] !== 'string' && innerArgs[0] !== 'number') return undefined;
    const v = tsTypeToArbitrary(innerArgs[1]!);
    return v ? `fc.dictionary(fc.string(), ${v})` : undefined;
  }
  if (outer === 'Set') {
    if (innerArgs.length !== 1) return undefined;
    const inner = tsTypeToArbitrary(innerArgs[0]!);
    return inner ? `fc.uniqueArray(${inner})` : undefined;
  }
  if (outer === 'Map') {
    if (innerArgs.length !== 2) return undefined;
    const k = tsTypeToArbitrary(innerArgs[0]!);
    const v = tsTypeToArbitrary(innerArgs[1]!);
    if (!k || !v) return undefined;
    return `fc.array(fc.tuple(${k}, ${v}))`;
  }
  return undefined;
}

interface GenericParts { outer: string; inner: string }

function parseGeneric(t: string): GenericParts | undefined {
  const open = t.indexOf('[');
  if (open !== -1 && t.endsWith(']')) {
    return { outer: t.slice(0, open).trim(), inner: t.slice(open + 1, -1) };
  }
  const angle = t.indexOf('<');
  if (angle !== -1 && t.endsWith('>')) {
    return { outer: t.slice(0, angle).trim(), inner: t.slice(angle + 1, -1) };
  }
  return undefined;
}

function containsTopLevel(input: string, ch: string): boolean {
  let depth = 0;
  for (const c of input) {
    if (c === '[' || c === '(' || c === '<' || c === '{') depth += 1;
    else if (c === ']' || c === ')' || c === '>' || c === '}') depth -= 1;
    else if (c === ch && depth === 0) return true;
  }
  return false;
}

function splitTopLevel(input: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let buf = '';
  for (const ch of input) {
    if (ch === '[' || ch === '(' || ch === '<' || ch === '{') depth += 1;
    else if (ch === ']' || ch === ')' || ch === '>' || ch === '}') depth -= 1;
    else if (ch === sep && depth === 0) {
      out.push(buf.trim());
      buf = '';
      continue;
    }
    buf += ch;
  }
  if (buf.trim() !== '') out.push(buf.trim());
  return out;
}
