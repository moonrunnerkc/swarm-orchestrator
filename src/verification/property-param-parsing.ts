import { splitTopLevelArgs, type PropertyParameter } from './property-strategies';

/**
 * Lightweight parameter-list parsers for the property gate. Lives in its
 * own file so property-strategies.ts can stay below the 300-line soft
 * limit; the two responsibilities (string→parameter records and
 * type→strategy mapping) are independent and tested separately.
 */

function findTopLevelColon(piece: string): number {
  let depth = 0;
  for (let i = 0; i < piece.length; i += 1) {
    const ch = piece[i];
    if (ch === '[' || ch === '(' || ch === '<' || ch === '{') depth += 1;
    else if (ch === ']' || ch === ')' || ch === '>' || ch === '}') depth -= 1;
    else if (ch === ':' && depth === 0) return i;
  }
  return -1;
}

function findTopLevelEquals(piece: string): number {
  let depth = 0;
  for (let i = 0; i < piece.length; i += 1) {
    const ch = piece[i];
    if (ch === '[' || ch === '(' || ch === '<' || ch === '{') depth += 1;
    else if (ch === ']' || ch === ')' || ch === '>' || ch === '}') depth -= 1;
    else if (ch === '=' && depth === 0) {
      // Skip TypeScript fat-arrow `=>` inside types: `(x: number) => string`.
      if (piece[i + 1] === '>') continue;
      return i;
    }
  }
  return -1;
}

/**
 * Strip a Python parameter's default-value suffix. `a: int = 0` becomes
 * `int`; `a: list[str] = []` becomes `list[str]`. Default values are not
 * meaningful for strategy selection.
 */
function stripPythonDefault(raw: string): string {
  const out: string[] = [];
  let depth = 0;
  for (const ch of raw) {
    if (ch === '[' || ch === '(' || ch === '<' || ch === '{') depth += 1;
    else if (ch === ']' || ch === ')' || ch === '>' || ch === '}') depth -= 1;
    else if (ch === '=' && depth === 0) break;
    out.push(ch);
  }
  return out.join('').trim();
}

/**
 * Parse a Python parameter list (the contents of `def f(...)`).
 * Returns one entry per parameter in source order. Skips `self`, `cls`,
 * `*args`, `**kwargs`, and the bare `*` / `/` separators because the
 * gate only generates positional arguments.
 *
 * Each entry's `rawType` is the type-hint exactly as it appeared, with
 * any default-value suffix stripped. When the parameter has no
 * annotation, `rawType` is the empty string and `strategy` is undefined;
 * the property gate treats any such target as unsupported (no type ⇒ no
 * principled generator).
 *
 * @param params - Contents between `(` and `)` in the function signature.
 * @returns Parameter records (no strategy resolution; that runs separately).
 */
export function parsePythonParams(params: string): PropertyParameter[] {
  const out: PropertyParameter[] = [];
  for (const piece of splitTopLevelArgs(params)) {
    if (piece === '*' || piece === '/') continue;
    if (piece.startsWith('*')) continue; // *args / **kwargs
    const colonIdx = findTopLevelColon(piece);
    if (colonIdx === -1) {
      const name = piece.trim();
      if (name === 'self' || name === 'cls') continue;
      out.push({ name, rawType: '' });
      continue;
    }
    const name = piece.slice(0, colonIdx).trim();
    if (name === 'self' || name === 'cls') continue;
    const rawType = stripPythonDefault(piece.slice(colonIdx + 1));
    out.push({ name, rawType });
  }
  return out;
}

/**
 * Parse a TypeScript parameter list (the contents of `(...)`).
 * Skips a leading `this` parameter (TypeScript's typed-this convention)
 * and rest parameters (`...args`). Strips default-value and optional-
 * modifier (`?`) suffixes. Matches the conventions of plain TS function
 * and arrow-function declarations.
 *
 * @param params - Contents between `(` and `)` in the function signature.
 * @returns Parameter records with raw type expressions.
 */
export function parseTSParams(params: string): PropertyParameter[] {
  const out: PropertyParameter[] = [];
  for (const piece of splitTopLevelArgs(params)) {
    if (piece.startsWith('...')) continue; // rest params
    const colonIdx = findTopLevelColon(piece);
    if (colonIdx === -1) {
      const name = piece.split('=')[0]?.trim() ?? '';
      if (name === '' || name === 'this') continue;
      out.push({ name, rawType: '' });
      continue;
    }
    const lhs = piece.slice(0, colonIdx).trim();
    if (lhs === 'this') continue;
    const name = lhs.replace(/\?$/, '').trim();
    const rhs = piece.slice(colonIdx + 1).trim();
    const defaultIdx = findTopLevelEquals(rhs);
    const rawType = (defaultIdx === -1 ? rhs : rhs.slice(0, defaultIdx).trim()).replace(/\s+/g, ' ');
    out.push({ name, rawType });
  }
  return out;
}
