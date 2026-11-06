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
  // pytest's summary cuts each message to the terminal's width, or gives none; the case's own
  // section of the report holds its whole assertion, on its E lines.
  const sections = pytestSections(output);
  for (const match of output.matchAll(/^FAILED \S+?::(\S+?)(?: - (.*))?$/gm)) {
    const title = (match[1] ?? "").split("::").at(-1) ?? "";
    const error = [match[2] ?? "", sections.get(title) ?? ""].join(" ").trim();
    if (title.length > 0) cases.push({ title, error });
  }
  return cases;
}

/** Each failing pytest case's E lines, joined, by its name. */
function pytestSections(output: string): Map<string, string> {
  const found = new Map<string, string>();
  const parts = output.split(/^_{3,} (\S+) _{3,}$/m);
  for (let at = 1; at + 1 < parts.length; at += 2) {
    const title = (parts[at] ?? "").split(".").at(-1) ?? "";
    const lines = (parts[at + 1] ?? "")
      .split("\n")
      .filter((line) => /^E {2,}/.test(line))
      .map((line) => line.replace(/^E\s+/, "").trim());
    if (title.length > 0 && lines.length > 0) found.set(title, lines.join(" ").slice(0, 600));
  }
  return found;
}

const refusal =
  /\b(?:unknown|unsupported|unrecognized|unexpected|invalid|no such|not found|not a valid)\b[^'"`\n]{0,40}['"`]([^'"`\n]{1,60})['"`]/gi;

/**
 * A name the code refused, quoted in a case's error at the base, that the task never names: the
 * check fed the code an input of its own invention (a config key, an option), and a correct change
 * refuses it too. tracemantle c4dc276c4 (2026-11-05, rc.19): cases wrote the keys 'strict', 'author'
 * and 'key' and failed on "Unknown config key" at the base and with the human fix alike.
 */
export function refusedName(error: string, task: string): string | null {
  // The names the task quotes, those quoted inside its quoted examples, and its flags.
  const quoted = (text: string) =>
    [...text.matchAll(/`([^`]+)`|'([^'\n]+)'|"([^"\n]+)"/g)].flatMap((match) =>
      [match[1], match[2], match[3]].filter((one): one is string => one !== undefined),
    );
  const spans = quoted(task);
  const named = new Set([
    ...spans,
    ...spans.flatMap(quoted),
    ...(task.match(/--?[A-Za-z][\w-]*/g) ?? []),
  ]);
  for (const match of error.matchAll(refusal)) {
    if (!named.has(match[1] ?? "")) return match[0].slice(0, 200);
  }
  return null;
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
