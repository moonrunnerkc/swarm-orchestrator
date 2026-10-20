/**
 * The development contract for the exposed mime task: checks the developers of this work wrote,
 * knowing the omission, the retained faulty candidate and the two deletion-based repairs of
 * 2026-10-17 launches 1 and 2. They are engineered coverage on an exposed task, never discovery,
 * and nothing here is the evaluator: its 113-case audit and the upstream patch stay outside every
 * workspace and request.
 *
 * Each check is a file committed into the workspace's base beside the visible check, run from the
 * repository root by an ordinary command, so both arms of the diagnostic comparison start from the
 * same tree and can read and run the same checks:
 *
 * - counterexample: 2026-10-17's supplied counterexample, byte for byte (a line terminator between
 *   two extensions; the retained faulty patch fails it, the deletion repairs pass it).
 * - relation: the task's rule as a relation, through the product's own planned-check runner: a line
 *   feed, a carriage return, U+2028 and U+2029 must each give what a space gives at every position
 *   of three seeds. Deleting line terminators gives "LINEFEED.png" for "LINEFEED.p\nng", where a
 *   space gives "LINEFEED.p ng" and no type, so it refutes both deletion repairs; it is
 *   2026-10-17's development relation, the same seeds and texts.
 * - preserve: what the task keeps (a space or tab in the name, directory parts, case, unknown and
 *   missing extensions, getExtension), each expectation the base's own answer and the upstream
 *   fix's, checked equal before it was written here.
 */
import { counterexampleSource } from "../../2026-10-17/repair-detection-live/counterexample.mjs";
import {
  plannedContract,
  withPlannedCheck,
} from "../../../../src/workers/planned-check-program.ts";

export const developmentDirectory = "acceptance/development";

const relationDeclaration = withPlannedCheck(null, {
  id: "terminator-like-space",
  purpose: "change",
  requirementId: "terminators-ordinary",
  requirement: "a line terminator in a name behaves like a space",
  quote: "Make getType treat every line terminator like any other character",
  program:
    "import mime from './dist/src/index.js';\nexport default function run(name) {\n  return mime.getType(name);\n}\n",
  seeds: ["LINEFEED.png", "dir/photo.png.jpg", "README"],
  reference: " ",
  variants: ["\n", "\r", "\u2028", "\u2029"],
  why: "the task says a line terminator is treated like any other character, as a space already is",
});

/** The relation as the product builds it: the runner, its stdin and the one expected stdout. */
export function relationBehavior(taskText) {
  const [check] = plannedContract(taskText, relationDeclaration, undefined).checks;
  if (check?.behavior?.kind !== "cli") throw new Error("the relation did not build a command-line check");
  return check.behavior;
}

/**
 * A standalone script that runs the relation exactly as the product's goal verifier runs it (the
 * same argv, stdin and expected stdout), from the repository root, and says which comparisons
 * disagreed when it fails.
 */
function relationScript(behavior) {
  return `// The task's rule as a relation: a line feed, a carriage return, U+2028 and U+2029 in a name
// must each give what a space gives, at every position of each seed. Run from the repository root
// after the build; it runs the planned-check runner Swarm uses, with the same input.
import { spawnSync } from "node:child_process";

const argv = ${JSON.stringify(behavior.argv)};
const stdin = ${JSON.stringify(behavior.stdin)};
const expected = ${JSON.stringify(behavior.stdout[0].value)};
const ran = spawnSync(argv[0], argv.slice(1), { input: stdin, encoding: "utf8" });
if (ran.status === 0 && ran.stdout === expected) {
  console.log("relation holds: every variant gives what a space gives at every position");
  process.exit(0);
}
const shown = (value) =>
  JSON.stringify(value).replace(/[\\u2028\\u2029]/g, (c) => "\\\\u" + c.charCodeAt(0).toString(16));
console.error(\`the relation runner exited \${ran.status}\${ran.stderr ? "; stderr: " + ran.stderr.slice(0, 2000) : ""}\`);
for (const line of ran.stdout.split("\\n").filter(Boolean)) {
  const seed = JSON.parse(line);
  if (seed.holds) continue;
  console.error(\`seed \${shown(seed.seed)}: \${seed.disagreements} comparison(s) disagree\`);
  for (const one of seed.counterexamples ?? [])
    console.error(
      \`  getType(\${shown(one.variant.input)}) gave \${shown(one.variant.result ?? null)}, where getType(\${shown(one.reference.input)}) gave \${shown(one.reference.result ?? null)}\`,
    );
}
process.exit(1);
`;
}

