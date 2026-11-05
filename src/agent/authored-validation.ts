import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { Chokepoint } from "../tools/chokepoint.ts";
import type { AuthorKind } from "./author-prompt.ts";
import type { AuthoredTest } from "./check-author.ts";

const excerpt = (text: string) => text.slice(-1500);
const notCollected =
  /No test files found|no tests ran|collected 0 items|file or directory not found|No tests found/i;
// Node reports an export the base lacks as a SyntaxError too; that is the failure a feature's
// check should have, not a check that does not parse.
const unparsable = /(?:SyntaxError|IndentationError)(?!: The requested module)|Transform failed/;
const missingModule =
  /Failed to load url (\S+)|Cannot find module '([^']+)'|No module named '([^']+)'/g;

/**
 * A module the check imports that the base lacks and the task does not name: it fails at the
 * base for a reason no correct change would remove. A module the task names (a new file it asks
 * for) is the change's to create.
 */
export function unrelatedImport(output: string, task: string): string | null {
  for (const match of output.matchAll(missingModule)) {
    const spec = match[1] ?? match[2] ?? match[3] ?? "";
    const stem =
      spec
        .split(/[/.]/)
        .filter((part) => /^\w+$/.test(part) && part !== "js" && part !== "ts")
        .at(-1) ?? spec;
    if (stem.length > 0 && !task.includes(stem)) return spec;
  }
  return null;
}

const assertion =
  /AssertionError|expect\(received\)|\bassert [^\n]*\n\s*E\s+assert\b|^E\s+assert\b/m;
const raised = /\b([A-Z]\w*(?:Error|Exception))\b/g;
const crashWords = /\b(?:rais|throw|crash|exception|error|traceback)/i;

/**
 * Why a fix's check fails at the base for no reason the fix removes: the code raised before any
 * assertion ran (a check that builds its inputs wrongly fails on every tree), and the wording
 * names no crash for the fix to remove. Null where it fails on an assertion, as it should.
 * tracemantle (2026-11-05 replay): a check built ParsedSkill without its frontmatter, and every
 * correct fix would have raised the same AttributeError.
 */
export function raisedNotAsserted(output: string, task: string): string | null {
  if (assertion.test(output)) return null;
  const errors = [...new Set([...output.matchAll(raised)].map((match) => match[1] ?? ""))];
  if (errors.length === 0 || crashWords.test(task)) return null;
  const line =
    output.split("\n").find((one) => errors.some((name) => one.includes(`${name}:`))) ?? "";
  return line.trim().replace(/^E\s+/, "").slice(0, 300);
}

const undefinedName =
  /ReferenceError: (\w+) is not defined|NameError: name '(\w+)' is not defined/g;

/**
 * A name the check uses and never defines or imports, which the task does not name either: it
 * fails at the base on its own bug, and on every tree after. pubprep (2026-11-05, the sealed-set
 * run): the check called vitest's beforeEach without importing it, where the project does not
 * turn vitest's globals on, and every turn of the run failed on that line.
 */
export function ownUndefinedName(output: string, task: string): string | null {
  for (const match of output.matchAll(undefinedName)) {
    const name = match[1] ?? match[2] ?? "";
    if (name.length > 0 && !new RegExp(`\\b${name}\\b`).test(task)) return name;
  }
  return null;
}

/** Runs an authored test file at the base: laid in, run by the harness, taken out again. */
export async function runAtBase(
  chokepoint: Chokepoint,
  workspace: string,
  test: Omit<AuthoredTest, "atBase">,
  task: string,
  kind: AuthorKind,
): Promise<{ readonly reasons: string[]; readonly output: string }> {
  const absolute = join(workspace, test.path);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, test.content);
  const ran = await chokepoint
    .check(test.command, `authored check for ${test.requirement}, at the base`)
    .finally(() => removeLaid(workspace, test.path));
  const output = excerpt(ran.output);
  if (ran.decision !== "allowed") return { reasons: [`it could not run: ${output}`], output };
  if (ran.exitCode === 0)
    return { reasons: ["it passes at the base, so it cannot tell the change apart"], output };
  if (notCollected.test(ran.output))
    return { reasons: [`the runner did not collect it: ${output}`], output };
  if (unparsable.test(ran.output) && ran.output.includes(basename(test.path)))
    return { reasons: [`it does not parse: ${output}`], output };
  const undefinedHere = ownUndefinedName(ran.output, task);
  if (undefinedHere !== null)
    return {
      reasons: [
        `it uses ${undefinedHere}, which it neither defines nor imports, so it fails on every tree; import it as the example test does`,
      ],
      output,
    };
  const crashed = kind === "fix" ? raisedNotAsserted(ran.output, task) : null;
  if (crashed !== null)
    return {
      reasons: [
        `it fails at the base by raising ${crashed} before any assertion, which a correct fix would raise too; build the inputs as the code's own tests do, then assert the behavior the task says is wrong`,
      ],
      output,
    };
  const missing = unrelatedImport(ran.output, task);
  if (missing !== null)
    return {
      reasons: [
        `it imports ${missing}, which does not exist at the base and which the task does not ask for; import from the modules listed as defining the task's names`,
      ],
      output,
    };
  return { reasons: [], output };
}

/** Takes a laid check out of the tree, with any bytecode its run left beside it. */
export async function removeLaid(workspace: string, path: string): Promise<void> {
  await rm(join(workspace, path), { force: true });
  const stem = basename(path).replace(/\.py$/, "");
  const cache = join(workspace, dirname(path), "__pycache__");
  const left = await readdir(cache).catch(() => [] as string[]);
  for (const name of left) if (name.startsWith(`${stem}.`)) await rm(join(cache, name));
}
