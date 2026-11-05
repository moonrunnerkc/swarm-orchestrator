import { readdir, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { runnerOf } from "./test-conventions.ts";

const ansi = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

/** A runner's output without its colour escapes, which split the words the rules look for. */
export const plainOutput = (text: string) => text.replace(ansi, "");

/** Takes a laid check out of the tree, with any bytecode its run left beside it. */
export async function removeLaid(workspace: string, path: string): Promise<void> {
  await rm(join(workspace, path), { force: true });
  const stem = basename(path).replace(/\.py$/, "");
  const cache = join(workspace, dirname(path), "__pycache__");
  const left = await readdir(cache).catch(() => [] as string[]);
  for (const name of left) if (name.startsWith(`${stem}.`)) await rm(join(cache, name));
}

/** One failing case of a test run, as its runner names it, with the first line of its error. */
export interface FailingCase {
  readonly title: string;
  readonly error: string;
}

/**
 * The failing cases a run's plain output names, with their errors: vitest and jest print each
 * as `FAIL file > suite > title` and the error on the next line; pytest's summary as
 * `FAILED path::name - Error: message`. Other runners name none here.
 */
export function failingCases(output: string): FailingCase[] {
  const cases: FailingCase[] = [];
  for (const match of output.matchAll(/^ ?FAIL {1,2}\S+ > (.+)\n([^\n]*)/gm)) {
    const title = (match[1] ?? "").split(" > ").at(-1)?.trim() ?? "";
    if (title.length > 0) cases.push({ title, error: (match[2] ?? "").trim() });
  }
  for (const match of output.matchAll(/^FAILED \S+?::(\S+) - (.*)$/gm)) {
    const title = (match[1] ?? "").split("::").at(-1) ?? "";
    if (title.length > 0) cases.push({ title, error: (match[2] ?? "").trim() });
  }
  return cases;
}

const quote = (text: string) => `'${text.replaceAll("'", "'\\''")}'`;
const literal = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The command with the named cases left out, by the runner's own name filter, or null where the
 * runner has none this knows: a check whose cases fail on every tree keeps its other cases.
 */
export function excludingCases(command: string, titles: readonly string[]): string | null {
  if (titles.length === 0) return command;
  const runner = runnerOf(command);
  const pattern = `^(?!.*(?:${titles.map(literal).join("|")})).*$`;
  if (runner === "vitest" || runner === "jest") return `${command} -t ${quote(pattern)}`;
  if (runner === "pytest") return `${command} -k ${quote(`not (${titles.join(" or ")})`)}`;
  if (runner === "node") return `${command} --test-name-pattern=${quote(pattern)}`;
  return null;
}

/** The command narrowed to the one named case, or null where the runner has no filter this knows. */
export function onlyCase(command: string, title: string): string | null {
  const runner = runnerOf(command);
  const pattern = `${literal(title)}$`;
  if (runner === "vitest" || runner === "jest") return `${command} -t ${quote(pattern)}`;
  if (runner === "pytest") return `${command} -k ${quote(title)}`;
  if (runner === "node") return `${command} --test-name-pattern=${quote(pattern)}`;
  return null;
}

/** The titles of the control cases a check's source declares: `control: ...`, `test_control_...`. */
export function controlTitles(content: string): string[] {
  const named = [...content.matchAll(/\b(?:it|test)\(\s*(["'`])(control\b[^"'`]*)\1/g)].map(
    (match) => match[2] ?? "",
  );
  const python = [...content.matchAll(/^\s*(?:async\s+)?def\s+(test_control_\w+)/gm)].map(
    (match) => match[1] ?? "",
  );
  return [...named, ...python].filter((title) => title.length > 0);
}
