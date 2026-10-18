/**
 * The supplied counterexample for the mime task: a check a person wrote, from the task's own rule
 * ("whatever characters precede it, so that a name crafted with a line terminator cannot make the
 * lookup fail or pick an earlier extension"), that the retained faulty patch fails. It is supplied
 * acceptance, authored by the developers of this experiment with knowledge of that patch, so a run
 * that repairs against it shows live repair with a supplied counterexample, not discovery.
 *
 * Its names are not the evaluator audit's literal cases (`photo.png\n.jpg` and the like), though
 * they are the same family: a line terminator between two extensions, with and without a
 * directory part.
 */
export const counterexampleSource = `import mime from '../../dist/src/index.js';

// A line terminator is an ordinary character in a name: the type still comes from the extension
// after the last dot, not from an earlier one and not from nothing.
const cases = [
  ['notes.txt\\n.html', 'text/html'],
  ['a/b.json\\u2029.png', 'image/png'],
  ['c\\\\d.html\\r.txt', 'text/plain'],
];
// JSON.stringify leaves U+2028 and U+2029 as they are, which print as spaces.
const shown = (value) =>
  JSON.stringify(value).replace(/[\\u2028\\u2029]/g, (c) => '\\\\u' + c.charCodeAt(0).toString(16));
const failed = cases.filter(([name, type]) => mime.getType(name) !== type);
for (const [name, type] of failed)
  console.error(\`getType(\${shown(name)}) returned \${shown(mime.getType(name))}, expected \${shown(type)}\`);
if (failed.length > 0) process.exit(1);
console.log('counterexample check passed');
`;

export const counterexamplePath = "acceptance/counterexample/check.mjs";

/** The supplied contract with the counterexample added beside the visible check. */
export function withCounterexample(contract) {
  return {
    ...contract,
    requirements: [
      ...contract.requirements,
      {
        id: "earlier-extension",
        description:
          "a line terminator between two extensions does not make getType fail or pick the earlier one",
        checks: ["counterexample"],
      },
    ],
    checks: [
      ...contract.checks,
      {
        id: "counterexample",
        command: `npm run build && node ${counterexamplePath}`,
        author: "user",
        exposure: "shared",
        artifacts: [{ path: counterexamplePath, content: counterexampleSource }],
      },
    ],
    immutablePaths: [...contract.immutablePaths, "acceptance/counterexample"],
  };
}
