import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { isTestFile } from "./gates/measures.ts";
import type { EditReview, ProposedFileChange } from "./tools/file-tools.ts";

const run = promisify(execFile);

/**
 * Two readings of an edit that the worker gets in the edit's own result.
 *
 * The first asks for a reason before an edit stops using an existing implementation and puts a
 * larger block of new code in its place. Held-out block 1's p-limit bug fix replaced
 * `const limit = pLimit(options); return (...arguments_) => limit(() => function_(...arguments_))`
 * with seventy lines that re-implemented the queue; the task only needed a method added to what
 * pLimit already returns, and the rewrite lost pLimit's handling of a synchronous throw, which the
 * task named as behaviour to keep. Fewer changed lines is not the rule: a rewrite can be right.
 * What the worker is asked for is the reason, once, with the task's own words about what must not
 * change in front of it. The edit is applied when it comes back with one.
 *
 * The second, after a replacement lands, says where else the exact text it replaced still occurs,
 * so a mechanical change across files can be finished from one result rather than rediscovered.
 *
 * Both are lexical. A call is a name followed by an opening parenthesis; a definition is a
 * `function`, `class`, `def` or an assignment of a function. A name reached another way is not
 * seen, and nothing here decides whether the code is right.
 */

const notCalls: ReadonlySet<string> = new Set([
  "if",
  "for",
  "while",
  "switch",
  "catch",
  "function",
  "return",
  "typeof",
  "new",
  "await",
  "async",
  "super",
  "import",
  "require",
  "yield",
  "delete",
  "void",
  "constructor",
  "get",
  "set",
  "Promise",
  "Error",
  "TypeError",
  "RangeError",
  "Object",
  "Array",
  "String",
  "Number",
  "Boolean",
  "Symbol",
  "Map",
  "Set",
  "WeakMap",
  "Date",
  "RegExp",
  "BigInt",
  "JSON",
  "Math",
  "console",
  "setTimeout",
  "clearTimeout",
  "setImmediate",
  "queueMicrotask",
  "structuredClone",
  "parseInt",
  "parseFloat",
  "isNaN",
  "expect",
  "describe",
  "it",
  "test",
  "print",
  "len",
  "str",
  "int",
  "dict",
  "list",
]);

/** Names called in a text, never counting a definition's own name. */
export function calledNames(text: string): ReadonlySet<string> {
  const names = new Set<string>();
  for (const match of text.matchAll(/(?<![\w$.])([A-Za-z_$][\w$]*)\s*\(/g)) {
    const name = match[1] ?? "";
    const before = text.slice(Math.max(0, (match.index ?? 0) - 12), match.index ?? 0);
    if (/(function\s*\*?\s*|def\s+|class\s+)$/.test(before)) continue;
    if (!notCalls.has(name)) names.add(name);
  }
  return names;
}

const lines = (text: string): number => (text.length === 0 ? 0 : text.split("\n").length);

const definitionOf = (name: string): RegExp => {
  const escaped = name.replace(/[$]/g, "\\$");
  return new RegExp(
    `(function\\s*\\*?\\s*${escaped}\\b|\\b(const|let|var)\\s+${escaped}\\s*=|\\bclass\\s+${escaped}\\b|\\bdef\\s+${escaped}\\b|\\b${escaped}\\s*[:=]\\s*(async\\s+)?(function\\b|\\())`,
  );
};

const sourceFile = /\.(c|m)?[jt]sx?$|\.py$/;

/** The task's own sentences about behaviour to keep and things to deliver, in its order. */
export function taskStatements(task: string): readonly string[] {
  const sentences = task
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-Z(])/)
    .map((one) => one.trim())
    .filter((one) => one.length > 0);
  const keep =
    /\b(must not change|not change|unchanged|as (it does )?today|keep(s)? (passing|working)|still|preserv\w*|behaves? as)\b/i;
  const deliver = /\b(add|write|include)\b[^.]{0,60}\btests?\b/i;
  return sentences.filter((one) => keep.test(one) || deliver.test(one)).slice(0, 6);
}

/**
 * A file a task's requested tests could be in. Wider than the gates' own reading, which measures
 * tests and must not change here: a root `test.js` and a type-test `index.test-d.ts` (p-limit's
 * layout) are tests a task asks for, so neither may count as "no test file changed".
 */
export function couldHoldRequestedTests(path: string): boolean {
  const name = path.split("/").at(-1) ?? path;
  return (
    isTestFile(path) ||
    /^tests?(\.[A-Za-z-]+)*\.[cm]?[jt]sx?$/.test(name) ||
    /\.test-d\.[cm]?tsx?$/.test(name)
  );
}