const preserveSource = `import mime from '../../dist/src/index.js';

// What the task keeps: a space or tab in the name, directory parts, case, unknown and missing
// extensions, and getExtension. Each expectation is the unchanged base's own answer.
const types = [
  ['file name.png', 'image/png'],
  ['file\\tname.png', 'image/png'],
  [' leading.png', 'image/png'],
  ['trailing .png', 'image/png'],
  ['dir name/file.txt', 'text/plain'],
  ['tab\\t/inner.json', 'application/json'],
  ['a/b/c.JSON', 'application/json'],
  ['dir\\\\file.html', 'text/html'],
  ['C:\\\\dir\\\\file.css', 'text/css'],
  ['file.tar.gz', 'application/gzip'],
  ['a.b.c.mp3', 'audio/mpeg'],
  ['PHOTO.JPG', 'image/jpeg'],
  ['noext', null],
  ['file.unknownext', null],
  ['a/b.c/d', null],
];
const extensions = [
  ['text/html', 'html'],
  ['image/png', 'png'],
  ['application/json', 'json'],
  ['nonsense/type', null],
];
const failed = [
  ...types.filter(([name, type]) => mime.getType(name) !== type).map(([name, type]) => \`getType(\${JSON.stringify(name)}) returned \${JSON.stringify(mime.getType(name))}, expected \${JSON.stringify(type)}\`),
  ...extensions.filter(([type, ext]) => mime.getExtension(type) !== ext).map(([type, ext]) => \`getExtension(\${JSON.stringify(type)}) returned \${JSON.stringify(mime.getExtension(type))}, expected \${JSON.stringify(ext)}\`),
];
for (const line of failed) console.error(line);
if (failed.length > 0) process.exit(1);
console.log('preserved behaviour holds');
`;

/** Every development check file, by its path in the workspace. */
export function developmentFiles(taskText) {
  return {
    [`${developmentDirectory}/counterexample.mjs`]: counterexampleSource,
    [`${developmentDirectory}/relation.mjs`]: relationScript(relationBehavior(taskText)),
    [`${developmentDirectory}/preserve.mjs`]: preserveSource,
  };
}

/** Each development check: its id, the requirement it decides and its command. */
export const developmentChecks = [
  {
    id: "counterexample",
    requirement: "earlier-extension",
    description:
      "a line terminator between two extensions does not make getType fail or pick the earlier one",
    command: `npm run build && node ${developmentDirectory}/counterexample.mjs`,
  },
  {
    id: "terminator-like-space",
    requirement: "terminators-ordinary",
    description: "a line terminator in a name behaves like a space, at every position",
    command: `npm run build && node ${developmentDirectory}/relation.mjs`,
  },
  {
    id: "preserved-behaviour",
    requirement: "kept-behaviour",
    description: "spaces, tabs, directory parts, case, unknown extensions and getExtension stay as they are",
    command: `npm run build && node ${developmentDirectory}/preserve.mjs`,
  },
];

/** The supplied contract with the development checks beside the visible check. */
export function withDevelopmentChecks(contract) {
  return {
    ...contract,
    requirements: [
      ...contract.requirements,
      ...developmentChecks.map((one) => ({
        id: one.requirement,
        description: one.description,
        checks: [one.id],
      })),
    ],
    checks: [
      ...contract.checks,
      ...developmentChecks.map((one) => ({
        id: one.id,
        command: one.command,
        author: "user",
        exposure: "shared",
        artifacts: [],
      })),
    ],
    immutablePaths: [...contract.immutablePaths, developmentDirectory],
  };
}
