// Hidden behaviour check for mocha-bugfix-long-prefix-short-alias: every example the task text
// states, the required ones and the ones that must not change, beyond the upstream test file
// (which checks only --t). Written into the scoring checkout under acceptance/hidden/ and run
// there; never in an arm's workspace. Exits 1 naming every example that does not hold.
import assert from "node:assert/strict";
import { parseMochaArgs } from "../../lib/cli/parse-args.js";

const defaults = { timeout: 1000 };
const parse = (args) => parseMochaArgs(args, { ...defaults });
const examples = [
  ["--t 0", () => { const r = parse(["--t", "0"]); assert.equal(r.timeout, "0"); assert.deepEqual(r._, []); }],
  ["--t=0", () => assert.equal(parse(["--t=0"]).timeout, "0")],
  ["--R dot", () => { const r = parse(["--R", "dot"]); assert.equal(r.reporter, "dot"); assert.deepEqual(r._, []); }],
  ["--r twice", () => { const r = parse(["--r", "./x.js", "--r", "./y.js"]); assert.deepEqual(r.require, ["./x.js", "./y.js"]); assert.deepEqual(r._, []); }],
  ["--j 3", () => assert.equal(parse(["--j", "3"]).jobs, 3)],
  ["spec then --t 0", () => { const r = parse(["test/a.js", "--t", "0"]); assert.deepEqual(r._, ["test/a.js"]); assert.equal(r.timeout, "0"); }],
  ["--timeout 5 --t 7", () => assert.equal(parse(["--timeout", "5", "--t", "7"]).timeout, "7")],
  ["no alias keys", () => {
    for (const args of [["--t", "0"], ["--R", "dot"], ["--r", "./x.js"], ["--j", "3"]]) {
      const r = parse(args);
      for (const key of ["t", "R", "r", "j"]) assert.equal(Object.hasOwn(r, key), false, `${args.join(" ")} kept ${key}`);
    }
  }],
  ["-t 0 unchanged", () => assert.equal(parse(["-t", "0"]).timeout, "0")],
  ["-R json -b unchanged", () => { const r = parse(["-R", "json", "-b"]); assert.equal(r.reporter, "json"); assert.equal(r.bail, true); }],
  ["--timeouts=200 unchanged", () => assert.equal(parse(["--timeouts=200"]).timeout, "200")],
  ["--reporter-options=a=b unchanged", () => assert.deepEqual(parse(["--reporter-options=a=b"])["reporter-option"], ["a=b"])],
  ["--no-bail unchanged", () => assert.equal(parse(["--no-bail"]).bail, false)],
  ["--b unchanged", () => assert.equal(parse(["--b"]).bail, true)],
  ["--A unchanged", () => assert.equal(parse(["--A"])["async-only"], true)],
  ["--x unchanged", () => assert.equal(parse(["--x"]).x, true)],
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
