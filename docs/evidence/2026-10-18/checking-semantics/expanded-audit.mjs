/**
 * The expanded development audit of the exposed mime task, appended after 2026-10-18 launch 4's
 * patch was found to pass the frozen evaluator while changing a behaviour the task keeps. It adds
 * to the development contract of `../generated-check-control/development-checks.mjs`; nothing
 * there or in the frozen evaluator is edited.
 *
 * - custom-extension: through the public API (`new Mime(typeMap)`, which `define` backs and which
 *   lowercases extensions and accepts any characters in them), two registered extensions that
 *   differ only by a line feed versus a space. The task says a content type comes "from the
 *   extension after the last dot of the last segment, whatever characters precede it" and that
 *   getType treats "every line terminator like any other character"; `define` and the rest of the
 *   class "stay as they are". So `getType("file.pn\ng")` is `application/x-newline`: the upstream
 *   fix and the unchanged base both give it, and a patch that turns line terminators into spaces
 *   gives `application/x-space`.
 * - relation-bound: the development relation (a line terminator gives what a space gives at
 *   every position) run through the product's own planned-check runner under a configuration
 *   that registers both texts as extensions. It is not a check any implementation must pass: it
 *   shows where the relation itself stops being the task's rule. Under the default types a
 *   terminator and a space give one answer; here a correct implementation tells them apart, so
 *   it breaks the relation, and only an implementation that confuses them holds it.
 *
 * Written by the developers of this work knowing every patch it is run on: exposed development
 * material, never unseen evaluation.
 */
import {
  plannedContract,
  withPlannedCheck,
} from "../../../../src/workers/planned-check-program.ts";

export const auditDirectory = "acceptance/development-audit";

export const customExtensionSource = `import Mime from '../../dist/src/Mime.js';

// Two registered extensions that differ only by a line feed versus a space, through the public
// constructor. The type comes from the extension after the last dot, whatever it holds.
const mime = new Mime({ 'application/x-newline': ['pn\\ng'], 'application/x-space': ['pn g'] });
const types = [
  ['file.pn\\ng', 'application/x-newline'],
  ['file.pn g', 'application/x-space'],
  ['dir/file.pn\\ng', 'application/x-newline'],
  ['FILE.PN\\nG', 'application/x-newline'],
];
const extensions = [
  ['application/x-newline', 'pn\\ng'],
  ['application/x-space', 'pn g'],
];
const shown = (value) => JSON.stringify(value);
const failed = [
  ...types.filter(([name, type]) => mime.getType(name) !== type).map(([name, type]) => \`getType(\${shown(name)}) returned \${shown(mime.getType(name))}, expected \${shown(type)}\`),
  ...extensions.filter(([type, ext]) => mime.getExtension(type) !== ext).map(([type, ext]) => \`getExtension(\${shown(type)}) returned \${shown(mime.getExtension(type))}, expected \${shown(ext)}\`),
];
for (const line of failed) console.error(line);
if (failed.length > 0) process.exit(1);
console.log('custom extensions keep their own types');
`;

const boundDeclaration = withPlannedCheck(null, {
  id: "terminator-like-space-custom-types",
  purpose: "preserve",
  requirementId: "relation-bound",
  requirement: "the development relation under types that register a space and a line feed",
  program:
    "import Mime from './dist/src/Mime.js';\nconst mime = new Mime({ 'application/x-space': ['p ng'], 'application/x-newline': ['p\\nng'] });\nexport default function run(name) {\n  return mime.getType(name);\n}\n",
  seeds: ["file.png"],
  reference: " ",
  variants: ["\n"],
  why: "probes the relation's own bound; not a requirement of the task",
});

/** The relation-bound probe as the product builds it: runner argv, stdin and expected stdout. */
export function relationBoundBehavior() {
  const [check] = plannedContract("probe", boundDeclaration, undefined).checks;
  if (check?.behavior?.kind !== "cli") throw new Error("the probe did not build a command-line check");
  return check.behavior;
}

/** A standalone script that runs the probe as the goal verifier would, and prints what it saw. */
function relationBoundScript(behavior) {
  return `// The development relation under types that register both a space and a line feed in an
// extension. Exit 0 where the relation holds, 1 where it breaks; either is a reading, not a verdict.
import { spawnSync } from "node:child_process";

const argv = ${JSON.stringify(behavior.argv)};
const stdin = ${JSON.stringify(behavior.stdin)};
const expected = ${JSON.stringify(behavior.stdout[0].value)};
const ran = spawnSync(argv[0], argv.slice(1), { input: stdin, encoding: "utf8" });
console.log(ran.stdout.trim());
if (ran.status !== 0) console.error(ran.stderr.slice(0, 2000));
process.exit(ran.status === 0 && ran.stdout === expected ? 0 : 1);
`;
}

/** Every audit file, by its path in a scoring checkout. */
export function auditFiles() {
  return {
    [`${auditDirectory}/custom-extension.mjs`]: customExtensionSource,
    [`${auditDirectory}/relation-bound.mjs`]: relationBoundScript(relationBoundBehavior()),
  };
}

export const auditChecks = [
  {
    id: "custom-extension",
    kind: "requirement",
    command: `npm run build && node ${auditDirectory}/custom-extension.mjs`,
  },
  {
    id: "relation-bound",
    kind: "probe of the relation",
    command: `npm run build && node ${auditDirectory}/relation-bound.mjs`,
  },
];