/** Whether the task asks for tests to be added. */
export function asksForTests(task: string): boolean {
  return /\b(add|write|include)\b[^.]{0,60}\b(regression )?tests?\b/i.test(task);
}

export interface EditReviewOptions {
  readonly workspace: string;
  readonly taskStatements: readonly string[];
}

export function createEditReview(options: EditReviewOptions): EditReview {
  const definedWhere = async (
    name: string,
    changes: readonly ProposedFileChange[],
  ): Promise<string | null> => {
    const pattern = definitionOf(name);
    for (const change of changes) {
      const at = change.before.split("\n").findIndex((line) => pattern.test(line));
      if (at >= 0) return `${change.path}:${at + 1}`;
    }
    const listed = await run("git", ["ls-files", "-co", "--exclude-standard"], {
      cwd: options.workspace,
      maxBuffer: 32_000_000,
    }).catch(() => null);
    for (const path of (listed?.stdout ?? "")
      .split("\n")
      .filter((one) => sourceFile.test(one))
      .slice(0, 5000)) {
      const absolute = join(options.workspace, path);
      if (((await stat(absolute).catch(() => null))?.size ?? Number.POSITIVE_INFINITY) > 1_000_000)
        continue;
      const content = await readFile(absolute, "utf8").catch(() => "");
      const at = content.split("\n").findIndex((line) => pattern.test(line));
      if (at >= 0) return `${path}:${at + 1}`;
    }
    return null;
  };

  return {
    async refuse(changes, reason) {
      if (reason !== undefined && reason.trim().length > 0) return null;
      const removedText = changes.flatMap((change) => change.replacements.map((one) => one.find));
      const addedText = changes.flatMap((change) => change.replacements.map((one) => one.replace));
      const removedLines = removedText.reduce((sum, one) => sum + lines(one), 0);
      const addedLines = addedText.reduce((sum, one) => sum + lines(one), 0);
      if (addedLines < 12 || addedLines < 3 * Math.max(1, removedLines)) return null;
      const stillCalled = new Set(changes.flatMap((change) => [...calledNames(change.after)]));
      const dropped = [...calledNames(removedText.join("\n"))].filter(
        (name) => !stillCalled.has(name),
      );
      const found: string[] = [];
      for (const name of dropped.slice(0, 4)) {
        const where = await definedWhere(name, changes);
        if (where !== null) found.push(`${name} (defined at ${where})`);
      }
      if (found.length === 0) return null;
      return [
        `Not applied yet: the code this edit replaces calls ${found.join(" and ")}, the new code no longer calls ${found.length === 1 ? "it" : "them"} anywhere in the file, and ${addedLines} lines take the place of ${removedLines}.`,
        "An existing implementation already provides whatever the replaced code got from it. Where extending it, or delegating to it, does what the task asks, prefer that; a rewrite has to provide all of that behaviour again.",
        ...(options.taskStatements.length === 0
          ? []
          : [`What the task says about behaviour to keep: ${options.taskStatements.join(" ")}`]),
        'If the rewrite is the right change, send the same edit again with a "reason" saying why delegating is not enough, and then check that behaviour on the new code.',
      ].join("\n");
    },

    async afterwards(changes) {
      const edited = new Set(changes.map((change) => change.path));
      const notes: string[] = [];
      const finds = [
        ...new Set(
          changes
            .flatMap((change) => change.replacements)
            .filter((one) => one.find !== one.replace && !one.find.includes("\n"))
            .map((one) => one.find.trim())
            .filter((one) => one.length >= 8),
        ),
      ].slice(0, 6);
      for (const find of finds) {
        const found = await run(
          "git",
          ["grep", "-F", "-l", "-I", "--untracked", "--exclude-standard", "-e", find],
          { cwd: options.workspace, maxBuffer: 8_000_000 },
        ).catch(() => null);
        const elsewhere = (found?.stdout ?? "")
          .split("\n")
          .filter((path) => path.length > 0 && !edited.has(path));
        if (elsewhere.length > 0)
          notes.push(
            `[the replaced text ${JSON.stringify(find.length > 80 ? `${find.slice(0, 80)}...` : find)} still occurs in ${elsewhere.slice(0, 8).join(", ")}${elsewhere.length > 8 ? ` and ${elsewhere.length - 8} more file(s)` : ""}; where they need the same change, one edit call with "edits" makes it in all of them]`,
          );
      }
      return notes;
    },
  };
}
