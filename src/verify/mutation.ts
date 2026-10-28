import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { DeclaredCheck } from "../config/swarm-toml.ts";
import type { ChangedFile } from "./checkout.ts";
import { type CheckContext, runChecks } from "./checks.ts";
import type { Coverage, Mutation } from "./predicate.ts";

type Replacement = string | ((matched: string, python: boolean) => string);

/** Operators in the order they are tried; the first that applies to a line is used. */
const operators: readonly (readonly [string, RegExp, Replacement])[] = [
  ["=== to !==", /===/, "!=="],
  ["!== to ===", /!==/, "==="],
  ["== to !=", /(?<![=!<>])==(?!=)/, "!="],
  ["!= to ==", /!=(?!=)/, "=="],
  ["<= to >", /<=/, ">"],
  [">= to <", />=/, "<"],
  ["&& to ||", /&&/, "||"],
  ["|| to &&", /\|\|/, "&&"],
  [" and to or", /\band\b/, "or"],
  [" or to and", /\bor\b/, "and"],
  ["true to false", /\btrue\b/, "false"],
  ["false to true", /\bfalse\b/, "true"],
  ["True to False", /\bTrue\b/, "False"],
  ["False to True", /\bFalse\b/, "True"],
  ["< to >=", /(?<![<=-])<(?![<=])/, ">="],
  ["> to <=", /(?<![>=-])>(?![>=])/, "<="],
  ["+ to -", /(?<![+])\+(?![+=])/, "-"],
  ["- to +", /(?<![-])-(?![-=>])/, "+"],
  ["min to max", /\bmin\b/, "max"],
  ["max to min", /\bmax\b/, "min"],
  ["number plus one", /(?<![\w.])\d+(?![\w.])/, (matched) => String(Number(matched) + 1)],
  // Last resort: the value a changed return produced is thrown away.
  [
    "return value dropped",
    /\breturn\s+\S.*$/,
    (_matched, python) => (python ? "return None" : "return undefined;"),
  ],
];

const code = /\.(?:[cm]?js|[cm]?ts|jsx|tsx|py)$/;

/** The line with string literals and trailing comments blanked, so operators in them are skipped. */
function codeOf(line: string): string {
  const blanked = line.replace(/(["'`])(?:\\.|(?!\1).)*\1/g, (literal) =>
    " ".repeat(literal.length),
  );
  const comment = /\/\/|#/.exec(blanked);
  return comment === null ? blanked : blanked.slice(0, comment.index);
}

export function mutateLine(
  line: string,
  python = false,
): { readonly text: string; readonly operator: string } | null {
  const visible = codeOf(line);
  if (/^\s*(?:import|export\s+\{|from\s)/.test(visible)) return null;
  for (const [operator, pattern, replacement] of operators) {
    const match = pattern.exec(visible);
    if (match === null) continue;
    const replaced = typeof replacement === "string" ? replacement : replacement(match[0], python);
    const text = `${line.slice(0, match.index)}${replaced}${line.slice(match.index + match[0].length)}`;
    return { text, operator };
  }
  return null;
}

/**
 * One mutant on a changed source line, preferring lines the tests covered, then the test
 * checks once more. Killed means some test noticed; survived means none did.
 */
export async function mutationWitness(
  source: readonly ChangedFile[],
  coverage: Coverage,
  tests: readonly DeclaredCheck[],
  context: CheckContext,
): Promise<Mutation> {
  if (tests.length === 0) return { status: "unmeasured", reason: "no test check is declared" };
  const covered = (path: string, line: number) =>
    coverage.status === "measured" &&
    coverage.files.some((file) => file.path === path && file.covered.includes(line));
  const candidates = source
    .filter((file) => code.test(file.path))
    .flatMap((file) => file.addedLines.map((line) => ({ path: file.path, line })))
    .sort((a, b) => Number(covered(b.path, b.line)) - Number(covered(a.path, a.line)));
  for (const candidate of candidates) {
    const absolute = join(context.dir, candidate.path);
    const original = await readFile(absolute, "utf8");
    const lines = original.split("\n");
    const mutant = mutateLine(lines[candidate.line - 1] ?? "", candidate.path.endsWith(".py"));
    if (mutant === null) continue;
    lines[candidate.line - 1] = mutant.text;
    await writeFile(absolute, lines.join("\n"));
    try {
      const runs = await runChecks(tests, context);
      const killed = runs.some((run) => run.result.result !== "pass");
      return { status: killed ? "killed" : "survived", ...candidate, operator: mutant.operator };
    } finally {
      await writeFile(absolute, original);
    }
  }
  return { status: "unmeasured", reason: "no changed source line has an operator to mutate" };
}
