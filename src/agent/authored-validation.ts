import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { Chokepoint } from "../tools/chokepoint.ts";
import type { AuthorKind } from "./author-prompt.ts";
import { excludingCases, failingCases } from "./authored-cases.ts";
import type { AuthoredTest } from "./check-author.ts";

const excerpt = (text: string) => text.slice(-1500);
const ansi = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

/** A runner's output without its colour escapes, which split the words the rules look for. */
export const plainOutput = (text: string) => text.replace(ansi, "");
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

const errorLine = /\b([A-Z]\w*(?:Error|Exception))(?: \[\w+\])?: ([^\n]*)/g;

/**
 * The first error at the base that is neither an assertion's nor about anything the task names:
 * the check's own misuse of its runner or its inputs, which fails every tree alike. A feature's
 * check may fail on a name the base lacks ("parseArgs(...).reviewers is undefined"); pubprep
 * (2026-11-05 trial) passed a predicate to vitest's toThrow, which raised "Cannot read properties
 * of undefined (reading 'constructor')" on the reference patch and every other.
 */
export function foreignError(output: string, task: string): string | null {
  const words = new Set((task.match(/[A-Za-z_][\w-]{3,}/g) ?? []).map((one) => one.toLowerCase()));
  for (const match of output.matchAll(errorLine)) {
    const [line, type = "", message = ""] = match;
    if (/^Assertion/.test(type)) continue;
    const named = (message.match(/[A-Za-z_][\w-]{3,}/g) ?? []).some((one) =>
      words.has(one.toLowerCase()),
    );
    if (!named) return line.trim().slice(0, 300);
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
  narrowed = false,
): Promise<{
  readonly reasons: string[];
  readonly output: string;
  /** The command with the cases that fail on every tree left out, where any were. */
  readonly command?: string;
  readonly excluded?: readonly string[];
}> {
  const absolute = join(workspace, test.path);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, test.content);
  const ran = await chokepoint
    .check(test.command, `authored check for ${test.requirement}, at the base`)
    .finally(() => removeLaid(workspace, test.path));
  // Runners colour their output; every rule here reads the text without the escapes.
  const plain = plainOutput(ran.output);
  const output = excerpt(plain);
  if (ran.decision !== "allowed") return { reasons: [`it could not run: ${output}`], output };
  if (ran.exitCode === 0)
    return { reasons: ["it passes at the base, so it cannot tell the change apart"], output };
  if (notCollected.test(plain))
    return { reasons: [`the runner did not collect it: ${output}`], output };
  if (unparsable.test(plain) && plain.includes(basename(test.path)))
    return { reasons: [`it does not parse: ${output}`], output };
  const undefinedHere = ownUndefinedName(plain, task);
  if (undefinedHere !== null)
    return {
      reasons: [
        `it uses ${undefinedHere}, which it neither defines nor imports, so it fails on every tree; import it as the example test does`,
      ],
      output,
    };
  // Cases that fail on every tree are left out where other cases fail at the base as they should;
  // the check runs as narrowed, and is run again at the base so.
  const own = kind === "feature" || kind === "other";
  const cases = own && !narrowed ? failingCases(plain) : [];
  const broken = cases.filter((one) => foreignError(one.error, task) !== null);
  const command =
    broken.length > 0 && broken.length < cases.length
      ? excludingCases(
          test.command,
          broken.map((one) => one.title),
        )
      : null;
  if (command !== null) {
    const again = await runAtBase(chokepoint, workspace, { ...test, command }, task, kind, true);
    if (again.reasons.length > 0) return again;
    return { ...again, command, excluded: broken.map((one) => one.title) };
  }
  const foreign = own ? foreignError(plain, task) : null;
  if (foreign !== null)
    return {
      reasons: [
        `a case fails at the base with ${foreign}, which names nothing the task does: the check's own use of its runner or inputs fails on every tree; use the runner's API as the example test does`,
      ],
      output,
    };
  const crashed = kind === "fix" ? raisedNotAsserted(plain, task) : null;
  if (crashed !== null)
    return {
      reasons: [
        `it fails at the base by raising ${crashed} before any assertion, which a correct fix would raise too; build the inputs as the code's own tests do, then assert the behavior the task says is wrong`,
      ],
      output,
    };
  const missing = unrelatedImport(plain, task);
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
