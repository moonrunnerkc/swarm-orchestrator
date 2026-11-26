import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { Chokepoint } from "../tools/chokepoint.ts";
import type { AuthorKind } from "./author-prompt.ts";
import { controlsRefused, passingAlone } from "./authored-alone.ts";
import {
  excludingCases,
  failingCases,
  plainOutput,
  refusedName,
  removeLaid,
} from "./authored-cases.ts";
import type { AuthoredTest } from "./check-author.ts";

export { plainOutput, removeLaid } from "./authored-cases.ts";

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
// A bare Error too: what most JavaScript code throws.
const raised = /\b((?:[A-Z]\w*)?(?:Error|Exception))\b/g;
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
  for (const match of output.matchAll(errorLine)) {
    const [line, type = "", message = ""] = match;
    if (/^Assertion/.test(type)) continue;
    if (namesNothing(message, task)) return line.trim().slice(0, 300);
  }
  return null;
}

function namesNothing(message: string, task: string): boolean {
  const words = new Set((task.match(/[A-Za-z_][\w-]{3,}/g) ?? []).map((one) => one.toLowerCase()));
  return !(message.match(/[A-Za-z_][\w-]{3,}/g) ?? []).some((one) => words.has(one.toLowerCase()));
}

const stringMatcherToThrow =
  /\.(?:toThrow|toThrowError|rejects\.toThrow)\(\s*expect\.(stringMatching|stringContaining)\(/;

/**
 * A matcher misuse visible in the check's source: vitest and jest compare an asymmetric string
 * matcher given to toThrow with the thrown error object, not its message, so it never matches.
 * pubprep (2026-11-05 trial 8): three error cases written so failed the reference patch and every
 * other, while at the base their failure was an assertion's like any sound case's.
 */
export function misusedMatcher(content: string): string | null {
  const found = stringMatcherToThrow.exec(content);
  if (found !== null)
    return `it passes expect.${found[1]} to toThrow, which compares it with the error object and not its message, so it fails on every tree; give toThrow a regular expression or a string`;
  // vitest hoists vi.mock to the top of the file wherever it is written, and from vitest 5 refuses
  // one inside a block: claimcheck's upgrade check (rc.13) loaded under vitest 4 at the base and
  // failed to load under the vitest 5 the task asks for.
  if (/^[ \t]+vi\.mock\(/m.test(content))
    return "it calls vi.mock inside a block, which vitest hoists to the top of the file anyway and its newer versions refuse; call vi.mock at the top level and set each case's behavior with mockImplementation";
  return null;
}

/**
 * A case the author names as a control: existing behavior driven through the same setup as the
 * task's cases, which must pass at the base. One that fails there shows the setup never reaches
 * the code, which no base failure of the task's own cases can show: pubprep (2026-11-05, rc.10 and
 * rc.12) drove main() from a dirty tree and from /tmp, and main() refused before the work, while
 * at the base the same cases failed on the task's own "Unknown flag: --reviewers".
 */
const controlCase = /^control\b|^test_control_/i;

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
  const misuse = misusedMatcher(test.content);
  if (misuse !== null) return { reasons: [misuse], output: "" };
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
  const control = failingCases(plain).find((one) => controlCase.test(one.title));
  if (control !== undefined)
    return {
      reasons: [
        `its control case "${control.title}" fails at the base with ${control.error.slice(0, 300)}: existing behavior through the same setup must pass now, so the setup does not reach the code; set it up as the repository's own tests do`,
      ],
      output,
    };
  const refused = await controlsRefused(chokepoint, workspace, test);
  if (refused !== null) return { reasons: [refused], output };
  // Cases that fail on every tree are left out where other cases fail at the base as they should;
  // the check runs as narrowed, and is run again at the base so.
  // An upgrade's behavior check is judged as a feature's: what the new versions make the code do.
  const own = kind === "feature" || kind === "other" || kind === "upgrade";
  const cases = own && !narrowed ? failingCases(plain) : [];
  const foreignCases = cases.filter(
    (one) => foreignError(one.error, task) !== null || refusedName(one.error, task) !== null,
  );
  const leaning = await passingAlone(
    chokepoint,
    workspace,
    test,
    cases.filter((one) => !foreignCases.includes(one)),
  );
  const broken = [...foreignCases, ...leaning];
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
  // A fix and an upgrade change code the base already runs: their checks fail there on an assertion.
  // claimcheck's upgrade (2026-11-05, rc.13): every case raised "toolchain node_modules not found",
  // a wrong argument of its own, and was accepted since the message names vitest.
  const crashed = kind === "fix" || kind === "upgrade" ? raisedNotAsserted(plain, task) : null;
  if (crashed !== null)
    return {
      reasons: [
        `it fails at the base by raising ${crashed} before any assertion, which a correct change would raise too; build the inputs as the code's own tests do, then assert the behavior the task says changes`,
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
