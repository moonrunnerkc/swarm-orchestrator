// Hidden behaviour check for mocha-bugfix-unparse-attached-values: every example the task text
// states, the required ones and the ones that must not change, beyond the upstream test file.
// Written into the scoring checkout under acceptance/hidden/ and run there; never in an arm's
// workspace. Exits 1 naming every example that does not hold.
import assert from "node:assert/strict";
import { unparseMochaArgs, unparseNodeFlags } from "../../lib/cli/unparse-args.js";

const examples = [
  ["$schema", () => assert.deepEqual(unparseMochaArgs({ $schema: "https://json.schemastore.org/mocharc.json" }), ["--$schema=https://json.schemastore.org/mocharc.json"])],
  ["positional then reporter", () => assert.deepEqual(unparseMochaArgs({ _: ["test/a.spec.js"], reporter: "json" }), ["test/a.spec.js", "--reporter=json"])],
  ["require array and timeout", () => assert.deepEqual(unparseMochaArgs({ require: ["tsx", "./setup.js"], timeout: "0" }), ["--require=tsx", "--require=./setup.js", "--timeout=0"])],
  ["number value", () => assert.deepEqual(unparseMochaArgs({ slow: 75 }), ["--slow=75"])],
  ["value starting with dashes", () => assert.deepEqual(unparseMochaArgs({ grep: "--x" }), ["--grep=--x"])],
  ["booleans and nulls unchanged", () => assert.deepEqual(unparseMochaArgs({ bail: true, color: false, ui: null }), ["--bail", "--no-color"])],
  ["object flattened unchanged", () => assert.deepEqual(unparseMochaArgs({ "reporter-option": { foo: "bar", baz: true } }), ["--reporter-option.foo=bar", "--reporter-option.baz"])],
  ["node flags unchanged", () => {
    const flags = unparseNodeFlags({ "enable-source-maps": true, "max-old-space-size": 512 });
    assert.ok(flags.includes("--enable-source-maps"), flags.join(" "));
    assert.ok(flags.includes("--max-old-space-size=512"), flags.join(" "));
  }],
];
const failed = [];
for (const [name, check] of examples) {
  try {
    check();
  } catch (cause) {
    failed.push(`${name}: ${String(cause?.message ?? cause).split("\n")[0]}`);
  }
}
if (failed.length > 0) {
  console.error(`behaviour check: ${failed.length} of ${examples.length} examples do not hold\n${failed.join("\n")}`);
  process.exit(1);
}
console.log(`behaviour check: all ${examples.length} examples hold`);
