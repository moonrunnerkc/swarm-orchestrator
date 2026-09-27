import type { Mutant, MutantOperator } from "./oracle-mutants.ts";

/**
 * Mechanical mutations of one Python line, for the challenge layer. The same five operators
 * the JavaScript set leads with, read off Python's statement forms, in the same
 * equivalence-risk order, so a requirement check over a Python change can be asked the same
 * question a JavaScript one is: does it reject a change to the lines the patch added.
 *
 * One operator fires per line, the first in order that applies. Literals and the comment are
 * masked before an operator looks, so a comparison inside a string is not inverted. Every
 * mutant is checked to parse before it is run, since Python's grammar is whitespace-sensitive
 * and a rewrite that does not parse is refused by every check for a reason that is not about
 * the requirement.
 */
const pythonOperators: readonly MutantOperator[] = [
  "invert-comparison",
  "negate-condition",
  "swap-arithmetic-operands",
  "return-sentinel",
  "replace-assigned-value",
];

/** Test files and non-Python files get no mutants: a check's own file is not the change. */
export function pythonPathSetAside(path: string): boolean {
  if (!path.endsWith(".py")) return true;
  const name = path.split("/").at(-1) ?? path;
  return (
    /^test_.*\.py$/.test(name) ||
    /_test\.py$/.test(name) ||
    name === "conftest.py" ||
    /(^|\/)(tests?|testing)\//.test(path)
  );
}

/** Mask string literals and the trailing comment with spaces, keeping every column. */
function masked(text: string): string {
  let out = "";
  let quote: string | null = null;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] as string;
    if (quote !== null) {
      out += " ";
      if (char === "\\") {
        out += " ";
        index += 1;
      } else if (text.startsWith(quote, index)) {
        index += quote.length - 1;
        quote = null;
      }
      continue;
    }
    if (char === "#") {
      out += " ".repeat(text.length - index);
      break;
    }
    if (text.startsWith('"""', index) || text.startsWith("'''", index)) {
      quote = text.slice(index, index + 3);
      out += "   ";
      index += 2;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      out += " ";
      continue;
    }
    out += char;
  }
  return out;
}

const comparisons: readonly (readonly [string, string])[] = [
  ["==", "!="],
  ["!=", "=="],
  ["<=", ">"],
  [">=", "<"],
  ["<", ">="],
  [">", "<="],
];

function invertComparison(text: string, mask: string): string | null {
  // Longest operators first, and never inside `=`, `->` or `**`.
  for (const [from, to] of comparisons) {
    let at = -1;
    for (let index = 0; index < mask.length; index += 1) {
      if (!mask.startsWith(from, index)) continue;
      const before = mask[index - 1] ?? "";
      const after = mask[index + from.length] ?? "";
      if (
        from.length === 1 &&
        (before === "=" ||
          after === "=" ||
          before === "-" ||
          before === "<" ||
          before === ">" ||
          after === "<" ||
          after === ">")
      )
        continue;
      if (from === "==" && (before === "=" || after === "=")) continue;
      at = index;
      break;
    }
    if (at !== -1) return `${text.slice(0, at)}${to}${text.slice(at + from.length)}`;
  }
  return null;
}

function negateCondition(text: string, mask: string): string | null {
  const head = /^(\s*)(if|elif|while)\s+(.+?)\s*:\s*$/.exec(mask);
  if (head === null) return null;
  const indent = head[1] as string;
  const keyword = head[2] as string;
  const start = indent.length + keyword.length + 1;
  const end = text.lastIndexOf(":");
  const condition = text.slice(start, end).trim();
  if (condition.length === 0) return null;
  return `${indent}${keyword} not (${condition}):`;
}

function swapArithmeticOperands(text: string, mask: string): string | null {
  const found = /^(\s*)(.*?)\s([-/%])\s(.*?)\s*$/.exec(mask);
  if (found === null) return null;
  const [, indent, left, operator, right] = found;
  if (left === undefined || right === undefined || operator === undefined) return null;
  if (
    /^(return|yield|assert|if|elif|while|else|for|with|def|class|import|from|raise|del|global|nonlocal|pass|break|continue|lambda)\b/.test(
      left.trim(),
    )
  )
    return null;
  // Only a plain `a - b` where both sides are single terms; anything else is not read.
  if (
    !/^[A-Za-z_][\w.]*(\([^()]*\))?$/.test(left.trim()) ||
    !/^[A-Za-z_][\w.]*(\([^()]*\))?$/.test(right.trim())
  )
    return null;
  const leftText = text.slice(indent?.length ?? 0, (indent?.length ?? 0) + left.length);
  const rightText = text.slice(text.length - right.length - (mask.length - mask.trimEnd().length));
  return `${indent ?? ""}${rightText.trim()} ${operator} ${leftText.trim()}`;
}

function returnSentinel(text: string, mask: string): string | null {
  const found = /^(\s*)return\s+(.+?)\s*$/.exec(mask);
  if (found === null) return null;
  const value = text.slice((found[1] as string).length + "return ".length).trim();
  if (value === "None") return null;
  return `${found[1] as string}return None`;
}

function replaceAssignedValue(text: string, mask: string): string | null {
  const found = /^(\s*)([A-Za-z_][\w.]*)\s*=\s*(?!=)(.+?)\s*$/.exec(mask);
  if (found === null) return null;
  const value = text.slice(text.indexOf("=") + 1).trim();
  if (value === "None" || /^(if|elif|while|for|with|def|class|lambda)\b/.test(found[2] as string))
    return null;
  return `${found[1] as string}${found[2] as string} = None`;
}

const mutateBy: Readonly<Record<string, (text: string, mask: string) => string | null>> = {
  "invert-comparison": invertComparison,
  "negate-condition": negateCondition,
  "swap-arithmetic-operands": swapArithmeticOperands,
  "return-sentinel": returnSentinel,
  "replace-assigned-value": replaceAssignedValue,
};

/** One mutant of a Python line, by the first operator that applies, or null. */
export function pythonMutantOfLine(path: string, line: number, text: string): Mutant | null {
  if (text.trim().length === 0) return null;
  const mask = masked(text);
  for (const operator of pythonOperators) {
    const after = mutateBy[operator]?.(text, mask) ?? null;
    if (after !== null && after !== text) {
      return { id: `${path}:${line}:${operator}`, path, line, operator, before: text, after };
    }
  }
  return null;
}

/** The order the Python set ranks operators in, which the shared selection reads. */
export function pythonOperatorRank(operator: MutantOperator): number {
  const rank = pythonOperators.indexOf(operator);
  return rank === -1 ? pythonOperators.length : rank;
}
